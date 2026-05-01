from __future__ import annotations

from typing import Any

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from shared import db
from shared.config import settings
from shared.errors import AppError
from shared.ids import parse_uuid


_bearer = HTTPBearer(auto_error=False)

_jwks_clients: dict[str, jwt.PyJWKClient] = {}


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


def verify_token(raw_token: str) -> dict[str, Any]:
    """Validate a Cognito-issued RS256 JWT and return claims with a derived `role`.

    Role is determined by which pool issued the token: tokens from the admin pool
    get role="admin", tokens from the customer pool get role="customer". Pool config
    must be present — there is no local fallback.
    """
    if not settings.cognito_user_pool_id and not settings.cognito_admin_pool_id:
        raise AppError(
            500,
            "AUTH_NOT_CONFIGURED",
            "Cognito pool IDs are not configured",
        )

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


async def upsert_user_from_claims(claims: dict[str, Any]) -> None:
    """Mirror Cognito identity into the local users table.

    Called from current_user on every authenticated request. ON CONFLICT keeps
    name/email in sync if the user updates them in Cognito.
    """
    sub = parse_uuid(claims["sub"], "user id")
    email = normalize_email(claims.get("email"))
    name = (claims.get("name") or claims.get("cognito:username") or email).strip()
    if not email or not name:
        raise AppError(401, "INCOMPLETE_CLAIMS", "Token missing email or name")

    await db.execute(
        """
        INSERT INTO users (id, name, email)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name, email = EXCLUDED.email
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
    await upsert_user_from_claims(claims)
    return claims


def require_role(role: str):
    async def dependency(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        if user.get("role") != role:
            raise AppError(403, "FORBIDDEN", f"Required role: {role}")
        return user

    return dependency
