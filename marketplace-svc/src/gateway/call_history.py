from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import SessionLocal
from src.models.usage import GatewayCallLog

logger = structlog.get_logger()

# Response bodies can be large (TikTok/YouTube profile payloads run tens of
# KB) — this is a "what did I get" preview for the history list, not a
# durable copy. Same capping idea as ProviderCallLog's error truncation.
_RESPONSE_SNIPPET_MAX_LEN = 4000
_ERROR_MAX_LEN = 500


async def record_gateway_call_log(
    *,
    order_id: int,
    endpoint: str,
    latency_ms: int,
    status_code: int | None = None,
    request_payload: dict | None = None,
    response_body: bytes | None = None,
    error: str | None = None,
) -> None:
    """Persist one buyer-facing gateway call on its own session — mirrors
    adapters/call_log.py::record_provider_call. Never raises: a history
    write must not be what breaks a real gateway call.
    """
    response_snippet: str | None = None
    if response_body:
        try:
            response_snippet = response_body.decode("utf-8", errors="replace")
        except Exception:
            response_snippet = None
        if response_snippet and len(response_snippet) > _RESPONSE_SNIPPET_MAX_LEN:
            response_snippet = response_snippet[:_RESPONSE_SNIPPET_MAX_LEN] + "…(cắt bớt)"

    if error is not None and len(error) > _ERROR_MAX_LEN:
        error = error[:_ERROR_MAX_LEN]

    try:
        async with SessionLocal() as session:
            session.add(
                GatewayCallLog(
                    order_id=order_id,
                    endpoint=endpoint,
                    status_code=status_code,
                    latency_ms=latency_ms,
                    request_payload=request_payload,
                    response_snippet=response_snippet,
                    error=error,
                )
            )
            await session.commit()
    except Exception as e:
        logger.warning(
            "gateway_call_log_failed", order_id=order_id, endpoint=endpoint, error=str(e),
        )


async def list_gateway_call_logs(
    order_id: int,
    db: AsyncSession,
    *,
    endpoint: str | None = None,
    status_code: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[GatewayCallLog]:
    query = select(GatewayCallLog).where(GatewayCallLog.order_id == order_id)
    if endpoint:
        query = query.where(GatewayCallLog.endpoint == endpoint)
    if status_code is not None:
        query = query.where(GatewayCallLog.status_code == status_code)
    query = query.order_by(GatewayCallLog.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def purge_old_gateway_call_logs() -> int:
    """Delete rows older than settings.gateway_call_log_retention_days.

    Safe to run on any schedule — this table is a recent-only convenience
    log, never the source of truth for billing/quota (that's usage_records,
    untouched here). Returns the number of rows deleted, for the job log.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.gateway_call_log_retention_days)
    async with SessionLocal() as db:
        result = await db.execute(delete(GatewayCallLog).where(GatewayCallLog.created_at < cutoff))
        await db.commit()
        return result.rowcount or 0
