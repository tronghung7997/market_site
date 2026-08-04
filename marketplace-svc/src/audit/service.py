from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import SessionLocal
from src.models.alert import Alert
from src.models.log_entry import LogEntry
from src.models.provider import ProviderCallLog
from src.models.usage import GatewayCallLog

_COMMON_AUDIT_KEYS = (
    "event", "actor_id", "actor_type", "subject_type", "subject_id", "outcome", "source",
)

_CLEANUP_BATCH_SIZE = 1000


async def log_event(
    db: AsyncSession, level: str, message: str, *,
    request_id: str | None = None, job_id: str | None = None, metadata: dict | None = None,
) -> None:
    """Append a business audit row to the caller's transaction. Never commits.

    New privileged events should include the common fields from the logging
    review (event, actor_id, subject_type/id, outcome, source). Existing
    call sites remain compatible — metadata is stored as provided.
    """
    meta = dict(metadata) if metadata else None
    # Bound request_id to VARCHAR(36) so a bad correlation id cannot fail the
    # business transaction that owns this insert.
    safe_request_id = request_id
    if safe_request_id is not None and len(safe_request_id) > 36:
        safe_request_id = safe_request_id[:36]
    db.add(LogEntry(
        service="marketplace-svc", level=level, message=message,
        request_id=safe_request_id, job_id=job_id, metadata_=meta,
    ))


async def query_logs(
    db: AsyncSession,
    *,
    request_id: str | None = None,
    job_id: str | None = None,
    order_id: int | None = None,
    level: str | None = None,
    limit: int = 100,
    since: datetime | None = None,
    until: datetime | None = None,
    before_id: int | None = None,
) -> list[LogEntry]:
    if limit < 1 or limit > 200:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 200")
    if before_id is not None and before_id < 1:
        raise HTTPException(status_code=422, detail="before_id must be a positive integer")
    if since is not None and until is not None and since > until:
        raise HTTPException(status_code=422, detail="since must be before until")

    stmt = select(LogEntry)
    if request_id:
        stmt = stmt.where(LogEntry.request_id == request_id)
    if job_id:
        stmt = stmt.where(LogEntry.job_id == job_id)
    if level:
        stmt = stmt.where(LogEntry.level == level)
    if order_id is not None:
        stmt = stmt.where(LogEntry.metadata_["order_id"].astext == str(order_id))
    if since is not None:
        stmt = stmt.where(LogEntry.created_at >= since)
    if until is not None:
        stmt = stmt.where(LogEntry.created_at <= until)
    if before_id is not None:
        stmt = stmt.where(LogEntry.id < before_id)
    stmt = stmt.order_by(LogEntry.created_at.desc(), LogEntry.id.desc()).limit(limit)
    return list((await db.execute(stmt)).scalars().all())


async def _delete_in_batches(session, stmt_factory) -> int:
    """Delete and commit one bounded batch at a time. Returns total deleted."""
    total = 0
    while True:
        # PostgreSQL supports DELETE ... WHERE id IN (SELECT ... LIMIT n)
        result = await session.execute(stmt_factory())
        deleted = max(result.rowcount or 0, 0)
        total += deleted
        # Release row locks and bound WAL/transaction size before the next
        # batch. Partial cleanup is safe and the next scheduled run resumes it.
        await session.commit()
        if deleted < _CLEANUP_BATCH_SIZE:
            break
    return total


async def purge_operational_logs() -> dict[str, int]:
    """Bounded retention cleanup for non-ledger operational tables.

    Never touches usage_records, transactions, wallets, or other money ledgers.
    Active alerts are retained; only resolved/dismissed alerts older than the
    window are purged.
    """
    import time
    import structlog

    logger = structlog.get_logger()
    started = time.monotonic()
    now = datetime.now(timezone.utc)
    counts: dict[str, int] = {}

    async with SessionLocal() as db:
        # gateway_call_logs
        gw_cutoff = now - timedelta(days=settings.gateway_call_log_retention_days)
        counts["gateway_call_logs"] = await _delete_in_batches(
            db,
            lambda: delete(GatewayCallLog).where(
                GatewayCallLog.id.in_(
                    select(GatewayCallLog.id)
                    .where(GatewayCallLog.created_at < gw_cutoff)
                    .limit(_CLEANUP_BATCH_SIZE)
                )
            ),
        )

        # provider_call_logs
        pcl_cutoff = now - timedelta(days=settings.provider_call_log_retention_days)
        counts["provider_call_logs"] = await _delete_in_batches(
            db,
            lambda: delete(ProviderCallLog).where(
                ProviderCallLog.id.in_(
                    select(ProviderCallLog.id)
                    .where(ProviderCallLog.created_at < pcl_cutoff)
                    .limit(_CLEANUP_BATCH_SIZE)
                )
            ),
        )

        # log_entries
        le_cutoff = now - timedelta(days=settings.log_entry_retention_days)
        counts["log_entries"] = await _delete_in_batches(
            db,
            lambda: delete(LogEntry).where(
                LogEntry.id.in_(
                    select(LogEntry.id)
                    .where(LogEntry.created_at < le_cutoff)
                    .limit(_CLEANUP_BATCH_SIZE)
                )
            ),
        )

        # resolved alerts only
        ra_cutoff = now - timedelta(days=settings.resolved_alert_retention_days)
        counts["resolved_alerts"] = await _delete_in_batches(
            db,
            lambda: delete(Alert).where(
                Alert.id.in_(
                    select(Alert.id)
                    .where(
                        Alert.is_active.is_(False),
                        Alert.resolved_at.isnot(None),
                        Alert.resolved_at < ra_cutoff,
                    )
                    .limit(_CLEANUP_BATCH_SIZE)
                )
            ),
        )
    elapsed_ms = int((time.monotonic() - started) * 1000)
    logger.info(
        "operational_log_cleanup",
        **counts,
        elapsed_ms=elapsed_ms,
    )
    return counts
