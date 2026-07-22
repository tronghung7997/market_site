import structlog
from redis import asyncio as aioredis

from src.config import settings

logger = structlog.get_logger()

_client: aioredis.Redis | None = None


def _get_client() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _client


async def check_rate_limit(key: str, *, limit: int, window_seconds: int) -> bool:
    """Fixed-window counter — `key` gets at most `limit` calls per
    `window_seconds`. Returns True if this call is allowed.

    Fails OPEN: if Redis itself is unreachable, the request is allowed and the
    error is logged rather than raised. Rate limiting is a best-effort abuse
    guard, not a security boundary the rest of the system depends on being
    correct (unlike, say, the webhook HMAC check) — a Redis outage taking down
    every gateway call on top of it would trade a minor abuse-prevention gap
    for a hard platform-wide outage, a bad trade.
    """
    try:
        client = _get_client()
        redis_key = f"ratelimit:{key}:{window_seconds}"
        count = await client.incr(redis_key)
        if count == 1:
            await client.expire(redis_key, window_seconds)
        return count <= limit
    except Exception as e:
        logger.warning("rate_limit_check_failed_failing_open", key=key, error=str(e))
        return True
