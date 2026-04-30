from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from shared.config import settings
from shared.errors import AppError


_bearer = HTTPBearer(auto_error=False)

# Cognito JWKS clients are cached per-pool. PyJWKClient handles fetch + key rotation.
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


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def sign_token(user: dict[str, Any]) -> str:
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


def verify_token(raw_token: str) -> dict[str, Any]:
    # Prefer Cognito (RS256 + JWKS) when configured; fall back to local HS256 for dev.
    try:
        if settings.cognito_user_pool_id:
            for pool_id in filter(None, [settings.cognito_user_pool_id, settings.cognito_admin_pool_id]):
                try:
                    signing_key = _jwks_client_for(pool_id).get_signing_key_from_jwt(raw_token).key
                    return jwt.decode(
                        raw_token,
                        signing_key,
                        algorithms=["RS256"],
                        issuer=_cognito_issuer(pool_id),
                        options={"verify_aud": False},
                    )
                except jwt.PyJWTError:
                    continue
            raise AppError(401, "INVALID_TOKEN", "Invalid or expired token")

        return jwt.decode(
            raw_token,
            settings.jwt_secret,
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
        )
    except jwt.PyJWTError as exc:
        raise AppError(401, "INVALID_TOKEN", "Invalid or expired token") from exc


async def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AppError(401, "MISSING_TOKEN", "Authorization token is required")
    return verify_token(credentials.credentials)


def require_role(role: str):
    async def dependency(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        if user.get("role") != role:
            raise AppError(403, "FORBIDDEN", f"Required role: {role}")
        return user

    return dependency
