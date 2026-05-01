// OAuth 2.0 Authorization Code flow with PKCE for Cognito Hosted UI.
// Used by both the storefront and the admin console — the only difference is
// which client config (`customer` vs `admin`) it reads from /api/auth/config.
(function (global) {
  const STORAGE_VERIFIER = 'cognito_pkce_verifier';
  const STORAGE_STATE = 'cognito_pkce_state';

  function base64UrlEncode(bytes) {
    let str = '';
    bytes.forEach((byte) => { str += String.fromCharCode(byte); });
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomString(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
  }

  async function sha256(value) {
    const data = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(new Uint8Array(hash));
  }

  function decodeJwtPayload(token) {
    const part = token.split('.')[1] || '';
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    return JSON.parse(atob(padded + padding));
  }

  let configCache = null;
  async function loadFullConfig() {
    if (configCache) return configCache;
    const response = await fetch('/api/auth/config');
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error('Could not load auth config');
    configCache = data;
    return data;
  }

  async function loadConfig(audience) {
    const data = await loadFullConfig();
    const cfg = data[audience];
    if (!cfg || !cfg.domain || !cfg.client_id) {
      throw new Error('Auth not configured for ' + audience);
    }
    return cfg;
  }

  async function getMode() {
    const data = await loadFullConfig();
    return data.mode || 'cognito';
  }

  function redirectUri() {
    // Cognito redirects back to the same page that started the flow.
    // The page itself reads ?code= on load and finishes the exchange.
    return location.origin + location.pathname;
  }

  async function startLogin(audience) {
    const cfg = await loadConfig(audience);
    const verifier = randomString(64);
    const challenge = await sha256(verifier);
    const state = randomString(16);
    sessionStorage.setItem(STORAGE_VERIFIER, verifier);
    sessionStorage.setItem(STORAGE_STATE, state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.client_id,
      redirect_uri: redirectUri(),
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    location.assign(`${cfg.domain}/oauth2/authorize?${params.toString()}`);
  }

  async function completeLoginIfNeeded(audience) {
    // No-op when there's no ?code= in the URL — page is just being viewed normally.
    const url = new URL(location.href);
    const code = url.searchParams.get('code');
    if (!code) return null;

    const returnedState = url.searchParams.get('state');
    const expectedState = sessionStorage.getItem(STORAGE_STATE);
    const verifier = sessionStorage.getItem(STORAGE_VERIFIER);
    sessionStorage.removeItem(STORAGE_STATE);
    sessionStorage.removeItem(STORAGE_VERIFIER);

    // Strip the OAuth params from the URL whether the exchange succeeds or not
    // so a refresh doesn't re-attempt the (single-use) code.
    history.replaceState({}, '', url.pathname);

    if (!verifier || !expectedState || returnedState !== expectedState) {
      throw new Error('Login state mismatch — please try again');
    }

    const cfg = await loadConfig(audience);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.client_id,
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    });
    const response = await fetch(`${cfg.domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || data.error || 'Token exchange failed');

    // Cognito returns: id_token (claims) + access_token (sent to backend) + refresh_token + expires_in.
    // Backend's verify_token accepts either id/access; we pass id_token because it carries email + name.
    const claims = decodeJwtPayload(data.id_token);
    return {
      token: data.id_token,
      refreshToken: data.refresh_token || null,
      expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
      user: {
        id: claims.sub,
        email: claims.email,
        name: claims.name || claims['cognito:username'] || claims.email,
      },
    };
  }

  async function refresh(audience, refreshToken) {
    if (!refreshToken) throw new Error('No refresh token');
    const cfg = await loadConfig(audience);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cfg.client_id,
      refresh_token: refreshToken,
    });
    const response = await fetch(`${cfg.domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || data.error || 'Token refresh failed');

    const claims = decodeJwtPayload(data.id_token);
    return {
      token: data.id_token,
      // Cognito returns a new id/access token but reuses the existing refresh token.
      refreshToken,
      expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000),
      user: {
        id: claims.sub,
        email: claims.email,
        name: claims.name || claims['cognito:username'] || claims.email,
      },
    };
  }

  function logout(audience, postLogoutPath) {
    loadConfig(audience).then((cfg) => {
      const params = new URLSearchParams({
        client_id: cfg.client_id,
        logout_uri: location.origin + (postLogoutPath || '/'),
      });
      location.assign(`${cfg.domain}/logout?${params.toString()}`);
    }).catch(() => {
      // If config can't be reached, still clear local state and reload.
      location.assign(postLogoutPath || '/');
    });
  }

  global.Cognito = { startLogin, completeLoginIfNeeded, refresh, logout, getMode };
}(window));
