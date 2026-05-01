"""Authentication helpers used by every service.

Two modes, picked by environment:

* **Cognito mode** — set when COGNITO_USER_POOL_ID (and/or COGNITO_ADMIN_POOL_ID)
  is configured. Tokens are RS256 JWTs issued by Cognito and verified against the
  pool's JWKS. Role is derived from which pool issued the token.

* **Local dev mode** — when no Cognito pool is configured AND APP_ENV != "production".
  Tokens are HS256 JWTs issued by the auth service's /login and /register endpoints,
  signed with JWT_SECRET. Lets `docker compose up` work end-to-end without AWS.

Production hard-fails if neither mode applies — see local_dev_enabled() and the
guard in verify_token.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from shared import db
from shared.config import settings
from shared.errors import AppError
from shared.ids import parse_uuid

logger = logging.getLogger(__name__)


_bearer = HTTPBearer(auto_error=False)

_jwks_clients: dict[str, jwt.PyJWKClient] = {}


def cognito_configured() -> bool:
    return bool(settings.cognito_user_pool_id or settings.cognito_admin_pool_id)


def local_dev_enabled() -> bool:
    """Local HS256 issuance is allowed only outside production AND when Cognito isn't set."""
    return settings.environment != "production" and not cognito_configured()


def _cognito_issuer(pool_id: str) -> str:
    return f"https://cognito-idp.{settings.aws_region}.amazonaws.com/{pool_id}"


def _jwks_client_for(pool_id: str) -> jwt.PyJWKClient:
    client = _jwks_clients.get(pool_id)
    if client is None:
        client = jwt.PyJWKClient(f"{_cognito_issuer(pool_id)}/.well-known/jwks.json")
        _jwks_clients[pool_id] = client
    return client


def normalize_email(email: str | None) -> str:
    return str(email or "").strip().lower()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def sign_local_token(user: dict[str, Any]) -> str:
    """Issue an HS256 token in local dev mode. Same claim shape as Cognito tokens."""
    if not local_dev_enabled():
        raise AppError(500, "LOCAL_AUTH_DISABLED", "Local token issuance is disabled")
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user["id"]),
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "iss": settings.jwt_issuer,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.jwt_expiration_hours)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _verify_local_token(raw_token: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            raw_token,
            settings.jwt_secret,
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
        )
    except jwt.PyJWTError as exc:
        raise AppError(401, "INVALID_TOKEN", "Invalid or expired token") from exc


def _verify_cognito_token(raw_token: str) -> dict[str, Any]:
    pools = [
        ("customer", settings.cognito_user_pool_id),
        ("admin", settings.cognito_admin_pool_id),
    ]
    for role, pool_id in pools:
        if not pool_id:
            continue
        try:
            signing_key = _jwks_client_for(pool_id).get_signing_key_from_jwt(raw_token).key
            claims = jwt.decode(
                raw_token,
                signing_key,
                algorithms=["RS256"],
                issuer=_cognito_issuer(pool_id),
                options={"verify_aud": False},
            )
            claims["role"] = role
            return claims
        except jwt.PyJWTError:
            continue
    raise AppError(401, "INVALID_TOKEN", "Invalid or expired token")


def verify_token(raw_token: str) -> dict[str, Any]:
    if cognito_configured():
        return _verify_cognito_token(raw_token)
    if local_dev_enabled():
        return _verify_local_token(raw_token)
    raise AppError(
        500,
        "AUTH_NOT_CONFIGURED",
        "Auth not configured: set COGNITO_USER_POOL_ID/COGNITO_ADMIN_POOL_ID, "
        "or run with APP_ENV != production for local-dev HS256 tokens.",
    )


async def upsert_user_from_claims(claims: dict[str, Any]) -> None:
    """Mirror identity into the local users table.

    Skipped in local-dev mode — /register and /login already INSERT directly into
    `users`, so the row exists by the time the token is verified.

    Conflict handling: the users table has UNIQUE constraints on BOTH `id` and
    `email`. The naive ON CONFLICT (id) raised UniqueViolation 500s when a
    stale row existed under a different id with the same email (e.g. legacy
    local-dev row, or a row from a previous Cognito pool). We use email as
    the conflict target since email is the alias_attribute on the Cognito
    pool: one email -> one user, regardless of which sub Cognito assigned.
    On conflict we keep the existing id (foreign keys from orders/etc still
    point to it) and only refresh the display name.
    """
    if local_dev_enabled():
        return

    sub = parse_uuid(claims["sub"], "user id")
    email = normalize_email(claims.get("email"))
    name = (claims.get("name") or claims.get("cognito:username") or email).strip()
    if not email or not name:
        raise AppError(401, "INCOMPLETE_CLAIMS", "Token missing email or name")

    await db.execute(
        """
        INSERT INTO users (id, name, email)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO UPDATE
        SET name = EXCLUDED.name
        """,
        sub,
        name,
        email,
    )


async def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AppError(401, "MISSING_TOKEN", "Authorization token is required")
    claims = verify_token(credentials.credentials)
    # Anything unexpected during the user-mirror upsert (DB connectivity hiccup,
    # malformed Cognito claim, missing email on a token from a stale pool) used
    # to bubble up as a 500 with no traceback in pod logs. Convert to a clean
    # 401 + log the real exception so the failure mode is debuggable.
    try:
        await upsert_user_from_claims(claims)
    except AppError:
        raise
    except Exception:
        logger.exception(
            "upsert_user_from_claims failed for sub=%s email=%s",
            claims.get("sub"),
            claims.get("email"),
        )
        raise AppError(401, "SESSION_REJECTED", "Could not establish session from token")
    return claims


def require_role(role: str):
    async def dependency(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        if user.get("role") != role:
            raise AppError(403, "FORBIDDEN", f"Required role: {role}")
        return user

    return dependency
