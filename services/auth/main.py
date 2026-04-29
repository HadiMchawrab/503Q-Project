from __future__ import annotations

import re
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends
from pydantic import BaseModel, Field

from shared import db
from shared.auth import current_user, hash_password, normalize_email, sign_token, verify_password
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
    # Accept normal demo/local domains such as admin@shopcloud.local while still
    # rejecting obviously malformed input. This is better for a local course demo
    # than strict deliverability validation.
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
    email = validate_email(settings.admin_email)
    existing = await db.fetchrow("SELECT id FROM users WHERE email = $1", email)
    if existing:
        return

    await db.fetchrow(
        """
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($1, $2, $3, 'admin')
        RETURNING id
        """,
        settings.admin_name,
        email,
        hash_password(settings.admin_password),
    )
    print(f"[auth] seeded admin user {email}", flush=True)


@asynccontextmanager
async def lifespan(_):
    await db.init_db()
    await seed_admin()
    yield
    await db.close_db()


app = create_app("auth", lifespan=lifespan)


@app.post("/register", status_code=201)
async def register(payload: RegisterRequest):
    name = payload.name.strip()
    email = validate_email(payload.email)

    existing = await db.fetchrow("SELECT id FROM users WHERE email = $1", email)
    if existing:
        raise AppError(409, "EMAIL_EXISTS", "An account with this email already exists")

    user = await db.fetchrow(
        """
        INSERT INTO users (name, email, password_hash, role)
        VALUES ($1, $2, $3, 'customer')
        RETURNING id, name, email, role
        """,
        name,
        email,
        hash_password(payload.password),
    )
    assert user is not None
    clean_user = public_user(user)
    return success({"user": clean_user, "token": sign_token(clean_user)})


@app.post("/login")
async def login(payload: LoginRequest):
    email = validate_email(payload.email)
    user = await db.fetchrow(
        "SELECT id, name, email, role, password_hash FROM users WHERE email = $1",
        email,
    )
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise AppError(401, "INVALID_CREDENTIALS", "Invalid email or password")

    clean_user = public_user(user)
    return success({"user": clean_user, "token": sign_token(clean_user)})


@app.get("/me")
async def me(user_token: dict[str, Any] = Depends(current_user)):
    result = await db.fetchrow(
        "SELECT id, name, email, role, created_at FROM users WHERE id = $1",
        parse_uuid(user_token["sub"], "user id"),
    )
    if not result:
        raise AppError(404, "USER_NOT_FOUND", "User not found")
    return success({"user": public_user(result)})
