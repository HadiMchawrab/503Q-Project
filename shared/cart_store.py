from __future__ import annotations

import json
from typing import Any

from shared.redis_client import client


def _key(user_id: str) -> str:
    return f"cart:{user_id}"


async def get_cart(user_id: str) -> dict[str, Any]:
    raw = await client().get(_key(user_id))
    if not raw:
        return {"items": []}

    try:
        cart = json.loads(raw)
    except json.JSONDecodeError:
        return {"items": []}

    if not isinstance(cart, dict) or not isinstance(cart.get("items"), list):
        return {"items": []}
    return cart


async def save_cart(user_id: str, cart: dict[str, Any]) -> None:
    await client().set(_key(user_id), json.dumps(cart), ex=60 * 60 * 24 * 7)


async def clear_cart(user_id: str) -> None:
    await client().delete(_key(user_id))
