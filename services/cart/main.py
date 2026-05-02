from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import Depends
from pydantic import BaseModel, Field

from shared import db
from shared.auth import current_user
from shared.cart_store import clear_cart, get_cart, save_cart
from shared.config import settings
from shared.errors import AppError, success
from shared.redis_client import close_redis, init_redis
from shared.service import create_app


class CartItemRequest(BaseModel):
    productId: str = Field(min_length=1)
    quantity: int = Field(default=1, gt=0)


class CartQuantityRequest(BaseModel):
    quantity: int = Field(ge=0)


@asynccontextmanager
async def lifespan(_):
    # Cart needs Postgres for the user-mirror upsert that runs on every
    # authenticated request (shared.auth.upsert_user_from_claims), in addition
    # to Redis for cart storage itself.
    await db.init_db()
    await init_redis()
    yield
    await close_redis()
    await db.close_db()


app = create_app("cart", lifespan=lifespan)


def calculate_cart(cart: dict[str, Any]) -> dict[str, Any]:
    items = cart.get("items", [])
    total_cents = sum(int(item["price_cents"]) * int(item["quantity"]) for item in items)
    item_count = sum(int(item["quantity"]) for item in items)
    return {**cart, "items": items, "total_cents": total_cents, "item_count": item_count}


async def get_product(product_id: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{settings.catalog_service_url}/products/{product_id}")
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise AppError(404, "PRODUCT_NOT_FOUND", "Product not found") from exc
        raise AppError(502, "CATALOG_UNAVAILABLE", "Catalog service returned an error") from exc
    except httpx.HTTPError as exc:
        raise AppError(502, "CATALOG_UNAVAILABLE", "Catalog service is unavailable") from exc

    data = response.json()
    return data["product"]


@app.get("/")
async def read_cart(user: dict[str, Any] = Depends(current_user)):
    cart = await get_cart(user["sub"])
    return success({"cart": calculate_cart(cart)})


@app.post("/items", status_code=201)
async def add_item(payload: CartItemRequest, user: dict[str, Any] = Depends(current_user)):
    product = await get_product(payload.productId)
    cart = await get_cart(user["sub"])

    existing = next((item for item in cart["items"] if item["product_id"] == str(product["id"])), None)
    requested_quantity = payload.quantity + int(existing["quantity"]) if existing else payload.quantity
    if int(product["stock"]) < requested_quantity:
        raise AppError(409, "INSUFFICIENT_STOCK", "Requested quantity exceeds available stock")

    if existing:
        existing["quantity"] = requested_quantity
        existing["price_cents"] = int(product["price_cents"])
        existing["name"] = product["name"]
        existing["image_url"] = product.get("image_url")
    else:
        cart["items"].append(
            {
                "product_id": str(product["id"]),
                "sku": product["sku"],
                "name": product["name"],
                "quantity": payload.quantity,
                "price_cents": int(product["price_cents"]),
                "image_url": product.get("image_url"),
            }
        )

    await save_cart(user["sub"], cart)
    return success({"cart": calculate_cart(cart)})


@app.patch("/items/{product_id}")
async def update_item(product_id: str, payload: CartQuantityRequest, user: dict[str, Any] = Depends(current_user)):
    cart = await get_cart(user["sub"])
    item = next((current for current in cart["items"] if current["product_id"] == product_id), None)
    if not item:
        raise AppError(404, "ITEM_NOT_FOUND", "Cart item not found")

    if payload.quantity == 0:
        cart["items"] = [current for current in cart["items"] if current["product_id"] != product_id]
    else:
        product = await get_product(product_id)
        if int(product["stock"]) < payload.quantity:
            raise AppError(409, "INSUFFICIENT_STOCK", "Requested quantity exceeds available stock")
        item["quantity"] = payload.quantity
        item["price_cents"] = int(product["price_cents"])

    await save_cart(user["sub"], cart)
    return success({"cart": calculate_cart(cart)})


@app.delete("/items/{product_id}")
async def remove_item(product_id: str, user: dict[str, Any] = Depends(current_user)):
    cart = await get_cart(user["sub"])
    cart["items"] = [item for item in cart["items"] if item["product_id"] != product_id]
    await save_cart(user["sub"], cart)
    return success({"cart": calculate_cart(cart)})


@app.delete("/")
async def empty_cart(user: dict[str, Any] = Depends(current_user)):
    await clear_cart(user["sub"])
    return success({"cart": calculate_cart({"items": []})})
