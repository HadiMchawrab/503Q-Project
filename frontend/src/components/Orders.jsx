import { useState, useEffect } from 'react'
import { api, money } from '../api'

const STATUS_CLASS = {
  delivered: 'badge--green',
  shipped: 'badge--blue',
  processing: 'badge--orange',
  pending: 'badge--orange',
  cancelled: 'badge--red',
}

function StatusBadge({ status }) {
  const s = (status || 'pending').toLowerCase()
  return (
    <span className={`acc-badge ${STATUS_CLASS[s] || 'badge--orange'}`}>
      {status || 'Pending'}
    </span>
  )
}

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    api.getOrders()
      .then(data => setOrders(data.orders || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="acc-spinner" />

  if (error) return (
    <div className="acc-section">
      <h2 className="acc-section-title">Your Orders</h2>
      <div className="acc-empty"><p>Could not load orders: {error}</p></div>
    </div>
  )

  return (
    <div className="acc-section">
      <h2 className="acc-section-title">Your Orders</h2>

      {orders.length === 0 ? (
        <div className="acc-empty">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.2" strokeLinecap="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
          <p>No orders yet. Start shopping!</p>
        </div>
      ) : (
        <div className="orders-list">
          {orders.map(order => {
            const id = order.id || order.order_id
            const isOpen = expanded === id
            return (
              <div key={id} className="order-card">
                <button
                  className="order-card-hdr"
                  onClick={() => setExpanded(isOpen ? null : id)}
                >
                  <div className="order-card-left">
                    <span className="order-date">
                      {new Date(order.created_at).toLocaleDateString('en-US', {
                        year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </span>
                    <span className="order-id">Order #{id?.slice(0, 8) || id}</span>
                  </div>
                  <div className="order-card-right">
                    <span className="order-total">${money(order.total_cents)}</span>
                    <StatusBadge status={order.status} />
                    <span className="order-chevron">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="order-card-body">
                    {(order.items || []).length > 0 && (
                      <ul className="order-items">
                        {(order.items || []).map((item, i) => (
                          <li key={i} className="order-item">
                            <span className="order-item-name">{item.name || item.product_name}</span>
                            <span className="order-item-qty">× {item.quantity}</span>
                            <span className="order-item-price">
                              ${money((item.price_cents || 0) * (item.quantity || 1))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {order.invoice_status && (
                      <p className="order-invoice">
                        Invoice: <span className={`acc-badge ${order.invoice_status === 'sent' ? 'badge--green' : 'badge--orange'}`}>{order.invoice_status}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
