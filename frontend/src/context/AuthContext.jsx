import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import * as Cognito from '../lib/cognito'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [mode, setMode] = useState('cognito') // 'cognito' | 'local'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // On mount: figure out which mode the auth service is running in, restore
  // any persisted session, and finish the OAuth code exchange if we just got
  // redirected back from Cognito with ?code=.
  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      const m = await Cognito.getMode().catch(() => 'cognito')
      if (cancelled) return
      setMode(m)

      try {
        const result = await Cognito.completeLoginIfNeeded('customer')
        if (cancelled) return
        if (result) {
          persistSession(result)
          setUser(result.user)
          setLoading(false)
          return
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      }

      const stored = localStorage.getItem('shopcloud_user')
      if (stored) {
        try { setUser(JSON.parse(stored)) } catch { /* ignore */ }
      }
      if (!cancelled) setLoading(false)
    }

    bootstrap()
    return () => { cancelled = true }
  }, [])

  const persistSession = (result) => {
    localStorage.setItem('shopcloud_user', JSON.stringify(result.user))
    localStorage.setItem('shopcloud_token', result.token)
    if (result.refreshToken) localStorage.setItem('shopcloud_refresh', result.refreshToken)
    if (result.expiresAt) localStorage.setItem('shopcloud_token_exp', String(result.expiresAt))
  }

  // Used by local-mode (docker compose dev) where the auth service issues
  // its own JWT against email/password. In Cognito mode the redirect flow
  // is what populates user state.
  const login = useCallback((userData, token) => {
    localStorage.setItem('shopcloud_user', JSON.stringify(userData))
    localStorage.setItem('shopcloud_token', token)
    setUser(userData)
  }, [])

  const startCognitoLogin = useCallback(() => {
    setError(null)
    Cognito.startLogin('customer').catch((err) => setError(err.message))
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('shopcloud_user')
    localStorage.removeItem('shopcloud_token')
    localStorage.removeItem('shopcloud_refresh')
    localStorage.removeItem('shopcloud_token_exp')
    setUser(null)
    if (mode === 'cognito') {
      // Redirects to Cognito /logout, which clears the IdP session cookie and
      // sends the browser back to /. In local mode, just clear and stay put.
      Cognito.logout('customer', '/')
    }
  }, [mode])

  return (
    <AuthContext.Provider value={{ user, loading, mode, error, login, startCognitoLogin, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
