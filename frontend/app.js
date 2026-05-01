const state = {
  token: localStorage.getItem('shopcloud_token'),
  refreshToken: localStorage.getItem('shopcloud_refresh'),
  user: JSON.parse(localStorage.getItem('shopcloud_user') || 'null'),
  categories: [],
  products: [],
  cart: { items: [], total_cents: 0, item_count: 0 }
};

const $ = (id) => document.getElementById(id);
const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const shortId = (id) => (id ? `${id.slice(0, 8)}...` : '-');
const PRODUCT_PHOTOS = {
  '/assets/products/cloudbook-pro.svg': 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8',
  '/assets/products/cloudbook-air.svg': 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853',
  '/assets/products/nimbus-phone-x.svg': 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9',
  '/assets/products/nimbus-phone-mini.svg': 'https://images.unsplash.com/photo-1598327105666-5b89351aff97',
  '/assets/products/securekey.svg': 'https://images.unsplash.com/photo-1563986768609-322da13575f3',
  '/assets/products/dock-station.svg': 'https://images.unsplash.com/photo-1625948515291-69613efd103f',
  '/assets/products/echopods.svg': 'https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1',
  '/assets/products/headphones.svg': 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e',
  '/assets/products/monitor-27.svg': 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf',
  '/assets/products/monitor-34.svg': 'https://images.unsplash.com/photo-1547082299-de196ea013d6',
  '/assets/products/backpack.svg': 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62',
  '/assets/products/mesh-wifi.svg': 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8'
};

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

async function rawFetch(path, options) {
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
}

let refreshInFlight = null;

async function tryRefresh() {
  // Coalesce concurrent 401s onto a single refresh round-trip.
  if (!state.refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = Cognito.refresh('customer', state.refreshToken)
      .then((result) => {
        persistAuth(result.user, result.token, result.expiresAt, result.refreshToken);
        return true;
      })
      .catch(() => {
        clearAuth();
        return false;
      })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function api(path, options = {}) {
  let response = await rawFetch(path, options);
  if (response.status === 401 && state.refreshToken) {
    const refreshed = await tryRefresh();
    if (refreshed) response = await rawFetch(path, options);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Request failed');
  return data;
}

function userInitials(user) {
  if (!user?.name) return 'SC';
  return user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function persistAuth(user, token, expiresAt, refreshToken) {
  state.user = user;
  state.token = token;
  localStorage.setItem('shopcloud_user', JSON.stringify(user));
  localStorage.setItem('shopcloud_token', token);
  if (expiresAt) localStorage.setItem('shopcloud_token_exp', String(expiresAt));
  if (refreshToken) {
    state.refreshToken = refreshToken;
    localStorage.setItem('shopcloud_refresh', refreshToken);
  }
  renderUser();
}

function clearAuth() {
  state.user = null;
  state.token = null;
  state.refreshToken = null;
  localStorage.removeItem('shopcloud_user');
  localStorage.removeItem('shopcloud_token');
  localStorage.removeItem('shopcloud_token_exp');
  localStorage.removeItem('shopcloud_refresh');
  renderUser();
}

function renderUser() {
  const signedIn = Boolean(state.user);
  if ($('sideUserStatus')) $('sideUserStatus').textContent = signedIn ? state.user.name : 'Browsing as a guest';
  if ($('sideSessionHint')) $('sideSessionHint').textContent = signedIn
    ? `${state.user.email} is signed in. You can add items, checkout, and view order history.`
    : 'Sign in or register to add products to your cart and place an order.';
  if ($('identityAvatar')) $('identityAvatar').textContent = userInitials(state.user);
  if ($('logoutBtn')) $('logoutBtn').style.display = signedIn ? 'inline-flex' : 'none';
  if ($('signInBtn')) $('signInBtn').style.display = signedIn ? 'none' : 'inline-flex';
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
  const rawValue = String(url || '').trim();
  const value = PRODUCT_PHOTOS[rawValue] || rawValue;
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
    showMessage('Sign in to add this item to your cart.', 'error');
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

async function localAuthRequest(endpoint) {
  const email = $('localEmail').value.trim();
  const password = $('localPassword').value;
  if (!email || !password) throw new Error('Email and password required.');
  const data = await api(`/api/auth/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify({ email, password, name: email.split('@')[0] }),
  });
  // Local mode tokens have no refresh — pass null so we don't try to refresh.
  persistAuth(data.user, data.token, Date.now() + (8 * 60 * 60 * 1000), null);
  showMessage('Signed in.', 'success');
  await Promise.all([loadCart(), loadOrders(), loadProducts()]);
}

function setupEventListeners() {
  // Cognito mode — single Sign-in button kicks off the OAuth redirect.
  $('signInBtn')?.addEventListener('click', () => {
    Cognito.startLogin('customer').catch((error) => showMessage(error.message, 'error'));
  });

  // Local dev mode — direct POST to /login or /register.
  $('localSignInBtn')?.addEventListener('click', () => {
    localAuthRequest('login').catch((error) => showMessage(error.message, 'error'));
  });
  $('localRegisterBtn')?.addEventListener('click', () => {
    localAuthRequest('register').catch((error) => showMessage(error.message, 'error'));
  });

  $('logoutBtn')?.addEventListener('click', async () => {
    const wasLocalMode = (await Cognito.getMode().catch(() => 'cognito')) === 'local';
    clearAuth();
    if (wasLocalMode) {
      showMessage('Signed out.', 'notice');
      await Promise.all([loadCart(), loadOrders(), loadProducts()]);
    } else {
      Cognito.logout('customer', '/');
    }
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

setupEventListeners();
renderUser();

async function finishCognitoLoginIfReturning() {
  try {
    const result = await Cognito.completeLoginIfNeeded('customer');
    if (!result) return;
    persistAuth(result.user, result.token, result.expiresAt, result.refreshToken);
    showMessage('Signed in.', 'success');
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function applyAuthMode() {
  const mode = await Cognito.getMode().catch(() => 'cognito');
  if ($('cognitoModePanel')) $('cognitoModePanel').style.display = mode === 'cognito' ? 'block' : 'none';
  if ($('localModePanel')) $('localModePanel').style.display = mode === 'local' ? 'block' : 'none';
}

async function initializeStorefront() {
  await applyAuthMode();
  await finishCognitoLoginIfReturning();

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
