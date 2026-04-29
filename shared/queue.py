from __future__ import annotations

import json
from typing import Any

from shared.config import settings
from shared.redis_client import client


async def publish_invoice_event(payload: dict[str, Any]) -> None:
    await client().xadd(
        settings.invoice_queue_stream,
        {"payload": json.dumps(payload)},
        maxlen=1000,
        approximate=True,
    )


async def read_invoice_events(
    last_id: str,
    count: int = 10,
    block_ms: int = 5000,
) -> list[dict[str, Any]]:
    streams = await client().xread(
        {settings.invoice_queue_stream: last_id},
        count=count,
        block=block_ms,
    )
    events: list[dict[str, Any]] = []
    for _, messages in streams:
        for message_id, fields in messages:
            payload_raw = fields.get("payload", "{}")
            events.append({"id": message_id, "payload": json.loads(payload_raw)})
    return events
