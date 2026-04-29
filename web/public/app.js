const state = {
  token: localStorage.getItem('shopcloud_token'),
  user: JSON.parse(localStorage.getItem('shopcloud_user') || 'null'),
  categories: [],
  products: [],
  cart: { items: [], total_cents: 0, item_count: 0 }
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

function userInitials(user) {
  if (!user?.name) return 'SC';
  return user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function persistAuth(user, token) {
  state.user = user;
  state.token = token;
  localStorage.setItem('shopcloud_user', JSON.stringify(user));
  localStorage.setItem('shopcloud_token', token);
  renderUser();
}

function switchAuthTab(panelId) {
  document.querySelectorAll('[data-auth-tab]').forEach((item) => {
    item.classList.toggle('active', item.dataset.authTab === panelId);
  });
  document.querySelectorAll('.auth-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === panelId);
  });
}

function renderUser() {
  const signedIn = Boolean(state.user);
  if ($('sideUserStatus')) $('sideUserStatus').textContent = signedIn ? state.user.name : 'Browsing as a guest';
  if ($('sideSessionHint')) $('sideSessionHint').textContent = signedIn
    ? `${state.user.email} is signed in. You can add items, checkout, and view order history.`
    : 'Sign in or register to add products to your cart and place an order.';
  if ($('identityAvatar')) $('identityAvatar').textContent = userInitials(state.user);
  if ($('logoutBtn')) $('logoutBtn').style.display = signedIn ? 'inline-flex' : 'none';
  if (signedIn) switchAuthTab('signedInPanel');
}

function updateCartBadge(count = 0) {
  if ($('cartBadge')) $('cartBadge').textContent = String(count || 0);
}

function stockPill(stock) {
  if (stock <= 0) return '<span class="pill bad stock-pill">Out of stock</span>';
  if (stock <= 5) return '<span class="pill warn stock-pill">Low stock</span>';
  return '<span class="pill good stock-pill">In stock</span>';
}

function categoryValue(item) {
  return typeof item === 'string' ? item : item.category;
}

function productInitials(product) {
  const source = product?.category || product?.name || 'SC';
  return String(source).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function safeImageUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (value.includes('images.unsplash.com') && !value.includes('?')) {
    return `${value}?auto=format&fit=crop&w=900&q=80`;
  }
  return value;
}

function attachImageFallback(scope) {
  scope.querySelectorAll('img[data-fallback]').forEach((image) => {
    image.addEventListener('error', () => {
      const wrap = image.closest('.product-image-wrap, .cart-thumb-wrap');
      if (wrap) wrap.classList.add('image-fallback');
      image.remove();
    }, { once: true });
  });
}

async function loadCategories() {
  const data = await api('/api/catalog/categories');
  state.categories = data.categories || [];
  const select = $('categoryFilter');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">All categories</option>' + state.categories.map((item) => {
    const category = categoryValue(item);
    const count = typeof item === 'string' ? '' : ` (${item.products})`;
    return `<option value="${escapeHtml(category)}">${escapeHtml(category)}${count}</option>`;
  }).join('');
  select.value = current;
  renderCategoryChips();
}

function renderCategoryChips() {
  const chips = $('categoryChips');
  const select = $('categoryFilter');
  if (!chips || !select) return;
  const current = select.value;
  chips.innerHTML = `<button class="category-chip${current === '' ? ' active' : ''}" data-category="">All</button>` + state.categories.map((item) => {
    const category = categoryValue(item);
    return `<button class="category-chip${current === category ? ' active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`;
  }).join('');

  chips.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      select.value = button.dataset.category;
      renderCategoryChips();
      loadProducts().catch((error) => showMessage(error.message, 'error'));
    });
  });
}

function getProductQuery() {
  const params = new URLSearchParams();
  const search = $('searchInput').value.trim();
  const category = $('categoryFilter').value;
  const sort = $('sortSelect').value;
  const inStock = $('inStockOnly').checked;
  if (search) params.set('search', search);
  if (category) params.set('category', category);
  if (sort) params.set('sort', sort);
  if (inStock) params.set('inStock', 'true');
  return params.toString();
}

async function loadProducts() {
  const query = getProductQuery();
  const data = await api(`/api/catalog/products${query ? `?${query}` : ''}`);
  state.products = data.products || [];
  const count = data.count ?? state.products.length;
  if ($('productCount')) $('productCount').textContent = `${count} product${count === 1 ? '' : 's'}`;
  renderProducts(state.products);
  renderCategoryChips();
}

function renderProducts(products) {
  const container = $('products');
  container.innerHTML = '';

  if (!products.length) {
    container.innerHTML = '<div class="empty-state">No products match the current filters.</div>';
    return;
  }

  products.forEach((product) => {
    const card = document.createElement('article');
    card.className = 'product-card';
    const buttonText = state.token ? 'Add' : 'Sign in';
    const imageUrl = safeImageUrl(product.image_url);
    card.innerHTML = `
      <div class="product-image-wrap${imageUrl ? '' : ' image-fallback'}">
        <div class="product-fallback" aria-hidden="true">
          <span>${escapeHtml(productInitials(product))}</span>
          <small>${escapeHtml(product.category || 'Product')}</small>
        </div>
        ${imageUrl ? `<img data-fallback="true" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" />` : ''}
        ${stockPill(product.stock)}
      </div>
      <div class="product-body">
        <div class="row product-meta">
          <span class="badge">${escapeHtml(product.category)}</span>
          <span class="sku">${escapeHtml(product.sku)}</span>
        </div>
        <h3>${escapeHtml(product.name)}</h3>
        <p class="muted product-description">${escapeHtml(product.description)}</p>
        <div class="product-card-footer">
          <div>
            <span class="price">${money(product.price_cents)}</span><br />
            <span class="muted">${Number(product.stock)} available</span>
          </div>
          <button ${product.stock <= 0 ? 'disabled' : ''} type="button">${buttonText}</button>
        </div>
      </div>
    `;
    attachImageFallback(card);
    card.querySelector('button').addEventListener('click', () => addToCart(product.id));
    container.appendChild(card);
  });
}

function calculateLocalLine(item) {
  return Number(item.price_cents || 0) * Number(item.quantity || 0);
}

async function loadCart() {
  if (!state.token) {
    state.cart = { items: [], total_cents: 0, item_count: 0 };
    $('cart').innerHTML = '<div class="empty-state">Sign in to start building your cart.</div>';
    updateCartBadge(0);
    return;
  }
  const data = await api('/api/cart/');
  state.cart = data.cart;
  renderCart(data.cart);
}

function renderCart(cart) {
  const container = $('cart');
  container.innerHTML = '';
  updateCartBadge(cart.item_count || 0);

  if (!cart.items.length) {
    container.innerHTML = '<div class="empty-state">Your cart is empty.</div>';
    return;
  }

  cart.items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'cart-row';
    const imageUrl = safeImageUrl(item.image_url);
    row.innerHTML = `
      <div class="cart-thumb-wrap${imageUrl ? '' : ' image-fallback'}">
        <div class="product-fallback" aria-hidden="true"><span>${escapeHtml(productInitials(item))}</span></div>
        ${imageUrl ? `<img data-fallback="true" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" />` : ''}
      </div>
      <div>
        <strong>${escapeHtml(item.name)}</strong><br />
        <span class="sku">${escapeHtml(item.sku)}</span><br />
        <span class="muted">${money(item.price_cents)} each · ${money(calculateLocalLine(item))}</span>
      </div>
      <div class="cart-actions">
        <input type="number" min="0" value="${Number(item.quantity)}" aria-label="Quantity for ${escapeHtml(item.name)}" />
        <button class="danger" type="button">Remove</button>
      </div>
    `;
    attachImageFallback(row);
    row.querySelector('input').addEventListener('change', async (event) => {
      try {
        await api(`/api/cart/items/${item.product_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantity: Number(event.target.value) })
        });
        await loadCart();
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });
    row.querySelector('button').addEventListener('click', async () => {
      try {
        await api(`/api/cart/items/${item.product_id}`, { method: 'DELETE' });
        await loadCart();
        showMessage('Item removed from cart.', 'success');
      } catch (error) {
        showMessage(error.message, 'error');
      }
    });
    container.appendChild(row);
  });

  const total = document.createElement('div');
  total.className = 'row total-row';
  total.innerHTML = `<strong>Total</strong><strong class="price">${money(cart.total_cents)}</strong>`;
  container.appendChild(total);
}

async function loadOrders() {
  const container = $('orders');
  if (!state.token) {
    container.innerHTML = '<div class="empty-state">Sign in to view your order history.</div>';
    return;
  }

  const data = await api('/api/checkout/orders');
  const orders = data.orders || [];
  container.innerHTML = '';

  if (!orders.length) {
    container.innerHTML = '<div class="empty-state">No orders yet.</div>';
    return;
  }

  orders.forEach((order) => {
    const card = document.createElement('div');
    card.className = 'order-card';
    const invoiceClass = order.invoice_status === 'sent' ? 'good' : 'warn';
    const statusClass = order.status === 'cancelled' ? 'bad' : order.status === 'shipped' ? 'good' : 'neutral';
    card.innerHTML = `
      <div class="row">
        <div>
          <h3>Order ${escapeHtml(shortId(order.id))}</h3>
          <p class="muted">${new Date(order.created_at).toLocaleString()}</p>
        </div>
        <strong class="price">${money(order.total_cents)}</strong>
      </div>
      <div class="action-row">
        <span class="pill ${statusClass}">${escapeHtml(order.status)}</span>
        <span class="pill ${invoiceClass}">Invoice ${escapeHtml(order.invoice_status)}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

async function addToCart(productId) {
  if (!state.token) {
    showMessage('Sign in first to add this item to your cart.', 'error');
    $('account')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  try {
    await api('/api/cart/items', { method: 'POST', body: JSON.stringify({ productId, quantity: 1 }) });
    await loadCart();
    showMessage('Added to cart.', 'success');
  } catch (error) {
    showMessage(error.message, 'error');
  }
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

function passwordScore(password) {
  let score = 0;
  if ((password || '').length >= 8) score += 1;
  if (/[A-Za-z]/.test(password || '')) score += 1;
  if (/\d/.test(password || '')) score += 1;
  if (/[^A-Za-z0-9]/.test(password || '')) score += 1;
  return score;
}

function updatePasswordMeter() {
  const password = $('registerPassword')?.value || '';
  const bar = $('passwordStrengthBar');
  const checklist = $('passwordChecklist');
  if (!bar || !checklist) return;
  const score = passwordScore(password);
  bar.style.width = `${Math.max(score, password ? 1 : 0) * 25}%`;

  const rules = {
    length: password.length >= 8,
    letter: /[A-Za-z]/.test(password),
    number: /\d/.test(password)
  };
  Object.entries(rules).forEach(([rule, passed]) => {
    const item = checklist.querySelector(`[data-rule="${rule}"]`);
    if (item) item.classList.toggle('passed', passed);
  });
}

function validateLoginForm() {
  if (!isValidEmail($('loginEmail').value)) throw new Error('Please enter a valid email address.');
  if (!$('loginPassword').value) throw new Error('Please enter your password.');
}

function validateRegisterForm() {
  const name = $('registerName').value.trim();
  const email = $('registerEmail').value.trim();
  const password = $('registerPassword').value;
  const confirmPassword = $('registerConfirmPassword')?.value || '';
  const accepted = $('acceptTerms')?.checked;

  if (name.length < 2) throw new Error('Please enter your full name.');
  if (!isValidEmail(email)) throw new Error('Please enter a valid email address.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error('Password should include at least one letter and one number.');
  if (password !== confirmPassword) throw new Error('Passwords do not match.');
  if (!accepted) throw new Error('Please confirm the local demo account notice.');
}

function setupPasswordControls() {
  document.querySelectorAll('[data-toggle-password]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = $(button.dataset.togglePassword);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      button.textContent = isPassword ? 'Hide' : 'Show';
    });
  });
  $('registerPassword')?.addEventListener('input', updatePasswordMeter);
}

function setupAuthHelpers() {
  $('quickCustomerBtn')?.addEventListener('click', () => {
    const unique = Date.now().toString().slice(-6);
    switchAuthTab('registerPanel');
    $('registerName').value = 'Mansour Allam';
    $('registerEmail').value = `mansour.customer.${unique}@shopcloud.local`;
    $('registerPassword').value = 'Customer123!';
    $('registerConfirmPassword').value = 'Customer123!';
    $('acceptTerms').checked = true;
    updatePasswordMeter();
    showMessage('Test customer details filled. Click Create account.', 'notice');
  });

  ['loginEmail', 'loginPassword', 'registerName', 'registerEmail', 'registerPassword', 'registerConfirmPassword'].forEach((id) => {
    $(id)?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (id.startsWith('login')) $('loginBtn').click();
      else $('registerBtn').click();
    });
  });
}

function setupAuthTabs() {
  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.addEventListener('click', () => switchAuthTab(button.dataset.authTab));
  });
}

function setupEventListeners() {
  $('registerBtn').addEventListener('click', async () => {
    const button = $('registerBtn');
    try {
      validateRegisterForm();
      setButtonLoading(button, true, 'Creating account...');
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: $('registerName').value.trim(),
          email: $('registerEmail').value.trim(),
          password: $('registerPassword').value
        })
      });
      persistAuth(data.user, data.token);
      showMessage('Account created. You can now add products to your cart.', 'success');
      await Promise.all([loadCart(), loadOrders(), loadProducts()]);
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });

  $('loginBtn').addEventListener('click', async () => {
    const button = $('loginBtn');
    try {
      validateLoginForm();
      setButtonLoading(button, true, 'Signing in...');
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: $('loginEmail').value.trim(), password: $('loginPassword').value })
      });
      persistAuth(data.user, data.token);
      showMessage('Signed in. You can now shop and checkout.', 'success');
      await Promise.all([loadCart(), loadOrders(), loadProducts()]);
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });

  $('logoutBtn').addEventListener('click', () => {
    state.user = null;
    state.token = null;
    localStorage.removeItem('shopcloud_user');
    localStorage.removeItem('shopcloud_token');
    renderUser();
    switchAuthTab('loginPanel');
    loadCart();
    loadOrders();
    loadProducts();
    showMessage('Signed out.', 'notice');
  });

  $('clearCartBtn').addEventListener('click', async () => {
    try {
      if (!state.token) throw new Error('Sign in first.');
      await api('/api/cart/', { method: 'DELETE' });
      await loadCart();
      showMessage('Cart cleared.', 'success');
    } catch (error) {
      showMessage(error.message, 'error');
    }
  });

  $('checkoutBtn').addEventListener('click', async () => {
    const button = $('checkoutBtn');
    try {
      if (!state.token) throw new Error('Please sign in before checkout.');
      if (!state.cart.items.length) throw new Error('Your cart is empty.');
      setButtonLoading(button, true, 'Placing order...');
      const data = await api('/api/checkout/', {
        method: 'POST',
        body: JSON.stringify({ shippingAddress: $('shippingAddress').value })
      });
      showMessage(`${data.message} Order ID: ${data.order.id}`, 'success');
      await Promise.all([loadProducts(), loadCart(), loadOrders()]);
      $('ordersSection')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });

  let searchTimer;
  $('searchInput').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadProducts().catch((error) => showMessage(error.message, 'error')), 250);
  });
  $('categoryFilter').addEventListener('change', () => loadProducts().catch((error) => showMessage(error.message, 'error')));
  $('sortSelect').addEventListener('change', () => loadProducts().catch((error) => showMessage(error.message, 'error')));
  $('inStockOnly').addEventListener('change', () => loadProducts().catch((error) => showMessage(error.message, 'error')));
  $('refreshOrdersBtn').addEventListener('click', () => loadOrders().catch((error) => showMessage(error.message, 'error')));
  $('viewCartBtn')?.addEventListener('click', () => $('cartSection').scrollIntoView({ behavior: 'smooth' }));
}

setupAuthTabs();
setupPasswordControls();
setupAuthHelpers();
setupEventListeners();
updatePasswordMeter();
renderUser();
async function initializeStorefront() {
  try {
    await loadCategories();
  } catch (error) {
    showMessage(error.message, 'error');
  }

  try {
    await loadProducts();
  } catch (error) {
    if ($('productCount')) $('productCount').textContent = 'Products unavailable';
    if ($('products')) $('products').innerHTML = '<div class="empty-state">Products could not be loaded. Refresh the page once the services are ready.</div>';
    showMessage(error.message, 'error');
  }

  loadCart().catch(console.error);
  loadOrders().catch(console.error);
}

initializeStorefront();
