import { createContext, useContext, useState, useCallback } from 'react'
import { api, money } from '../api'

const CartContext = createContext(null)

export function CartProvider({ children }) {
  const [cart, setCart] = useState({ items: [], total_cents: 0, item_count: 0 })
  const [isOpen, setIsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const fetchCart = useCallback(async () => {
    try {
      const data = await api.getCart()
      setCart(data.cart || { items: [], total_cents: 0, item_count: 0 })
    } catch {
      // Not authenticated or backend unavailable — keep empty cart
    }
  }, [])

  const addItem = useCallback(async (productId) => {
    setBusy(true)
    setError(null)
    try {
      await api.addToCart(productId, 1)
      await fetchCart()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [fetchCart])

  const updateItem = useCallback(async (productId, quantity) => {
    try {
      if (quantity <= 0) {
        await api.removeCartItem(productId)
      } else {
        await api.updateCartItem(productId, quantity)
      }
      await fetchCart()
    } catch { /* ignore */ }
  }, [fetchCart])

  const removeItem = useCallback(async (productId) => {
    try {
      await api.removeCartItem(productId)
      await fetchCart()
    } catch { /* ignore */ }
  }, [fetchCart])

  const clearCart = useCallback(async () => {
    try {
      await api.clearCart()
      await fetchCart()
    } catch { /* ignore */ }
  }, [fetchCart])

  const totalDisplay = `$${money(cart.total_cents)}`

  return (
    <CartContext.Provider value={{
      items: cart.items,
      count: cart.item_count || 0,
      totalCents: cart.total_cents,
      totalDisplay,
      isOpen,
      busy,
      error,
      setIsOpen,
      addItem,
      updateItem,
      removeItem,
      clearCart,
      fetchCart,
    }}>
      {children}
    </CartContext.Provider>
  )
}

export const useCart = () => useContext(CartContext)
