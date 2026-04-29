from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import asyncpg

from shared.config import settings


_pool: asyncpg.Pool | None = None


def _as_dict(record: asyncpg.Record | None) -> dict[str, Any] | None:
    return dict(record) if record is not None else None


async def init_db() -> None:
    """Initialize a shared asyncpg pool with retries for container startup.

    Docker Compose waits for the PostgreSQL healthcheck, but a short retry loop
    makes local startup more resilient and avoids fragile first-run failures.
    """
    global _pool
    if _pool is not None:
        return

    last_error: Exception | None = None
    for attempt in range(1, 16):
        try:
            _pool = await asyncpg.create_pool(
                dsn=settings.database_url,
                min_size=1,
                max_size=10,
                command_timeout=30,
            )
            return
        except Exception as exc:  # pragma: no cover - startup resilience path
            last_error = exc
            print(f"[db] connection attempt {attempt}/15 failed: {exc!r}", flush=True)
            await asyncio.sleep(min(0.5 * attempt, 3.0))

    raise RuntimeError(f"Could not connect to PostgreSQL: {last_error!r}")


async def close_db() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool is not initialized")
    return _pool


async def fetch(sql: str, *args: Any) -> list[dict[str, Any]]:
    rows = await pool().fetch(sql, *args)
    return [dict(row) for row in rows]


async def fetchrow(sql: str, *args: Any) -> dict[str, Any] | None:
    return _as_dict(await pool().fetchrow(sql, *args))


async def execute(sql: str, *args: Any) -> str:
    return await pool().execute(sql, *args)


@asynccontextmanager
async def transaction() -> AsyncIterator[asyncpg.Connection]:
    conn = await pool().acquire()
    try:
        async with conn.transaction():
            yield conn
    finally:
        await pool().release(conn)
