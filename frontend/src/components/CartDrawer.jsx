import { useState, useEffect } from 'react'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/AuthContext'
import { api, money, resolveImage } from '../api'

export default function CartDrawer() {
  const { items, count, totalCents, totalDisplay, isOpen, setIsOpen, updateItem, removeItem, clearCart, fetchCart } = useCart()
  const { user } = useAuth()

  const [view, setView] = useState('cart') // 'cart' | 'checkout'
  const [address, setAddress] = useState('Beirut Digital District, Beirut, Lebanon')
  const [placing, setPlacing] = useState(false)
  const [orderMsg, setOrderMsg] = useState(null)
  const [orderError, setOrderError] = useState(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setIsOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [setIsOpen])

  // Reset to cart view when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => {
        setView('cart')
        setOrderMsg(null)
        setOrderError(null)
      }, 300)
    }
  }, [isOpen])

  const handlePlaceOrder = async () => {
    if (!user) {
      setOrderError('Please sign in before placing an order.')
      return
    }
    if (!address.trim()) {
      setOrderError('Please enter a shipping address.')
      return
    }
    setPlacing(true)
    setOrderError(null)
    try {
      const data = await api.placeOrder(address)
      setOrderMsg(data.message || `Order placed! ID: ${data.order?.id?.slice(0, 8)}`)
      await fetchCart()
      setView('cart')
    } catch (e) {
      setOrderError(e.message)
    } finally {
      setPlacing(false)
    }
  }

  return (
    <>
      {isOpen && <div className="drawer-overlay" onClick={() => setIsOpen(false)} />}

      <aside className={`cart-drawer ${isOpen ? 'cart-drawer--open' : ''}`}>
        {/* Header */}
        <div className="cart-drawer-hdr">
          <h2>
            Shopping Cart
            {count > 0 && <span className="cart-drawer-badge">{count}</span>}
          </h2>
          <button className="cart-drawer-close" onClick={() => setIsOpen(false)} aria-label="Close cart">✕</button>
        </div>

        {/* Success message */}
        {orderMsg && (
          <div className="cart-toast cart-toast--success">
            ✓ {orderMsg}
          </div>
        )}

        {/* Body */}
        <div className="cart-drawer-body">
          {view === 'checkout' ? (
            <div className="checkout-form">
              <button className="checkout-back" onClick={() => setView('cart')}>
                ← Back to cart
              </button>
              <h3 className="checkout-title">Shipping Details</h3>

              <label className="checkout-label">Shipping Address</label>
              <textarea
                className="checkout-textarea"
                rows={4}
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="Building, street, city, country"
              />

              <div className="checkout-summary">
                <div className="checkout-summary-row">
                  <span>Items ({count})</span>
                  <span>{totalDisplay}</span>
                </div>
                <div className="checkout-summary-row checkout-summary-row--total">
                  <span>Order Total</span>
                  <strong>{totalDisplay}</strong>
                </div>
              </div>

              {orderError && <p className="checkout-error">{orderError}</p>}

              <button
                className="place-order-btn"
                onClick={handlePlaceOrder}
                disabled={placing}
              >
                {placing ? 'Placing Order...' : 'Place Order'}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="cart-empty">
              <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.2" strokeLinecap="round">
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
              <p>Your cart is empty</p>
              <button className="cart-continue-btn" onClick={() => setIsOpen(false)}>
                Continue Shopping
              </button>
            </div>
          ) : (
            <ul className="cart-items-list">
              {items.map(item => {
                const img = resolveImage(item.image_url)
                const itemTotal = `$${money((item.price_cents || 0) * (item.quantity || 1))}`
                return (
                  <li key={item.product_id} className="cart-item">
                    <div className="cart-item-img">
                      {img
                        ? <img src={img} alt={item.name} />
                        : <div className="cart-item-img-ph">{(item.name || 'P')[0]}</div>
                      }
                    </div>
                    <div className="cart-item-body">
                      <p className="cart-item-name">{item.name}</p>
                      <p className="cart-item-price">${money(item.price_cents)} each</p>
                      <div className="cart-item-controls">
                        <button className="qty-btn" onClick={() => updateItem(item.product_id, (item.quantity || 1) - 1)}>−</button>
                        <span className="qty-val">{item.quantity}</span>
                        <button className="qty-btn" onClick={() => updateItem(item.product_id, (item.quantity || 1) + 1)}>+</button>
                        <button className="cart-remove-btn" onClick={() => removeItem(item.product_id)}>Remove</button>
                      </div>
                    </div>
                    <span className="cart-item-total">{itemTotal}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        {view === 'cart' && items.length > 0 && (
          <div className="cart-drawer-footer">
            <div className="cart-subtotal">
              <span>Subtotal ({count} {count === 1 ? 'item' : 'items'}):</span>
              <strong>{totalDisplay}</strong>
            </div>
            <button className="proceed-btn" onClick={() => setView('checkout')}>
              Proceed to Checkout
            </button>
            <button className="cart-clear-btn" onClick={clearCart}>
              Clear cart
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
