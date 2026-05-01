from __future__ import annotations

import re
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends
from pydantic import BaseModel, Field

from shared import db
from shared.auth import (
    cognito_configured,
    current_user,
    hash_password,
    local_dev_enabled,
    normalize_email,
    sign_local_token,
    verify_password,
)
from shared.config import settings
from shared.errors import AppError, success
from shared.ids import parse_uuid
from shared.service import create_app


EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


def validate_email(email: str) -> str:
    cleaned = normalize_email(email)
    if not EMAIL_RE.match(cleaned):
        raise AppError(400, "INVALID_EMAIL", "Please enter a valid email address")
    return cleaned


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(user["id"]),
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        **({"created_at": user["created_at"]} if "created_at" in user else {}),
    }


async def seed_admin() -> None:
    """Create a default admin user when running in local dev mode."""
    email = validate_email(settings.admin_email)
    existing = await db.fetchrow("SELECT id FROM users WHERE email = $1", email)
    if existing:
        return

    await db.execute(
        """
        INSERT INTO users (id, name, email, password_hash, role)
        VALUES (gen_random_uuid(), $1, $2, $3, 'admin')
        """,
        settings.admin_name,
        email,
        hash_password(settings.admin_password),
    )
    print(f"[auth] seeded local admin user {email}", flush=True)


def assert_local_dev() -> None:
    if not local_dev_enabled():
        raise AppError(
            404,
            "NOT_FOUND",
            "Local registration/login is disabled — sign in via the Cognito Hosted UI.",
        )


@asynccontextmanager
async def lifespan(_):
    await db.init_db()
    if local_dev_enabled():
        await seed_admin()
    yield
    await db.close_db()


app = create_app("auth", lifespan=lifespan)


@app.get("/config")
async def public_config():
    """Auth client config consumed by the frontends.

    The `mode` field tells the frontend which sign-in flow to use:
    - "cognito": redirect to the Hosted UI (OAuth code flow + PKCE)
    - "local":   POST to /login or /register with email + password
    """
    mode = "cognito" if cognito_configured() else ("local" if local_dev_enabled() else "disabled")
    return success(
        {
            "mode": mode,
            "customer": {
                "domain": settings.cognito_customer_domain,
                "client_id": settings.cognito_client_id,
            },
            "admin": {
                "domain": settings.cognito_admin_domain,
                "client_id": settings.cognito_admin_client_id,
            },
        }
    )


@app.post("/register", status_code=201)
async def register(payload: RegisterRequest):
    assert_local_dev()
    name = payload.name.strip()
    email = validate_email(payload.email)

    existing = await db.fetchrow("SELECT id FROM users WHERE email = $1", email)
    if existing:
        raise AppError(409, "EMAIL_EXISTS", "An account with this email already exists")

    user = await db.fetchrow(
        """
        INSERT INTO users (id, name, email, password_hash, role)
        VALUES (gen_random_uuid(), $1, $2, $3, 'customer')
        RETURNING id, name, email, role
        """,
        name,
        email,
        hash_password(payload.password),
    )
    assert user is not None
    clean_user = public_user(user)
    return success({"user": clean_user, "token": sign_local_token(clean_user)})


@app.post("/login")
async def login(payload: LoginRequest):
    assert_local_dev()
    email = validate_email(payload.email)
    user = await db.fetchrow(
        "SELECT id, name, email, role, password_hash FROM users WHERE email = $1",
        email,
    )
    if not user or user["password_hash"] is None or not verify_password(payload.password, user["password_hash"]):
        raise AppError(401, "INVALID_CREDENTIALS", "Invalid email or password")

    clean_user = public_user(user)
    return success({"user": clean_user, "token": sign_local_token(clean_user)})


@app.get("/me")
async def me(user_token: dict[str, Any] = Depends(current_user)):
    result = await db.fetchrow(
        "SELECT id, name, email, role, created_at FROM users WHERE id = $1",
        parse_uuid(user_token["sub"], "user id"),
    )
    if not result:
        raise AppError(404, "USER_NOT_FOUND", "User not found")
    return success({"user": {**result, "role": user_token.get("role") or result.get("role")}})
