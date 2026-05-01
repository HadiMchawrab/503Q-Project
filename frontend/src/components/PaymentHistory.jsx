import { useState, useEffect } from 'react'
import { api, money } from '../api'

export default function PaymentHistory() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.getOrders()
      .then(data => setOrders(data.orders || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="acc-spinner" />

  return (
    <div className="acc-section">
      <h2 className="acc-section-title">Payment History</h2>

      <div className="acc-notice">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
        </svg>
        Payments are processed securely. Full card numbers are never stored.
      </div>

      {error && <p className="acc-error">{error}</p>}

      {!error && orders.length === 0 ? (
        <div className="acc-empty"><p>No payment history found.</p></div>
      ) : (
        <div className="pay-table-wrap">
          <table className="pay-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Order ID</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(order => {
                const id = order.id || order.order_id
                const cancelled = order.status === 'cancelled'
                return (
                  <tr key={id}>
                    <td>
                      {new Date(order.created_at).toLocaleDateString('en-US', {
                        year: 'numeric', month: 'short', day: 'numeric',
                      })}
                    </td>
                    <td className="pay-order-id">#{id?.slice(0, 8) || id}</td>
                    <td><strong>${money(order.total_cents)}</strong></td>
                    <td>
                      <span className={`acc-badge ${cancelled ? 'badge--red' : 'badge--green'}`}>
                        {cancelled ? 'Refunded' : 'Charged'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
