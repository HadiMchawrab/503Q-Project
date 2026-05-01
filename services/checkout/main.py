from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import Depends
from pydantic import BaseModel, Field

from shared import db
from shared.auth import current_user
from shared.cart_store import clear_cart, get_cart
from shared.errors import AppError, success
from shared.ids import parse_uuid
from shared.queue import publish_invoice_event
from shared.redis_client import close_redis, init_redis
from shared.service import create_app


class CheckoutRequest(BaseModel):
    shippingAddress: str = Field(min_length=1, max_length=1000)


@asynccontextmanager
async def lifespan(_):
    await db.init_db()
    await init_redis()
    yield
    await close_redis()
    await db.close_db()


app = create_app("checkout", lifespan=lifespan)


async def load_order_for_user(order_id: str, user_id: str) -> dict[str, Any]:
    order_uuid = parse_uuid(order_id, "order id")
    user_uuid = parse_uuid(user_id, "user id")

    order = await db.fetchrow(
        """
        SELECT id, user_id, status, total_cents, shipping_address, invoice_status, invoice_url, created_at
        FROM orders
        WHERE id = $1 AND user_id = $2
        """,
        order_uuid,
        user_uuid,
    )
    if not order:
        raise AppError(404, "ORDER_NOT_FOUND", "Order not found")

    items = await db.fetch(
        """
        SELECT product_id, product_name, quantity, unit_price_cents, line_total_cents
        FROM order_items
        WHERE order_id = $1
        ORDER BY product_name ASC
        """,
        order_uuid,
    )
    return {**order, "items": items}


@app.get("/orders")
async def list_orders(user: dict[str, Any] = Depends(current_user)):
    rows = await db.fetch(
        """
        SELECT id, status, total_cents, shipping_address, invoice_status, invoice_url, created_at
        FROM orders
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 25
        """,
        parse_uuid(user["sub"], "user id"),
    )
    return success({"orders": rows})


@app.get("/orders/{order_id}")
async def get_order(order_id: str, user: dict[str, Any] = Depends(current_user)):
    order = await load_order_for_user(order_id, user["sub"])
    return success({"order": order})


@app.post("/", status_code=201)
async def checkout(payload: CheckoutRequest, user: dict[str, Any] = Depends(current_user)):
    shipping_address = payload.shippingAddress.strip()
    cart = await get_cart(user["sub"])
    if not cart.get("items"):
        raise AppError(400, "EMPTY_CART", "Cart is empty")

    async with db.transaction() as conn:
        total_cents = 0
        checked_items: list[dict[str, Any]] = []

        for item in cart["items"]:
            product_id = parse_uuid(item["product_id"], "product id")
            product = await conn.fetchrow(
                """
                SELECT id, name, price_cents, stock
                FROM products
                WHERE id = $1 AND is_active = TRUE
                FOR UPDATE
                """,
                product_id,
            )
            if product is None:
                raise AppError(404, "PRODUCT_NOT_FOUND", f"Product {item['product_id']} no longer exists")

            quantity = int(item["quantity"])
            if int(product["stock"]) < quantity:
                raise AppError(409, "INSUFFICIENT_STOCK", f"{product['name']} has only {product['stock']} units left")

            unit_price_cents = int(product["price_cents"])
            line_total_cents = unit_price_cents * quantity
            total_cents += line_total_cents
            checked_items.append(
                {
                    "product_id": product["id"],
                    "product_name": product["name"],
                    "quantity": quantity,
                    "unit_price_cents": unit_price_cents,
                    "line_total_cents": line_total_cents,
                }
            )

        created_order = await conn.fetchrow(
            """
            INSERT INTO orders (user_id, total_cents, shipping_address, status, invoice_status)
            VALUES ($1, $2, $3, 'confirmed', 'pending')
            RETURNING id, user_id, status, total_cents, shipping_address, invoice_status, created_at
            """,
            parse_uuid(user["sub"], "user id"),
            total_cents,
            shipping_address,
        )
        assert created_order is not None

        for item in checked_items:
            await conn.execute(
                """
                INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price_cents, line_total_cents)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                created_order["id"],
                item["product_id"],
                item["product_name"],
                item["quantity"],
                item["unit_price_cents"],
                item["line_total_cents"],
            )
            await conn.execute(
                """
                UPDATE products
                SET stock = stock - $1, updated_at = NOW()
                WHERE id = $2
                """,
                item["quantity"],
                item["product_id"],
            )

    await clear_cart(user["sub"])

    # Cognito tokens don't always carry a `name` claim (depends on whether the
    # user pool collects it on signup — ours is email-only). Fall back through
    # cognito:username then email so the invoice always has something to print.
    customer_name = user.get("name") or user.get("cognito:username") or user["email"]
    await publish_invoice_event(
        {
            "type": "invoice.requested",
            "orderId": str(created_order["id"]),
            "userId": user["sub"],
            "customerEmail": user["email"],
            "customerName": customer_name,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
    )

    order = {**dict(created_order), "items": checked_items}
    return success({"order": order, "message": "Order confirmed. Invoice generation has been queued."})
