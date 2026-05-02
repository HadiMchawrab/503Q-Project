from __future__ import annotations

import asyncio
import logging
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Body, Depends, File, Query, UploadFile

from shared import db
from shared.auth import require_role
from shared.errors import AppError, success
from shared.ids import parse_uuid
from shared.money import to_cents
from shared.service import create_app


ORDER_STATUSES = {"confirmed", "processing", "shipped", "cancelled"}

logger = logging.getLogger(__name__)

# Product image upload config. PRODUCT_IMAGES_BUCKET + PRODUCT_IMAGES_PUBLIC_BASE
# come from terraform via the prod overlay's ConfigMap; both are required for
# uploads to work. The endpoint returns 503 instead of 500 if they're missing
# (e.g. dev overlay before terraform apply has wired them up).
PRODUCT_IMAGES_BUCKET = os.getenv("PRODUCT_IMAGES_BUCKET", "")
PRODUCT_IMAGES_PUBLIC_BASE = os.getenv("PRODUCT_IMAGES_PUBLIC_BASE", "")
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB
EXT_BY_CONTENT_TYPE = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

_s3_client = None


def s3_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=os.getenv("AWS_REGION", "eu-west-1"))
    return _s3_client


@asynccontextmanager
async def lifespan(_):
    await db.init_db()
    yield
    await db.close_db()


app = create_app("admin", lifespan=lifespan)
router = APIRouter(dependencies=[Depends(require_role("admin"))])


@router.get("/summary")
async def summary():
    products = await db.fetchrow("SELECT COUNT(*)::int AS count FROM products WHERE is_active = TRUE")
    orders = await db.fetchrow("SELECT COUNT(*)::int AS count FROM orders")
    revenue = await db.fetchrow(
        "SELECT COALESCE(SUM(total_cents), 0)::int AS total_cents FROM orders WHERE status != $1",
        "cancelled",
    )
    low_stock = await db.fetchrow(
        "SELECT COUNT(*)::int AS count FROM products WHERE is_active = TRUE AND stock <= 5"
    )
    pending_invoices = await db.fetchrow(
        "SELECT COUNT(*)::int AS count FROM orders WHERE invoice_status = 'pending'"
    )
    recent_orders = await db.fetchrow(
        "SELECT COUNT(*)::int AS count FROM orders WHERE created_at >= NOW() - INTERVAL '24 hours'"
    )

    return success(
        {
            "summary": {
                "active_products": products["count"],
                "total_orders": orders["count"],
                "revenue_cents": revenue["total_cents"],
                "low_stock_products": low_stock["count"],
                "pending_invoices": pending_invoices["count"],
                "orders_last_24h": recent_orders["count"],
            }
        }
    )


@router.get("/products")
async def products(lowStock: bool = Query(default=False)):
    where = "WHERE stock <= 5" if lowStock else ""
    rows = await db.fetch(
        f"""
        SELECT id, sku, name, description, category, price_cents, image_url, stock, is_active, created_at, updated_at
        FROM products
        {where}
        ORDER BY stock ASC, updated_at DESC, created_at DESC
        """
    )
    return success({"products": rows, "count": len(rows)})


@router.post("/products", status_code=201)
async def create_product(payload: dict[str, Any] = Body(...)):
    sku = str(payload.get("sku", "")).strip()
    name = str(payload.get("name", "")).strip()
    description = str(payload.get("description", "")).strip()
    category = str(payload.get("category", "")).strip()
    image_url = payload.get("image_url") or payload.get("imageUrl") or None
    stock_raw = payload.get("stock", 0)
    price_cents = payload.get("price_cents")
    if price_cents is None:
        price_cents = to_cents(payload.get("price"))

    try:
        stock = int(stock_raw)
        price_cents = int(price_cents)
    except (TypeError, ValueError):
        raise AppError(400, "INVALID_INPUT", "sku, name, description, category, valid price, and stock are required")

    if not sku or not name or not description or not category or price_cents < 0 or stock < 0:
        raise AppError(400, "INVALID_INPUT", "sku, name, description, category, valid price, and stock are required")

    try:
        product = await db.fetchrow(
            """
            INSERT INTO products (sku, name, description, category, price_cents, image_url, stock)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            """,
            sku,
            name,
            description,
            category,
            price_cents,
            str(image_url).strip() if image_url else None,
            stock,
        )
    except Exception as exc:
        if "unique" in str(exc).lower():
            raise AppError(409, "SKU_EXISTS", "A product with this SKU already exists") from exc
        raise

    return success({"product": product})


@router.patch("/products/{product_id}")
async def update_product(product_id: str, payload: dict[str, Any] = Body(...)):
    allowed = {"name", "description", "category", "price_cents", "image_url", "stock", "is_active"}
    updates: list[str] = []
    args: list[Any] = []

    # Support admin frontend camelCase imageUrl in addition to database-style image_url.
    if "imageUrl" in payload and "image_url" not in payload:
        payload["image_url"] = payload["imageUrl"]

    for field in allowed:
        if field not in payload:
            continue
        value = payload[field]
        if field == "stock":
            try:
                value = int(value)
            except (TypeError, ValueError):
                raise AppError(400, "INVALID_STOCK", "Stock must be a non-negative integer")
            if value < 0:
                raise AppError(400, "INVALID_STOCK", "Stock must be a non-negative integer")
        elif field == "price_cents":
            try:
                value = int(value)
            except (TypeError, ValueError):
                raise AppError(400, "INVALID_PRICE", "Price must be a non-negative integer in cents")
            if value < 0:
                raise AppError(400, "INVALID_PRICE", "Price must be a non-negative integer in cents")
        elif field == "is_active":
            value = bool(value)
        elif value is not None:
            value = str(value).strip()

        args.append(value)
        updates.append(f"{field} = ${len(args)}")

    if "price" in payload and "price_cents" not in payload:
        cents = to_cents(payload["price"])
        if cents is None:
            raise AppError(400, "INVALID_PRICE", "Invalid price")
        args.append(cents)
        updates.append(f"price_cents = ${len(args)}")

    if not updates:
        raise AppError(400, "NO_UPDATES", "At least one update field is required")

    args.append(parse_uuid(product_id, "product id"))
    product = await db.fetchrow(
        f"""
        UPDATE products
        SET {', '.join(updates)}, updated_at = NOW()
        WHERE id = ${len(args)}
        RETURNING *
        """,
        *args,
    )
    if not product:
        raise AppError(404, "PRODUCT_NOT_FOUND", "Product not found")
    return success({"product": product})


@router.get("/orders")
async def orders(status: str = Query(default="")):
    args: list[Any] = []
    conditions: list[str] = []
    status = status.strip()
    if status:
        args.append(status)
        conditions.append(f"o.status = ${len(args)}")

    rows = await db.fetch(
        f"""
        SELECT o.id, o.status, o.total_cents, o.shipping_address, o.invoice_status, o.invoice_url, o.created_at,
               u.name AS customer_name, u.email AS customer_email,
               COUNT(oi.id)::int AS item_lines
        FROM orders o
        JOIN users u ON u.id = o.user_id
        LEFT JOIN order_items oi ON oi.order_id = o.id
        {'WHERE ' + ' AND '.join(conditions) if conditions else ''}
        GROUP BY o.id, u.name, u.email
        ORDER BY o.created_at DESC
        LIMIT 100
        """,
        *args,
    )
    return success({"orders": rows, "count": len(rows)})


@router.get("/orders/{order_id}")
async def order_details(order_id: str):
    order_uuid = parse_uuid(order_id, "order id")
    order = await db.fetchrow(
        """
        SELECT o.*, u.name AS customer_name, u.email AS customer_email
        FROM orders o
        JOIN users u ON u.id = o.user_id
        WHERE o.id = $1
        """,
        order_uuid,
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
    return success({"order": {**order, "items": items}})


@router.patch("/orders/{order_id}/status")
async def update_order_status(order_id: str, payload: dict[str, Any] = Body(...)):
    status = str(payload.get("status", "")).strip()
    if status not in ORDER_STATUSES:
        raise AppError(400, "INVALID_STATUS", f"Status must be one of: {', '.join(sorted(ORDER_STATUSES))}")

    order_uuid = parse_uuid(order_id, "order id")

    async with db.transaction() as conn:
        current = await conn.fetchrow(
            "SELECT id, status FROM orders WHERE id = $1",
            order_uuid,
        )
        if not current:
            raise AppError(404, "ORDER_NOT_FOUND", "Order not found")

        # Restore stock when cancelling a non-cancelled order.
        if status == "cancelled" and current["status"] != "cancelled":
            await conn.execute(
                """
                UPDATE products p
                SET stock = p.stock + oi.quantity,
                    updated_at = NOW()
                FROM order_items oi
                WHERE oi.order_id = $1
                  AND p.id = oi.product_id
                """,
                order_uuid,
            )

        order = await conn.fetchrow(
            """
            UPDATE orders
            SET status = $1
            WHERE id = $2
            RETURNING id, status, total_cents, invoice_status, created_at
            """,
            status,
            order_uuid,
        )

    return success({"order": dict(order)})


@router.post("/products/upload", status_code=201)
async def upload_product_image(file: UploadFile = File(...)):
    """Receive a product image and store it in the product images bucket.

    Returns the public CloudFront URL the admin form can stuff into
    `imageUrl` when creating/updating the product. Object keys are random
    UUIDs so two uploads of `phone.jpg` from different sessions don't
    collide -- the original filename is irrelevant to the public URL.
    """
    if not PRODUCT_IMAGES_BUCKET or not PRODUCT_IMAGES_PUBLIC_BASE:
        raise AppError(
            503,
            "UPLOADS_DISABLED",
            "Product image uploads are not configured for this environment",
        )

    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise AppError(
            400,
            "UNSUPPORTED_IMAGE_TYPE",
            f"Allowed types: {', '.join(sorted(ALLOWED_IMAGE_TYPES))}",
        )

    body = await file.read()
    if len(body) == 0:
        raise AppError(400, "EMPTY_UPLOAD", "Uploaded file is empty")
    if len(body) > MAX_IMAGE_BYTES:
        raise AppError(
            400,
            "FILE_TOO_LARGE",
            f"Max size is {MAX_IMAGE_BYTES // (1024 * 1024)} MB",
        )

    ext = EXT_BY_CONTENT_TYPE[content_type]
    key = f"products/{uuid.uuid4().hex}.{ext}"

    # boto3 is sync; offload to a thread so the event loop stays responsive
    # while the upload streams to S3.
    def _put():
        s3_client().put_object(
            Bucket=PRODUCT_IMAGES_BUCKET,
            Key=key,
            Body=body,
            ContentType=content_type,
            CacheControl="public, max-age=31536000, immutable",
        )

    try:
        await asyncio.to_thread(_put)
    except (BotoCoreError, ClientError):
        logger.exception("S3 PutObject failed for key=%s", key)
        raise AppError(502, "STORAGE_UNAVAILABLE", "Could not store the image")

    return success({
        "image_url": f"https://{PRODUCT_IMAGES_PUBLIC_BASE}/{key}",
        "key": key,
        "content_type": content_type,
        "size_bytes": len(body),
    })


app.include_router(router)
