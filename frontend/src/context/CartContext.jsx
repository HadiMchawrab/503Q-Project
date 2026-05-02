import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { api, money } from '../api'
import { useAuth } from './AuthContext'

const CartContext = createContext(null)

const EMPTY_CART = { items: [], total_cents: 0, item_count: 0 }

export function CartProvider({ children }) {
  const { user, loading: authLoading } = useAuth()
  const [cart, setCart] = useState(EMPTY_CART)
  const [isOpen, setIsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const fetchCart = useCallback(async () => {
    try {
      const data = await api.getCart()
      setCart(data.cart || EMPTY_CART)
    } catch {
      // Not authenticated or backend unavailable — keep empty cart
    }
  }, [])

  // Hydrate the cart from Redis whenever the signed-in user changes.
  // Cart is keyed server-side by Cognito sub, so:
  //   - on first mount, if a token already exists in localStorage, fetch
  //   - after sign-in completes, fetch
  //   - after sign-out (user goes null), reset to empty so the UI doesn't
  //     show the previous user's cart for a flash
  // Without this effect, cart state stays at the initial empty value until
  // the user adds an item — which is why the cart appeared empty on refresh
  // even though Redis had the items.
  useEffect(() => {
    if (authLoading) return
    if (user) {
      fetchCart()
    } else {
      setCart(EMPTY_CART)
    }
  }, [user, authLoading, fetchCart])

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
