from __future__ import annotations

import json
from typing import Any

import boto3

from shared.config import settings

# boto3 clients are thread-safe and cheap to reuse. Initialised lazily so the
# import doesn't crash in test environments without AWS creds.
_sqs = None


def _client():
    global _sqs
    if _sqs is None:
        _sqs = boto3.client("sqs", region_name=settings.aws_region)
    return _sqs


async def publish_invoice_event(payload: dict[str, Any]) -> None:
    """Send an invoice-request event to SQS.

    Consumed by the invoice-generator Lambda (see lambda/invoice_generator/).
    boto3 is sync; we run it in a thread to avoid blocking the event loop.
    """
    import asyncio

    body = json.dumps(payload)
    queue_url = settings.invoice_queue_url

    await asyncio.to_thread(
        _client().send_message,
        QueueUrl=queue_url,
        MessageBody=body,
    )
