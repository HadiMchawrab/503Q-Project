from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends

from shared import db
from shared.auth import current_user
from shared.errors import AppError, success
from shared.ids import parse_uuid
from shared.service import create_app


@asynccontextmanager
async def lifespan(_):
    await db.init_db()
    yield
    await db.close_db()


app = create_app("auth", lifespan=lifespan)


@app.get("/me")
async def me(user_token: dict[str, Any] = Depends(current_user)):
    result = await db.fetchrow(
        "SELECT id, name, email, created_at FROM users WHERE id = $1",
        parse_uuid(user_token["sub"], "user id"),
    )
    if not result:
        raise AppError(404, "USER_NOT_FOUND", "User not found")
    return success({"user": {**result, "role": user_token["role"]}})
