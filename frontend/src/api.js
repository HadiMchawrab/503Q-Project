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
  '/assets/products/mesh-wifi.svg': 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8',
}

export function resolveImage(url) {
  const raw = String(url || '').trim()
  const resolved = PRODUCT_PHOTOS[raw] || raw
  if (!resolved) return ''
  if (resolved.includes('images.unsplash.com') && !resolved.includes('?')) {
    return `${resolved}?auto=format&fit=crop&w=600&q=80`
  }
  return resolved
}

export function money(cents) {
  return (Number(cents || 0) / 100).toFixed(2)
}

async function request(path, options = {}) {
  const token = localStorage.getItem('shopcloud_token')
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error?.message || data.detail || 'Request failed')
  return data
}

export const api = {
  getProducts: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/api/catalog/products${qs ? `?${qs}` : ''}`)
  },

  getCategories: () => request('/api/catalog/categories'),

  getCart: () => request('/api/cart/'),

  addToCart: (productId, quantity = 1) =>
    request('/api/cart/items', {
      method: 'POST',
      body: JSON.stringify({ productId, quantity }),
    }),

  updateCartItem: (productId, quantity) =>
    request(`/api/cart/items/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    }),

  removeCartItem: (productId) =>
    request(`/api/cart/items/${productId}`, { method: 'DELETE' }),

  clearCart: () => request('/api/cart/', { method: 'DELETE' }),

  getOrders: () => request('/api/checkout/orders'),

  placeOrder: (shippingAddress) =>
    request('/api/checkout/', {
      method: 'POST',
      body: JSON.stringify({ shippingAddress }),
    }),

  login: (email, password) =>
    request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, name: email.split('@')[0] }),
    }),

  register: (email, password, name) =>
    request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),
}
