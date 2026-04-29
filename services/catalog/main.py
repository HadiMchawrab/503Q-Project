from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Query

from shared import db
from shared.errors import AppError, success
from shared.ids import parse_uuid
from shared.service import create_app


SORT_ORDER: dict[str, str] = {
    "price-asc": "price_cents ASC, name ASC",
    "price-desc": "price_cents DESC, name ASC",
    "stock-asc": "stock ASC, name ASC",
    "newest": "created_at DESC",
    "name": "name ASC",
}


@asynccontextmanager
async def lifespan(_):
    await db.init_db()
    yield
    await db.close_db()


app = create_app("catalog", lifespan=lifespan)


@app.get("/products")
async def list_products(
    search: str = Query(default=""),
    category: str = Query(default=""),
    inStock: bool = Query(default=False),
    sort: str = Query(default="newest"),
):
    conditions = ["is_active = TRUE"]
    args: list[object] = []

    search = search.strip()
    category = category.strip()
    order_by = SORT_ORDER.get(sort, SORT_ORDER["newest"])

    if search:
        args.append(f"%{search}%")
        idx = len(args)
        conditions.append(
            f"(name ILIKE ${idx} OR description ILIKE ${idx} OR sku ILIKE ${idx} OR category ILIKE ${idx})"
        )

    if category:
        args.append(category)
        conditions.append(f"category = ${len(args)}")

    if inStock:
        conditions.append("stock > 0")

    rows = await db.fetch(
        f"""
        SELECT id, sku, name, description, category, price_cents, image_url, stock
        FROM products
        WHERE {' AND '.join(conditions)}
        ORDER BY {order_by}
        """,
        *args,
    )

    return success(
        {
            "products": rows,
            "filters": {
                "search": search,
                "category": category,
                "inStock": inStock,
                "sort": sort,
            },
            "count": len(rows),
        }
    )


@app.get("/products/{product_id}")
async def get_product(product_id: str):
    product = await db.fetchrow(
        """
        SELECT id, sku, name, description, category, price_cents, image_url, stock
        FROM products
        WHERE id = $1 AND is_active = TRUE
        """,
        parse_uuid(product_id, "product id"),
    )
    if not product:
        raise AppError(404, "PRODUCT_NOT_FOUND", "Product not found")
    return success({"product": product})


@app.get("/categories")
async def categories():
    rows = await db.fetch(
        """
        SELECT category, COUNT(*)::int AS products, COALESCE(SUM(stock), 0)::int AS total_stock
        FROM products
        WHERE is_active = TRUE
        GROUP BY category
        ORDER BY category ASC
        """
    )
    return success({"categories": rows})
