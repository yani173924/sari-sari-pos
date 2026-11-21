const { query, getClient } = require('../config/db');
const { generateReceiptNo } = require('../utils/helpers');
const { setFlash } = require('../middleware/flash');
const { getDailySalesReport, isValidReportDate } = require('../utils/dailySalesReport');

async function posScreen(req, res, next) {
  try {
    const [products, categories] = await Promise.all([
      query(
        `SELECT products.*, categories.name AS category_name
         FROM products LEFT JOIN categories ON categories.id = products.category_id
         WHERE products.active = TRUE AND products.stock_quantity > 0 ORDER BY products.name`
      ).then((r) => r.rows),
      query('SELECT id, name FROM categories ORDER BY name').then((r) => r.rows),
    ]);
    res.render('pos/index', { title: 'Point of Sale', products, categories });
  } catch (err) {
    next(err);
  }
}

async function searchProducts(req, res, next) {
  try {
    const q = `%${req.query.q || ''}%`;
    const { rows: products } = await query(
      `SELECT products.id, products.name, products.barcode, products.category_id, categories.name AS category_name,
              products.unit, products.selling_price, products.stock_quantity
       FROM products LEFT JOIN categories ON categories.id = products.category_id
       WHERE products.active = TRUE AND products.stock_quantity > 0
         AND (products.name ILIKE $1 OR products.barcode ILIKE $1)
       ORDER BY products.name LIMIT 100`,
      [q]
    );
    res.json(products);
  } catch (err) {
    next(err);
  }
}

async function checkout(items, amountPaid, userId) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Cart is empty.');
  const quantitiesByProduct = new Map();
  for (const item of items) {
    if (!item || typeof item !== 'object' || !Number.isInteger(item.productId) || item.productId <= 0 ||
        !Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error('Cart contains an invalid product or quantity.');
    }
    quantitiesByProduct.set(item.productId, (quantitiesByProduct.get(item.productId) || 0) + item.quantity);
  }
  if (!Number.isFinite(amountPaid)) throw new Error('Enter a valid payment amount.');
  amountPaid = Math.round(amountPaid * 100) / 100;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    let total = 0;
    const resolvedItems = [];

    for (const [productId, quantity] of quantitiesByProduct) {
      const { rows } = await client.query('SELECT * FROM products WHERE id = $1 AND active = TRUE FOR UPDATE', [
        productId,
      ]);
      const product = rows[0];
      if (!product) throw new Error('Product not found.');
      if (product.stock_quantity < quantity) {
        throw new Error(`Not enough stock for "${product.name}" (only ${product.stock_quantity} ${product.unit} left).`);
      }
      const subtotal = Math.round(product.selling_price * quantity * 100) / 100;
      total = Math.round((total + subtotal) * 100) / 100;
      resolvedItems.push({ product, quantity, subtotal });
    }

    if (!Number.isFinite(amountPaid) || amountPaid < total) throw new Error('Enter a valid payment amount at least equal to the total.');

    const receiptNo = generateReceiptNo();
    const saleResult = await client.query(
      'INSERT INTO sales (receipt_no, user_id, total_amount, amount_paid, change_amount) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [receiptNo, userId, total, amountPaid, Math.round((amountPaid - total) * 100) / 100]
    );
    const saleId = saleResult.rows[0].id;

    for (const { product, quantity, subtotal } of resolvedItems) {
      await client.query(
        'INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity, subtotal) VALUES ($1, $2, $3, $4, $5, $6)',
        [saleId, product.id, product.name, product.selling_price, quantity, subtotal]
      );
      await client.query('UPDATE products SET stock_quantity = $1 WHERE id = $2', [
        product.stock_quantity - quantity,
        product.id,
      ]);
    }

    await client.query('COMMIT');
    return saleId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function postCheckout(req, res) {
  try {
    const items = JSON.parse(req.body.items || '[]');
    const amountPaid = Number(req.body.amount_paid);
    const saleId = await checkout(items, amountPaid, req.session.user.id);
    res.redirect(`/pos/receipt/${saleId}`);
  } catch (err) {
    setFlash(req, 'error', err.message);
    res.redirect('/pos');
  }
}

async function dailySalesReport(req, res, next) {
  const requestedDate = req.query.date || null;
  if (requestedDate && !isValidReportDate(requestedDate)) {
    setFlash(req, 'error', 'Choose a valid report date.');
    return res.redirect('/pos/daily-report');
  }

  try {
    const report = await getDailySalesReport(requestedDate, req.session.user.id);
    res.render('pos/daily_report', {
      title: 'Daily Report',
      reportPath: '/pos/daily-report',
      reportTitle: 'My daily sales report',
      receiptPath: '/pos/receipt',
      ...report,
    });
  } catch (err) {
    next(err);
  }
}

async function viewReceipt(req, res, next) {
  try {
    const { rows } = await query('SELECT * FROM sales WHERE id = $1', [req.params.id]);
    const sale = rows[0];
    if (!sale) return res.status(404).render('error', { title: 'Not Found', message: 'Receipt not found.' });
    const { rows: items } = await query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);
    res.render('pos/receipt', { title: 'Receipt', sale, items });
  } catch (err) {
    next(err);
  }
}

// ---- Inventory (view stock + submit reports) ----

async function inventoryScreen(req, res, next) {
  try {
    const [products, myReports] = await Promise.all([
      query('SELECT * FROM products WHERE active = TRUE ORDER BY name').then((r) => r.rows),
      query(
        `SELECT inventory_reports.*, products.name AS product_name
         FROM inventory_reports JOIN products ON products.id = inventory_reports.product_id
         WHERE inventory_reports.user_id = $1
         ORDER BY inventory_reports.created_at DESC LIMIT 20`,
        [req.session.user.id]
      ).then((r) => r.rows),
    ]);
    res.render('pos/inventory', { title: 'Inventory', products, myReports });
  } catch (err) {
    next(err);
  }
}

async function submitReport(productId, type, quantityChange, note, userId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
    const product = rows[0];
    if (!product) throw new Error('Product not found.');

    const newQuantity = product.stock_quantity + quantityChange;
    if (newQuantity < 0) throw new Error(`That would bring "${product.name}" below zero stock.`);

    await client.query('UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2', [
      newQuantity,
      productId,
    ]);
    await client.query(
      'INSERT INTO inventory_reports (user_id, product_id, type, quantity_change, note) VALUES ($1, $2, $3, $4, $5)',
      [userId, productId, type, quantityChange, note || null]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function postInventoryReport(req, res) {
  const { product_id, type, quantity, note } = req.body;
  const qty = Number(quantity);
  try {
    if (!Number.isFinite(qty) || qty === 0) throw new Error('Enter a non-zero quantity.');
    const signedQty = type === 'restock' ? Math.abs(qty) : -Math.abs(qty);
    await submitReport(Number(product_id), type, signedQty, note, req.session.user.id);
    setFlash(req, 'success', 'Inventory report submitted.');
  } catch (err) {
    setFlash(req, 'error', err.message);
  }
  res.redirect('/pos/inventory');
}

module.exports = {
  posScreen,
  searchProducts,
  postCheckout,
  dailySalesReport,
  viewReceipt,
  inventoryScreen,
  postInventoryReport,
};
