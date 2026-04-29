from __future__ import annotations

import asyncio

import redis.asyncio as redis

from shared.config import settings


_client: redis.Redis | None = None


async def init_redis() -> None:
    """Initialize Redis with a short retry loop for reliable local startup."""
    global _client
    if _client is not None:
        return

    last_error: Exception | None = None
    for attempt in range(1, 16):
        try:
            candidate = redis.from_url(settings.redis_url, decode_responses=True)
            await candidate.ping()
            _client = candidate
            return
        except Exception as exc:  # pragma: no cover - startup resilience path
            last_error = exc
            print(f"[redis] connection attempt {attempt}/15 failed: {exc!r}", flush=True)
            await asyncio.sleep(min(0.5 * attempt, 3.0))

    raise RuntimeError(f"Could not connect to Redis: {last_error!r}")


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def client() -> redis.Redis:
    if _client is None:
        raise RuntimeError("Redis client is not initialized")
    return _client
