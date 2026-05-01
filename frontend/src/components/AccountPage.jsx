import { useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import Orders from './Orders'
import PaymentHistory from './PaymentHistory'
import LoginSettings from './LoginSettings'

const TABS = [
  { path: '/account/orders', label: 'Your Orders', icon: '📦' },
  { path: '/account/payment', label: 'Payment History', icon: '💳' },
  { path: '/account/settings', label: 'Login & Security', icon: '🔒' },
]

// Cognito sign-in: a single button that hands off to the Cognito Hosted UI.
// Account creation, password reset, and MFA all live there — we don't roll
// our own form against the user pool. Used in 'cognito' mode only; the local
// dev mode (docker compose, MODE=local) renders LocalSignInForm instead.
function CognitoSignInPanel({ onStart, error }) {
  return (
    <div className="signin-box">
      <h2 className="signin-title">Sign in to ShopCloud</h2>
      <p className="signin-hint">
        You'll be taken to our secure sign-in page to enter your email and password.
      </p>
      {error && <p className="signin-error">{error}</p>}
      <button type="button" className="signin-submit" onClick={onStart}>
        Sign In or Create Account
      </button>
    </div>
  )
}

// Local-mode form for `docker compose up` development against the
// auth service's MODE=local fallback. Not used in any deployed environment.
function LocalSignInForm({ onSignIn }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handle = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const data = mode === 'login'
        ? await api.login(email, password)
        : await api.register(email, password, name || email.split('@')[0])
      onSignIn(data.user, data.token)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="signin-box">
      <h2 className="signin-title">{mode === 'login' ? 'Sign In (local dev)' : 'Create Account (local dev)'}</h2>
      <form onSubmit={handle} className="signin-form">
        {mode === 'register' && (
          <div className="signin-field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          </div>
        )}
        <div className="signin-field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com"
            autoComplete="email"
            required
          />
        </div>
        <div className="signin-field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
          />
        </div>
        {error && <p className="signin-error">{error}</p>}
        <button type="submit" className="signin-submit" disabled={loading}>
          {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>
      </form>
      <p className="signin-switch">
        {mode === 'login' ? (
          <>New customer? <button onClick={() => { setMode('register'); setError(null) }}>Create account</button></>
        ) : (
          <>Already have an account? <button onClick={() => { setMode('login'); setError(null) }}>Sign in</button></>
        )}
      </p>
    </div>
  )
}

export default function AccountPage() {
  const { user, mode, login, startCognitoLogin, error } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const initials = user?.name
    ? user.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
    : (user?.email?.[0] || 'U').toUpperCase()

  if (!user) {
    return (
      <div className="acc-page acc-page--guest">
        {mode === 'local' ? (
          <LocalSignInForm onSignIn={(userData, token) => {
            login(userData, token)
            navigate('/account/orders')
          }} />
        ) : (
          <CognitoSignInPanel onStart={startCognitoLogin} error={error} />
        )}
      </div>
    )
  }

  return (
    <div className="acc-page">
      {/* Sidebar */}
      <aside className="acc-sidebar">
        <div className="acc-profile">
          <div className="acc-avatar">{initials}</div>
          <div>
            <div className="acc-profile-name">{user.name || 'Customer'}</div>
            <div className="acc-profile-email">{user.email}</div>
          </div>
        </div>

        <nav className="acc-nav">
          {TABS.map(tab => (
            <button
              key={tab.path}
              className={`acc-nav-item${location.pathname.startsWith(tab.path) ? ' acc-nav-item--active' : ''}`}
              onClick={() => navigate(tab.path)}
            >
              <span className="acc-nav-icon">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="acc-content">
        <Routes>
          <Route index element={<Orders />} />
          <Route path="orders" element={<Orders />} />
          <Route path="payment" element={<PaymentHistory />} />
          <Route path="settings" element={<LoginSettings />} />
        </Routes>
      </div>
    </div>
  )
}
