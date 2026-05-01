import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CartProvider } from './context/CartContext'
import Header from './components/Header'
import Storefront from './components/Storefront'
import AccountPage from './components/AccountPage'
import CartDrawer from './components/CartDrawer'

// Cognito OAuth redirect target. AuthProvider's bootstrap effect runs the
// PKCE code exchange before this component renders meaningful UI; we just
// wait for the loading flag to clear, then route the user onward.
function CognitoCallback() {
  const { user, loading, error } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    navigate(user ? '/account/orders' : '/', { replace: true })
  }, [loading, user, navigate])

  return (
    <div className="app-callback">
      {error ? <p className="signin-error">{error}</p> : <p>Signing you in…</p>}
    </div>
  )
}

function AppShell() {
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div className="app">
      <Header onSearch={setSearchQuery} />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Storefront searchQuery={searchQuery} />} />
          <Route path="/account/*" element={<AccountPage />} />
          <Route path="/callback" element={<CognitoCallback />} />
        </Routes>
      </main>
      <CartDrawer />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <AppShell />
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
