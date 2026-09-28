"""Async TTL cache with single-flight: concurrent callers share one upstream fetch,
and a failed refresh keeps serving the last good value (stale-while-error)."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable

log = logging.getLogger("albedo.cache")

_store: dict[str, tuple[float, Any]] = {}
_locks: dict[str, asyncio.Lock] = {}


async def cached(key: str, ttl: int, fetch: Callable[[], Awaitable[Any]]) -> Any:
    hit = _store.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        hit = _store.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        try:
            value = await fetch()
        except Exception as exc:
            log.warning("refresh %s failed (%s: %s)", key, type(exc).__name__, str(exc)[:200])
            if hit:
                return hit[1]
            raise
        _store[key] = (time.time(), value)
        return value


def peek(key: str) -> Any | None:
    hit = _store.get(key)
    return hit[1] if hit else None


def age_s(key: str) -> float | None:
    hit = _store.get(key)
    return time.time() - hit[0] if hit else None


def put(key: str, value: Any) -> None:
    _store[key] = (time.time(), value)


def clear() -> None:
    _store.clear()
