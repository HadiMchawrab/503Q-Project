// OAuth 2.0 Authorization Code flow with PKCE for Cognito Hosted UI.
// Ported from the legacy frontend/cognito.js global so the Vite/React build
// can import it directly. The auth service exposes /api/auth/config which
// returns { mode, customer: { domain, client_id }, admin: { ... } }.
//
// Browser requirement: window.crypto.subtle is only available on HTTPS or
// localhost. The storefront ALB terminates HTTPS at CloudFront, and local
// dev runs on http://localhost so both work.

const STORAGE_VERIFIER = 'cognito_pkce_verifier'
const STORAGE_STATE = 'cognito_pkce_state'

function base64UrlEncode(bytes) {
  let str = ''
  bytes.forEach((byte) => { str += String.fromCharCode(byte) })
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(length) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

async function sha256(value) {
  const data = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(hash))
}

function decodeJwtPayload(token) {
  const part = token.split('.')[1] || ''
  const padded = part.replace(/-/g, '+').replace(/_/g, '/')
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return JSON.parse(atob(padded + padding))
}

let configCache = null
async function loadFullConfig() {
  if (configCache) return configCache
  const response = await fetch('/api/auth/config')
  const data = await response.json()
  if (!response.ok || !data.success) throw new Error('Could not load auth config')
  configCache = data
  return data
}

async function loadConfig(audience) {
  const data = await loadFullConfig()
  const cfg = data[audience]
  if (!cfg || !cfg.domain || !cfg.client_id) {
    throw new Error('Auth not configured for ' + audience)
  }
  return cfg
}

export async function getMode() {
  const data = await loadFullConfig()
  return data.mode || 'cognito'
}

// All flows redirect back to a single dedicated path. This must exactly
// match an entry in the Cognito app client's callback URL allow-list (managed
// in infra/terraform/.../main.tf -> module "cognito" -> customer_callback_urls).
// A fixed path keeps the allow-list small even as new pages add sign-in CTAs.
const CALLBACK_PATH = '/callback'
function redirectUri() {
  return location.origin + CALLBACK_PATH
}

export async function startLogin(audience) {
  const cfg = await loadConfig(audience)
  const verifier = randomString(64)
  const challenge = await sha256(verifier)
  const state = randomString(16)
  sessionStorage.setItem(STORAGE_VERIFIER, verifier)
  sessionStorage.setItem(STORAGE_STATE, state)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.client_id,
    redirect_uri: redirectUri(),
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  location.assign(`${cfg.domain}/oauth2/authorize?${params.toString()}`)
}

export async function completeLoginIfNeeded(audience) {
  const url = new URL(location.href)
  const code = url.searchParams.get('code')
  if (!code) return null

  const returnedState = url.searchParams.get('state')
  const expectedState = sessionStorage.getItem(STORAGE_STATE)
  const verifier = sessionStorage.getItem(STORAGE_VERIFIER)
  sessionStorage.removeItem(STORAGE_STATE)
  sessionStorage.removeItem(STORAGE_VERIFIER)

  // Strip OAuth params so a refresh doesn't re-attempt the (single-use) code.
  history.replaceState({}, '', url.pathname)

  if (!verifier || !expectedState || returnedState !== expectedState) {
    throw new Error('Login state mismatch — please try again')
  }

  const cfg = await loadConfig(audience)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.client_id,
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  })
  const response = await fetch(`${cfg.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error_description || data.error || 'Token exchange failed')

  const claims = decodeJwtPayload(data.id_token)
  return {
    token: data.id_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
    user: {
      id: claims.sub,
      email: claims.email,
      name: claims.name || claims['cognito:username'] || claims.email,
    },
  }
}

export async function refresh(audience, refreshToken) {
  if (!refreshToken) throw new Error('No refresh token')
  const cfg = await loadConfig(audience)
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cfg.client_id,
    refresh_token: refreshToken,
  })
  const response = await fetch(`${cfg.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error_description || data.error || 'Token refresh failed')

  const claims = decodeJwtPayload(data.id_token)
  return {
    token: data.id_token,
    refreshToken,
    expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
    user: {
      id: claims.sub,
      email: claims.email,
      name: claims.name || claims['cognito:username'] || claims.email,
    },
  }
}

export async function logout(audience, postLogoutPath) {
  try {
    const cfg = await loadConfig(audience)
    const params = new URLSearchParams({
      client_id: cfg.client_id,
      logout_uri: location.origin + (postLogoutPath || '/'),
    })
    location.assign(`${cfg.domain}/logout?${params.toString()}`)
  } catch {
    // Config unreachable (e.g. local mode with auth service down) — just clear
    // local state and reload.
    location.assign(postLogoutPath || '/')
  }
}
