const { query } = require('../config/db');

function isValidReportDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

async function getDailySalesReport(requestedDate, userId = null) {
  if (requestedDate && !isValidReportDate(requestedDate)) throw new Error('Choose a valid report date.');

  const userClause = userId === null ? '' : 'AND sales.user_id = $2';
  const params = userId === null ? [requestedDate || null] : [requestedDate || null, userId];
  const [summary, items, sales] = await Promise.all([
    query(
      `SELECT to_char(COALESCE($1::date, CURRENT_DATE), 'YYYY-MM-DD') AS report_date,
              COALESCE(SUM(total_amount), 0) AS total,
              COUNT(*) AS transaction_count,
              COALESCE(SUM(amount_paid), 0) AS amount_paid,
              COALESCE(SUM(change_amount), 0) AS change_given,
              COALESCE(AVG(total_amount), 0) AS average_sale
       FROM sales
       WHERE created_at >= COALESCE($1::date, CURRENT_DATE)
         AND created_at < COALESCE($1::date, CURRENT_DATE) + INTERVAL '1 day'
         ${userClause}`,
      params
    ).then((r) => r.rows[0]),
    query(
      `SELECT sale_items.product_name, SUM(sale_items.quantity) AS units_sold,
              SUM(sale_items.subtotal) AS revenue
       FROM sale_items
       JOIN sales ON sales.id = sale_items.sale_id
       WHERE sales.created_at >= COALESCE($1::date, CURRENT_DATE)
         AND sales.created_at < COALESCE($1::date, CURRENT_DATE) + INTERVAL '1 day'
         ${userClause}
       GROUP BY sale_items.product_id, sale_items.product_name
       ORDER BY units_sold DESC, sale_items.product_name`,
      params
    ).then((r) => r.rows),
    query(
      `SELECT sales.id, sales.receipt_no, sales.total_amount, sales.amount_paid, sales.change_amount,
              sales.created_at, users.full_name AS cashier,
              COALESCE(SUM(sale_items.quantity), 0) AS units_sold
       FROM sales
       JOIN users ON users.id = sales.user_id
       LEFT JOIN sale_items ON sale_items.sale_id = sales.id
       WHERE sales.created_at >= COALESCE($1::date, CURRENT_DATE)
         AND sales.created_at < COALESCE($1::date, CURRENT_DATE) + INTERVAL '1 day'
         ${userClause}
       GROUP BY sales.id, users.full_name
       ORDER BY sales.created_at DESC`,
      params
    ).then((r) => r.rows),
  ]);
  return { summary, items, sales };
}

module.exports = { getDailySalesReport, isValidReportDate };
