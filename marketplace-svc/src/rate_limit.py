import asyncio
import time

import structlog
from redis import asyncio as aioredis

from src.config import settings

logger = structlog.get_logger()

_client: aioredis.Redis | None = None
_fallback_lock = asyncio.Lock()
_fallback_windows: dict[str, tuple[float, int]] = {}


def _get_client() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=0.25,
            socket_timeout=0.25,
        )
    return _client


async def _check_in_memory_fallback(key: str, *, limit: int, window_seconds: int) -> bool:
    """Bounded per-process fallback for security-sensitive limits.

    This is intentionally a degraded control, not a replacement for Redis:
    multiple workers each get a bucket. It still prevents a Redis outage from
    turning login into a completely unthrottled endpoint.
    """
    now = time.monotonic()
    async with _fallback_lock:
        if len(_fallback_windows) > 10_000:
            expired = [bucket for bucket, (expires_at, _) in _fallback_windows.items() if expires_at <= now]
            for bucket in expired:
                _fallback_windows.pop(bucket, None)

        expires_at, count = _fallback_windows.get(key, (now + window_seconds, 0))
        if expires_at <= now:
            expires_at, count = now + window_seconds, 0
        count += 1
        _fallback_windows[key] = (expires_at, count)
        return count <= limit


async def check_rate_limit(
    key: str,
    *,
    limit: int,
    window_seconds: int,
    fail_open: bool = True,
) -> bool:
    """Fixed-window counter — `key` gets at most `limit` calls per
    `window_seconds`. Returns True if this call is allowed.

    Existing non-sensitive callers default to fail-open. Authentication passes
    ``fail_open=False`` and gets a bounded in-memory fallback when Redis is
    unavailable.
    """
    try:
        client = _get_client()
        redis_key = f"ratelimit:{key}:{window_seconds}"
        count = await client.incr(redis_key)
        if count == 1:
            await client.expire(redis_key, window_seconds)
        return count <= limit
    except Exception as e:
        if fail_open:
            logger.warning("rate_limit_check_failed_failing_open", key=key, error=str(e))
            return True
        logger.error("rate_limit_redis_failed_using_local_fallback", key=key, error=str(e))
        return await _check_in_memory_fallback(key, limit=limit, window_seconds=window_seconds)
