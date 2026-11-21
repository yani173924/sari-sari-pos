(function () {
  const cart = new Map(); // productId -> { id, name, price, qty, stock, unit }

  const cartBody = document.getElementById('cartBody');
  const cartTotalEl = document.getElementById('cartTotal');
  const changeEl = document.getElementById('changeAmount');
  const amountPaidInput = document.getElementById('amountPaid');
  const itemsInput = document.getElementById('itemsInput');
  const checkoutBtn = document.getElementById('checkoutBtn');
  const checkoutForm = document.getElementById('checkoutForm');
  const productGrid = document.getElementById('productGrid');
  const searchInput = document.getElementById('productSearch');
  const productMessage = document.getElementById('productMessage');
  const categoryFilters = document.querySelector('.category-filters');
  let activeCategory = 'all';

  function peso(n) {
    return '₱' + Number(n).toFixed(2);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Safe for use inside a double-quoted HTML attribute (escapes quotes too).
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  function addToCart(tile) {
    const id = tile.dataset.id;
    const stock = Number(tile.dataset.stock);
    const existing = cart.get(id);
    if (existing) {
      if (existing.qty < stock) existing.qty += 1;
    } else {
      cart.set(id, {
        id,
        name: tile.dataset.name,
        price: Number(tile.dataset.price),
        unit: tile.dataset.unit,
        stock,
        qty: 1,
      });
    }
    render();
  }

  function changeQty(id, delta) {
    const item = cart.get(id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
      cart.delete(id);
    } else if (item.qty > item.stock) {
      item.qty = item.stock;
    }
    render();
  }

  function removeItem(id) {
    cart.delete(id);
    render();
  }

  function render() {
    cartBody.innerHTML = '';
    let total = 0;

    if (cart.size === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = '<td colspan="5" class="cart-empty">Your cart is waiting for its first item.</td>';
      cartBody.appendChild(emptyRow);
    }

    cart.forEach((item) => {
      const subtotal = item.price * item.qty;
      total += subtotal;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(item.name)}</td>
        <td>${peso(item.price)}</td>
        <td class="qty-controls">
          <button type="button" data-action="dec" data-id="${item.id}" class="btn btn-small">−</button>
          ${item.qty}
          <button type="button" data-action="inc" data-id="${item.id}" class="btn btn-small">+</button>
        </td>
        <td>${peso(subtotal)}</td>
        <td><button type="button" data-action="remove" data-id="${item.id}" class="btn btn-small btn-danger">✕</button></td>
      `;
      cartBody.appendChild(tr);
    });

    cartTotalEl.textContent = peso(total);
    updateChange(total);
    checkoutBtn.disabled = cart.size === 0;
  }

  function filterProducts() {
    let visibleCount = 0;
    productGrid.querySelectorAll('.product-tile').forEach((tile) => {
      const matches = activeCategory === 'all' || tile.dataset.categoryId === activeCategory;
      tile.hidden = !matches;
      if (matches) visibleCount += 1;
    });
    productMessage.hidden = visibleCount > 0;
    if (visibleCount === 0) productMessage.textContent = 'No in-stock products found in this category.';
  }

  function updateChange(total) {
    const paid = Number(amountPaidInput.value) || 0;
    const change = paid - total;
    changeEl.textContent = peso(change >= 0 ? change : 0);
    changeEl.classList.toggle('text-danger', change < 0);
  }

  cartBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'inc') changeQty(id, 1);
    if (action === 'dec') changeQty(id, -1);
    if (action === 'remove') removeItem(id);
  });

  productGrid.addEventListener('click', (e) => {
    const tile = e.target.closest('.product-tile');
    if (tile && !tile.hidden) addToCart(tile);
  });

  categoryFilters.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-category]');
    if (!button) return;
    activeCategory = button.dataset.category;
    categoryFilters.querySelectorAll('.category-filter').forEach((filter) => {
      filter.classList.toggle('active', filter === button);
    });
    filterProducts();
  });

  amountPaidInput.addEventListener('input', () => {
    const total = Array.from(cart.values()).reduce((sum, i) => sum + i.price * i.qty, 0);
    updateChange(total);
  });

  checkoutForm.addEventListener('submit', (e) => {
    if (cart.size === 0) {
      e.preventDefault();
      return;
    }
    const items = Array.from(cart.values()).map((i) => ({ productId: Number(i.id), quantity: i.qty }));
    itemsInput.value = JSON.stringify(items);
  });

  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = searchInput.value.trim();
      try {
        const res = await fetch(`/pos/api/products?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error('Product search failed.');
        const products = await res.json();
        productGrid.innerHTML = products
          .map(
            (p) => `
        <button type="button" class="product-tile" data-id="${p.id}" data-name="${escapeAttr(p.name)}" data-price="${p.selling_price}" data-stock="${p.stock_quantity}" data-unit="${escapeAttr(p.unit)}" data-category-id="${p.category_id || ''}">
          <span class="product-name">${escapeHtml(p.name)}</span>
          <span class="product-price">${peso(p.selling_price)}</span>
          <span class="product-category">${escapeHtml(p.category_name || 'Uncategorized')}</span>
          <span class="product-stock">${p.stock_quantity} ${escapeHtml(p.unit)} left</span>
        </button>`
          )
          .join('');
        filterProducts();
      } catch (error) {
        productGrid.innerHTML = '';
        productMessage.hidden = false;
        productMessage.textContent = 'Products could not be loaded. Please try again.';
      }
    }, 250);
  });

  filterProducts();
  render();
})();
