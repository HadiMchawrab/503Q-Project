"""SQS-triggered Lambda that renders an invoice PDF, uploads to S3, emails it via
SES, and marks the order as `invoice_status = 'sent'` in RDS.

Replaces the long-running invoice-worker pod that previously consumed a Redis
stream. Designed for at-least-once delivery: re-runs are idempotent.
"""
from __future__ import annotations

import io
import json
import os
from typing import Any

import boto3
import psycopg
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

s3 = boto3.client("s3")
ses = boto3.client("ses")
secrets = boto3.client("secretsmanager")

BUCKET = os.environ["INVOICES_BUCKET"]
SENDER = os.environ["SES_SENDER"]
DB_HOST = os.environ["DB_HOST"]
DB_NAME = os.environ["DB_NAME"]
DB_USER = os.environ["DB_USER"]
DB_SECRET_ARN = os.environ["DB_SECRET_ARN"]

_db_password: str | None = None


def db_password() -> str:
    global _db_password
    if _db_password is None:
        # Fetched once per Lambda container — cached across warm invocations.
        _db_password = secrets.get_secret_value(SecretId=DB_SECRET_ARN)["SecretString"]
    return _db_password


def connect():
    return psycopg.connect(
        host=DB_HOST,
        dbname=DB_NAME,
        user=DB_USER,
        password=db_password(),
        connect_timeout=5,
    )


def cents_to_dollars(cents: int) -> str:
    return f"{cents / 100:.2f}"


def load_order(order_id: str) -> dict[str, Any]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT o.id, o.total_cents, o.shipping_address, o.invoice_status,
                   o.created_at, u.name AS customer_name, u.email AS customer_email
            FROM orders o JOIN users u ON u.id = o.user_id
            WHERE o.id = %s
            """,
            (order_id,),
        )
        row = cur.fetchone()
        if not row:
            raise RuntimeError(f"Order {order_id} not found")
        cols = [d.name for d in cur.description]
        order = dict(zip(cols, row))

        cur.execute(
            """
            SELECT product_name, quantity, unit_price_cents, line_total_cents
            FROM order_items
            WHERE order_id = %s
            ORDER BY product_name
            """,
            (order_id,),
        )
        item_cols = [d.name for d in cur.description]
        order["items"] = [dict(zip(item_cols, r)) for r in cur.fetchall()]
    return order


def render_pdf(order: dict[str, Any]) -> bytes:
    buf = io.BytesIO()
    pdf = canvas.Canvas(buf, pagesize=LETTER)
    width, height = LETTER
    y = height - 72

    pdf.setFont("Helvetica-Bold", 22)
    pdf.drawString(72, y, "ShopCloud Invoice")
    y -= 34

    pdf.setFont("Helvetica", 10)
    pdf.drawString(72, y, f"Order ID: {order['id']}")
    y -= 16
    pdf.drawString(72, y, f"Date: {order['created_at']}")
    y -= 16
    pdf.drawString(72, y, f"Customer: {order['customer_name']} <{order['customer_email']}>")
    y -= 16
    pdf.drawString(72, y, f"Shipping address: {order['shipping_address']}")
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
        line = f"{item['product_name']}  x {item['quantity']}  ${cents_to_dollars(item['line_total_cents'])}"
        pdf.drawString(72, y, line)
        y -= 16

    y -= 20
    pdf.setFont("Helvetica-Bold", 15)
    pdf.drawRightString(width - 72, y, f"Total: ${cents_to_dollars(order['total_cents'])}")
    pdf.save()

    return buf.getvalue()


def mark_sent(order_id: str, s3_key: str) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE orders SET invoice_status = 'sent', invoice_url = %s WHERE id = %s",
            (s3_key, order_id),
        )
        conn.commit()


def process(msg: dict[str, Any]) -> None:
    order_id = msg["orderId"]
    order = load_order(order_id)

    # Idempotency: SQS is at-least-once and Lambda may retry on timeout.
    # Skip if we've already sent the invoice for this order.
    if order["invoice_status"] == "sent":
        print(f"[invoice] order {order_id} already sent, skipping")
        return

    pdf_bytes = render_pdf(order)
    key = f"invoices/{order_id}.pdf"
    s3.put_object(
        Bucket=BUCKET,
        Key=key,
        Body=pdf_bytes,
        ContentType="application/pdf",
        ServerSideEncryption="AES256",
    )

    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=86400,  # 24 hours
    )

    ses.send_email(
        Source=SENDER,
        Destination={"ToAddresses": [order["customer_email"]]},
        Message={
            "Subject": {"Data": f"Your ShopCloud invoice — order {order_id}"},
            "Body": {
                "Html": {"Data": f'<p>Thanks for your order.</p><p><a href="{url}">Download your invoice</a> (link valid 24h).</p>'},
                "Text": {"Data": f"Thanks for your order. Download your invoice: {url}"},
            },
        },
    )

    mark_sent(order_id, key)
    print(f"[invoice] order {order_id} done — emailed {order['customer_email']}")


def handler(event: dict[str, Any], _ctx: Any) -> dict[str, Any]:
    """SQS event handler with per-record failure reporting.

    Returning batchItemFailures lets SQS retry only the failed messages instead
    of the whole batch.
    """
    failures: list[dict[str, str]] = []
    for record in event.get("Records", []):
        try:
            body = json.loads(record["body"])
            process(body)
        except Exception as exc:
            print(f"[invoice] failure msg={record.get('messageId')}: {exc!r}")
            failures.append({"itemIdentifier": record["messageId"]})
    return {"batchItemFailures": failures}
