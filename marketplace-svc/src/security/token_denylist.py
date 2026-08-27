"""Best-effort Redis denylist for access-token JTIs.

PostgreSQL session rows are the source of truth. Redis is a fast path that
expires with the access token; if Redis is down, session checks still apply.
"""

from datetime import datetime, timezone

import structlog
from redis import asyncio as aioredis

from src.config import settings

logger = structlog.get_logger()

_client: aioredis.Redis | None = None


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


def _key(jti: str) -> str:
    return f"jwt:deny:{jti}"


async def deny_jti(jti: str, expires_at: datetime | None) -> None:
    if not jti:
        return
    now = datetime.now(timezone.utc)
    if expires_at is not None:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        ttl = int((expires_at - now).total_seconds())
    else:
        ttl = settings.jwt_expire_minutes * 60
    if ttl <= 0:
        return
    try:
        await _get_client().set(_key(jti), "1", ex=ttl)
    except Exception as exc:
        logger.warning("access_jti_denylist_write_failed", error=str(exc))


async def jti_is_denied(jti: str) -> bool:
    if not jti:
        return False
    try:
        return bool(await _get_client().exists(_key(jti)))
    except Exception as exc:
        logger.warning("access_jti_denylist_read_failed", error=str(exc))
        return False
