import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'

export default function Header({ onSearch }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  const { count, setIsOpen } = useCart()

  const [query, setQuery] = useState('')
  const [showAccount, setShowAccount] = useState(false)
  const accountRef = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (accountRef.current && !accountRef.current.contains(e.target)) {
        setShowAccount(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSearch = useCallback((e) => {
    e.preventDefault()
    onSearch?.(query.trim())
    if (location.pathname !== '/') navigate('/')
  }, [query, onSearch, navigate, location.pathname])

  const handleQueryChange = useCallback((e) => {
    const value = e.target.value
    setQuery(value)
    onSearch?.(value.trim())
    if (location.pathname !== '/') navigate('/')
  }, [onSearch, navigate, location.pathname])

  const firstName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'Guest'

  return (
    <header className="hdr">
      {/* ── Logo ── */}
      <button className="hdr-logo" onClick={() => navigate('/')}>
        <img src="/logo.svg" alt="503Q" className="hdr-logo-img" />
        <span className="hdr-logo-text">503<span>Q</span></span>
      </button>

      {/* ── Search ── */}
      <form className="hdr-search" onSubmit={handleSearch}>
        <input
          type="text"
          className="hdr-search-input"
          placeholder="Search products, categories, brands..."
          value={query}
          onChange={handleQueryChange}
        />
        <button type="submit" className="hdr-search-btn" aria-label="Search">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </button>
      </form>

      {/* ── Right side ── */}
      <div className="hdr-right">
        {/* Account */}
        <div
          className="hdr-account"
          ref={accountRef}
          onMouseEnter={() => setShowAccount(true)}
          onMouseLeave={() => setShowAccount(false)}
        >
          <button
            className="hdr-btn"
            onClick={() => navigate(user ? '/account/orders' : '/account')}
          >
            <span className="hdr-btn-top">Hello, {firstName}</span>
            <span className="hdr-btn-main">Account &amp; Orders</span>
          </button>

          {showAccount && (
            <div className="hdr-dropdown">
              {user ? (
                <>
                  <div className="hdr-dropdown-name">{user.name || user.email}</div>
                  <a className="hdr-dropdown-item" onClick={() => { navigate('/account/orders'); setShowAccount(false) }}>
                    Your Orders
                  </a>
                  <a className="hdr-dropdown-item" onClick={() => { navigate('/account/payment'); setShowAccount(false) }}>
                    Payment History
                  </a>
                  <a className="hdr-dropdown-item" onClick={() => { navigate('/account/settings'); setShowAccount(false) }}>
                    Login &amp; Security
                  </a>
                  <hr className="hdr-dropdown-divider" />
                  <a className="hdr-dropdown-item hdr-dropdown-item--danger" onClick={() => { logout(); setShowAccount(false) }}>
                    Sign Out
                  </a>
                </>
              ) : (
                <>
                  <button
                    className="hdr-dropdown-signin"
                    onClick={() => { navigate('/account'); setShowAccount(false) }}
                  >
                    Sign In
                  </button>
                  <p className="hdr-dropdown-hint">New customer? <a onClick={() => { navigate('/account'); setShowAccount(false) }}>Start here.</a></p>
                  <hr className="hdr-dropdown-divider" />
                  <div className="hdr-dropdown-section">Your Account</div>
                  <a className="hdr-dropdown-item" onClick={() => { navigate('/account/orders'); setShowAccount(false) }}>
                    Your Orders
                  </a>
                  <a className="hdr-dropdown-item" onClick={() => { navigate('/account/payment'); setShowAccount(false) }}>
                    Payment History
                  </a>
                  <a className="hdr-dropdown-item" onClick={() => { navigate('/account/settings'); setShowAccount(false) }}>
                    Account Settings
                  </a>
                </>
              )}
            </div>
          )}
        </div>

        {/* Cart */}
        <button className="hdr-btn hdr-cart-btn" onClick={() => setIsOpen(true)}>
          <div className="hdr-cart-icon">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            {count > 0 && <span className="hdr-cart-badge">{count > 99 ? '99+' : count}</span>}
          </div>
          <span className="hdr-btn-main">Cart</span>
        </button>
      </div>
    </header>
  )
}
