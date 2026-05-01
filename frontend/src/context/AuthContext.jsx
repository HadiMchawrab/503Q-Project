import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('shopcloud_user')
    if (stored) {
      try { setUser(JSON.parse(stored)) } catch { /* ignore */ }
    }
    setLoading(false)
  }, [])

  const login = useCallback((userData, token) => {
    localStorage.setItem('shopcloud_user', JSON.stringify(userData))
    localStorage.setItem('shopcloud_token', token)
    setUser(userData)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('shopcloud_user')
    localStorage.removeItem('shopcloud_token')
    localStorage.removeItem('shopcloud_refresh')
    localStorage.removeItem('shopcloud_token_exp')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
