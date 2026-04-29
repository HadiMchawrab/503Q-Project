const state = {
  token: localStorage.getItem('shopcloud_admin_token')
};

const $ = (id) => document.getElementById(id);
const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const shortId = (id) => (id ? `${id.slice(0, 8)}...` : '-');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showMessage(text, type = 'notice') {
  const box = $('message');
  if (!box) return;
  box.className = type === 'error' ? 'notice error' : type === 'success' ? 'notice success-box' : 'notice';
  box.textContent = text;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Request failed');
  return data;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function setButtonLoading(button, isLoading, loadingText = 'Processing...') {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function setUnlocked(isUnlocked) {
  const loginPanel = document.querySelector('.admin-login-panel');
  if (loginPanel) loginPanel.style.display = isUnlocked ? 'none' : 'grid';
  ['dashboard', 'adminWorkspace', 'inventorySection', 'ordersSection'].forEach((id) => {
    const section = $(id);
    if (section) section.style.display = isUnlocked ? (id === 'adminWorkspace' ? 'grid' : 'block') : 'none';
  });
  if ($('adminLogoutBtn')) $('adminLogoutBtn').style.display = isUnlocked ? 'inline-flex' : 'none';
  if ($('refreshAdminBtn')) $('refreshAdminBtn').style.display = isUnlocked ? 'inline-flex' : 'none';
}

async function login() {
  if (!isValidEmail($('adminEmail').value)) throw new Error('Please enter a valid admin email.');
  if (!$('adminPassword').value) throw new Error('Please enter the admin password.');

  const button = $('adminLoginBtn');
  setButtonLoading(button, true, 'Signing in...');
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('adminEmail').value.trim(), password: $('adminPassword').value })
    });

    if (data.user.role !== 'admin') throw new Error('This account is not an admin account.');

    state.token = data.token;
    localStorage.setItem('shopcloud_admin_token', data.token);
    showMessage('Admin login successful.', 'success');
    await loadAdmin();
  } finally {
    setButtonLoading(button, false);
  }
}

function logout() {
  state.token = null;
  localStorage.removeItem('shopcloud_admin_token');
  setUnlocked(false);
  showMessage('Signed out.', 'notice');
}

async function loadAdmin() {
  setUnlocked(true);
  await Promise.all([loadSummary(), loadProducts(), loadOrders(), loadLowStock()]);
}

async function loadSummary() {
  const { summary } = await api('/api/admin/summary');
  const cards = [
    ['active_products', 'Active products'],
    ['total_orders', 'Total orders'],
    ['revenue_cents', 'Revenue'],
    ['low_stock_products', 'Low stock'],
    ['pending_invoices', 'Pending invoices'],
    ['orders_last_24h', 'Orders last 24h']
  ];

  $('summary').innerHTML = cards.map(([key, label]) => {
    const value = summary[key] ?? 0;
    return `
      <div class="summary-card">
        <span>${escapeHtml(label)}</span>
        <h3>${key.includes('revenue') ? money(value) : Number(value).toLocaleString()}</h3>
      </div>
    `;
  }).join('');
}

function stockLabel(stock) {
  if (stock <= 0) return '<span class="pill bad">Out</span>';
  if (stock <= 5) return '<span class="pill warn">Low</span>';
  return '<span class="pill good">OK</span>';
}

async function loadProducts() {
  const { products } = await api('/api/admin/products');
  $('products').innerHTML = `
    <table>
      <thead><tr><th>SKU</th><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Visibility</th><th>Actions</th></tr></thead>
      <tbody>
        ${products.map((p) => `
          <tr>
            <td><span class="sku">${escapeHtml(p.sku)}</span></td>
            <td><strong>${escapeHtml(p.name)}</strong><br><span class="muted">${escapeHtml(p.description).slice(0, 90)}${p.description.length > 90 ? '...' : ''}</span></td>
            <td>${escapeHtml(p.category)}</td>
            <td><strong>${money(p.price_cents)}</strong></td>
            <td>${Number(p.stock)} ${stockLabel(p.stock)}</td>
            <td>${p.is_active ? '<span class="pill good">Active</span>' : '<span class="pill neutral">Hidden</span>'}</td>
            <td>
              <div class="action-row">
                <input data-stock-id="${p.id}" value="${Number(p.stock)}" type="number" min="0" aria-label="Stock for ${escapeHtml(p.name)}" />
                <button data-save-stock="${p.id}" type="button">Save</button>
                <button data-toggle-active="${p.id}" data-active="${p.is_active}" type="button">${p.is_active ? 'Hide' : 'Show'}</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  $('products').querySelectorAll('button[data-save-stock]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const id = button.dataset.saveStock;
        const input = $('products').querySelector(`input[data-stock-id="${id}"]`);
        await api(`/api/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify({ stock: Number(input.value) }) });
        showMessage('Stock updated.', 'success');
        await Promise.all([loadProducts(), loadSummary(), loadLowStock()]);
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });
  });

  $('products').querySelectorAll('button[data-toggle-active]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const id = button.dataset.toggleActive;
        const isActive = button.dataset.active === 'true';
        await api(`/api/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !isActive }) });
        showMessage(isActive ? 'Product hidden from storefront.' : 'Product restored to storefront.', 'success');
        await Promise.all([loadProducts(), loadSummary(), loadLowStock()]);
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });
  });
}

async function loadLowStock() {
  const { products } = await api('/api/admin/products?lowStock=true');
  const container = $('lowStock');
  container.innerHTML = '';
  if (!products.length) {
    container.innerHTML = '<div class="empty-state">No low-stock items right now.</div>';
    return;
  }

  products.slice(0, 8).forEach((product) => {
    const card = document.createElement('div');
    card.className = 'low-stock-card';
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(product.name)}</strong><br />
        <span class="sku">${escapeHtml(product.sku)}</span><br />
        <span class="muted">${escapeHtml(product.category)}</span>
      </div>
      <span class="pill ${product.stock <= 0 ? 'bad' : 'warn'}">${Number(product.stock)} left</span>
    `;
    container.appendChild(card);
  });
}

async function loadOrders() {
  const status = $('orderStatusFilter').value;
  const { orders } = await api(`/api/admin/orders${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  if (!orders.length) {
    $('orders').innerHTML = '<div class="empty-state">No orders found.</div>';
    $('orderDetails').innerHTML = '';
    return;
  }

  $('orders').innerHTML = `
    <table>
      <thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Invoice</th><th>Items</th><th>Date</th><th>Actions</th></tr></thead>
      <tbody>
        ${orders.map((o) => `
          <tr>
            <td><strong>${escapeHtml(shortId(o.id))}</strong></td>
            <td>${escapeHtml(o.customer_name)}<br><span class="muted">${escapeHtml(o.customer_email)}</span></td>
            <td><strong>${money(o.total_cents)}</strong></td>
            <td><span class="pill ${o.status === 'cancelled' ? 'bad' : o.status === 'shipped' ? 'good' : 'neutral'}">${escapeHtml(o.status)}</span></td>
            <td><span class="pill ${o.invoice_status === 'sent' ? 'good' : 'warn'}">${escapeHtml(o.invoice_status)}</span></td>
            <td>${Number(o.item_lines || 0)}</td>
            <td>${new Date(o.created_at).toLocaleString()}</td>
            <td>
              <div class="action-row">
                <button data-view-order="${o.id}" type="button">View</button>
                <select data-status-for="${o.id}">
                  ${['confirmed', 'processing', 'shipped', 'cancelled'].map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
                <button data-update-status="${o.id}" type="button">Update</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  $('orders').querySelectorAll('button[data-view-order]').forEach((button) => {
    button.addEventListener('click', () => loadOrderDetails(button.dataset.viewOrder).catch((error) => showMessage(error.message, 'error')));
  });

  $('orders').querySelectorAll('button[data-update-status]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const id = button.dataset.updateStatus;
        const statusInput = $('orders').querySelector(`select[data-status-for="${id}"]`);
        await api(`/api/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: statusInput.value }) });
        showMessage('Order status updated.', 'success');
        await Promise.all([loadOrders(), loadSummary()]);
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });
  });
}

async function loadOrderDetails(id) {
  const { order } = await api(`/api/admin/orders/${id}`);
  $('orderDetails').innerHTML = `
    <div class="order-detail">
      <div class="section-heading">
        <div>
          <span class="eyebrow dark"><span></span> Order detail</span>
          <h2>Order ${escapeHtml(shortId(order.id))}</h2>
          <p>${escapeHtml(order.customer_name)} · ${escapeHtml(order.customer_email)} · ${escapeHtml(order.shipping_address)}</p>
        </div>
        <strong class="price">${money(order.total_cents)}</strong>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Product</th><th>Quantity</th><th>Unit price</th><th>Line total</th></tr></thead>
          <tbody>
            ${order.items.map((item) => `
              <tr>
                <td>${escapeHtml(item.product_name)}</td>
                <td>${Number(item.quantity)}</td>
                <td>${money(item.unit_price_cents)}</td>
                <td>${money(item.line_total_cents)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function validateProductForm() {
  const sku = $('sku').value.trim();
  const name = $('name').value.trim();
  const category = $('category').value.trim();
  const price = $('price').value.trim();
  const stock = Number($('stock').value);
  const description = $('description').value.trim();

  if (!sku) throw new Error('SKU is required.');
  if (!name) throw new Error('Product name is required.');
  if (!category) throw new Error('Category is required.');
  if (!price || Number.isNaN(Number(price)) || Number(price) < 0) throw new Error('Enter a valid price.');
  if (!Number.isInteger(stock) || stock < 0) throw new Error('Enter a valid stock quantity.');
  if (!description) throw new Error('Description is required.');
}

function fillSampleProduct() {
  const unique = Date.now().toString().slice(-5);
  $('sku').value = `ACC-${unique}`;
  $('name').value = 'Cloud Dock Pro';
  $('category').value = 'Accessories';
  $('price').value = '149.00';
  $('stock').value = '25';
  $('imageUrl').value = 'https://images.unsplash.com/photo-1625948515291-69613efd103f';
  $('description').value = 'Premium USB-C dock with HDMI, Ethernet, and fast charging support for modern workstations.';
  showMessage('Sample product filled. Click Add item to create it.', 'notice');
}

function setupAdminAuthPolish() {
  document.querySelectorAll('[data-toggle-password]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = $(button.dataset.togglePassword);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      button.textContent = isPassword ? 'Hide' : 'Show';
    });
  });

  $('fillAdminBtn')?.addEventListener('click', () => {
    $('adminEmail').value = 'admin@shopcloud.local';
    $('adminPassword').value = 'Admin123!';
    showMessage('Demo admin credentials loaded. Click Sign in.', 'notice');
  });

  ['adminEmail', 'adminPassword'].forEach((id) => {
    $(id)?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        $('adminLoginBtn').click();
      }
    });
  });
}

function setupEvents() {
  $('adminLoginBtn').addEventListener('click', () => login().catch((error) => showMessage(error.message, 'error')));
  $('adminLogoutBtn').addEventListener('click', logout);
  $('refreshAdminBtn').addEventListener('click', () => loadAdmin().catch((error) => showMessage(error.message, 'error')));
  $('reloadProductsBtn').addEventListener('click', () => loadProducts().catch((error) => showMessage(error.message, 'error')));
  $('loadLowStockBtn').addEventListener('click', () => loadLowStock().catch((error) => showMessage(error.message, 'error')));
  $('orderStatusFilter').addEventListener('change', () => loadOrders().catch((error) => showMessage(error.message, 'error')));
  $('sampleProductBtn').addEventListener('click', fillSampleProduct);

  $('createProductBtn').addEventListener('click', async () => {
    const button = $('createProductBtn');
    try {
      validateProductForm();
      setButtonLoading(button, true, 'Adding...');
      await api('/api/admin/products', {
        method: 'POST',
        body: JSON.stringify({
          sku: $('sku').value.trim(),
          name: $('name').value.trim(),
          category: $('category').value.trim(),
          price: $('price').value.trim(),
          stock: Number($('stock').value),
          imageUrl: $('imageUrl').value.trim() || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3',
          description: $('description').value.trim()
        })
      });
      ['sku', 'name', 'category', 'price', 'stock', 'imageUrl', 'description'].forEach((id) => { $(id).value = ''; });
      showMessage('Item added to the catalog and storefront.', 'success');
      await Promise.all([loadProducts(), loadSummary(), loadLowStock()]);
      $('inventorySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });
}

setUnlocked(false);
setupAdminAuthPolish();
setupEvents();

if (state.token) {
  loadAdmin().catch(() => {
    localStorage.removeItem('shopcloud_admin_token');
    state.token = null;
    setUnlocked(false);
  });
}
