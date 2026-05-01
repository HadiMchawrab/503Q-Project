import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { CartProvider } from './context/CartContext'
import Header from './components/Header'
import Storefront from './components/Storefront'
import AccountPage from './components/AccountPage'
import CartDrawer from './components/CartDrawer'

function AppShell() {
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div className="app">
      <Header onSearch={setSearchQuery} />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Storefront searchQuery={searchQuery} />} />
          <Route path="/account/*" element={<AccountPage />} />
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
