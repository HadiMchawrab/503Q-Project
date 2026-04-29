from __future__ import annotations

import asyncio
import os
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

from shared import db
from shared.config import settings
from shared.money import cents_to_dollars
from shared.queue import read_invoice_events
from shared.redis_client import close_redis, init_redis


def _safe_text(value: Any) -> str:
    return str(value or "").replace("\n", " ").strip()


async def load_order(order_id: str) -> dict[str, Any]:
    order = await db.fetchrow(
        """
        SELECT o.*, u.name AS customer_name, u.email AS customer_email
        FROM orders o
        JOIN users u ON u.id = o.user_id
        WHERE o.id = $1
        """,
        UUID(order_id),
    )
    if not order:
        raise RuntimeError(f"Order {order_id} not found")

    items = await db.fetch(
        """
        SELECT product_name, quantity, unit_price_cents, line_total_cents
        FROM order_items
        WHERE order_id = $1
        ORDER BY product_name ASC
        """,
        order["id"],
    )
    return {**order, "items": items}


def generate_pdf_invoice(order: dict[str, Any]) -> str:
    output_dir = Path(settings.invoice_output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    filename = f"invoice-{order['id']}.pdf"
    output_path = output_dir / filename

    pdf = canvas.Canvas(str(output_path), pagesize=LETTER)
    width, height = LETTER
    y = height - 72

    pdf.setFont("Helvetica-Bold", 22)
    pdf.drawString(72, y, "ShopCloud Invoice")
    y -= 34

    pdf.setFont("Helvetica", 10)
    pdf.drawString(72, y, f"Order ID: {_safe_text(order['id'])}")
    y -= 16
    pdf.drawString(72, y, f"Date: {_safe_text(order['created_at'])}")
    y -= 16
    pdf.drawString(72, y, f"Customer: {_safe_text(order['customer_name'])} <{_safe_text(order['customer_email'])}>")
    y -= 16
    pdf.drawString(72, y, f"Shipping address: {_safe_text(order['shipping_address'])}")
    y -= 32

    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(72, y, "Items")
    y -= 20

    pdf.setFont("Helvetica", 10)
    for item in order["items"]:
        if y < 100:
            pdf.showPage()
            y = height - 72
            pdf.setFont("Helvetica", 10)
        line = (
            f"{_safe_text(item['product_name'])}  x {item['quantity']}  "
            f"${cents_to_dollars(item['line_total_cents'])}"
        )
        pdf.drawString(72, y, line)
        y -= 16

    y -= 20
    pdf.setFont("Helvetica-Bold", 15)
    pdf.drawRightString(width - 72, y, f"Total: ${cents_to_dollars(order['total_cents'])}")
    y -= 34

    pdf.setFont("Helvetica", 9)
    pdf.drawString(72, y, "Payment confirmation is simulated for the EECE 503Q DevSecOps demo.")
    pdf.save()

    return filename


async def process_event(event: dict[str, Any]) -> None:
    order = await load_order(event["orderId"])
    filename = generate_pdf_invoice(order)
    invoice_url = f"/invoices/{filename}"

    await db.execute(
        """
        UPDATE orders
        SET invoice_status = 'sent', invoice_url = $1
        WHERE id = $2
        """,
        invoice_url,
        order["id"],
    )
    print(
        f"[invoice-worker] Generated {filename}; simulated SES email to {order['customer_email']}",
        flush=True,
    )


async def run() -> None:
    await db.init_db()
    await init_redis()
    print(f"[invoice-worker] listening to Redis stream {settings.invoice_queue_stream}", flush=True)

    last_id = "0-0"
    try:
        while True:
            try:
                events = await read_invoice_events(last_id, count=10, block_ms=5000)
                for event in events:
                    last_id = event["id"]
                    payload = event["payload"]
                    if payload.get("type") == "invoice.requested":
                        await process_event(payload)
            except Exception as exc:
                print(f"[invoice-worker] error: {exc!r}", flush=True)
                await asyncio.sleep(2)
    finally:
        await close_redis()
        await db.close_db()


if __name__ == "__main__":
    asyncio.run(run())
