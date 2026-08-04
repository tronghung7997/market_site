from datetime import datetime, timezone

import structlog
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import SessionLocal
from src.models.alert import Alert

logger = structlog.get_logger()


# --- Fingerprint builders (audience target ≠ incident identity) ---

def fp_provider(provider_id: int, kind: str) -> str:
    return f"provider:{provider_id}:{kind}"


def fp_order(order_id: int, kind: str) -> str:
    return f"order:{order_id}:{kind}"


def fp_variant(variant_id: int, kind: str) -> str:
    return f"variant:{variant_id}:{kind}"


def fp_resource(resource_id: int, kind: str) -> str:
    return f"resource:{resource_id}:{kind}"


def fp_deposit(deposit_id: int, reason_code: str) -> str:
    return f"deposit:{deposit_id}:{reason_code}"


async def add_alert(
    db: AsyncSession,
    *,
    type_: str,
    severity: str,
    target_type: str,
    target_id: int,
    message: str,
    fingerprint: str | None = None,
) -> Alert:
    """Add a one-off alert to the caller transaction. Never commits.

    Use for facts that should roll back with the domain mutation (e.g.
    dispute_opened). For repeatable operational conditions prefer
    upsert_incident / emit_incident.
    """
    now = datetime.now(timezone.utc)
    alert = Alert(
        type=type_,
        severity=severity,
        target_type=target_type,
        target_id=target_id,
        message=message,
        fingerprint=fingerprint,
        is_active=True,
        first_seen_at=now,
        last_seen_at=now,
        occurrence_count=1,
    )
    db.add(alert)
    await db.flush()
    return alert


async def upsert_incident(
    db: AsyncSession,
    *,
    fingerprint: str,
    type_: str,
    severity: str,
    target_type: str,
    target_id: int,
    message: str,
) -> Alert:
    """Atomic INSERT ... ON CONFLICT DO UPDATE for active fingerprint.

    Never commits — the service/job that owns the transaction must commit.
    Recurrence of a dismissed incident creates a new active row because the
    partial unique index only covers is_active = true.
    """
    if not fingerprint:
        raise ValueError("fingerprint is required for upsert_incident")

    now = datetime.now(timezone.utc)
    table = Alert.__table__
    stmt = pg_insert(table).values(
        type=type_,
        severity=severity,
        target_type=target_type,
        target_id=target_id,
        message=message,
        fingerprint=fingerprint,
        is_active=True,
        first_seen_at=now,
        last_seen_at=now,
        occurrence_count=1,
        resolved_at=None,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["fingerprint"],
        index_where=text("is_active = true AND fingerprint IS NOT NULL"),
        set_={
            "last_seen_at": now,
            "occurrence_count": table.c.occurrence_count + 1,
            "message": stmt.excluded.message,
            "severity": stmt.excluded.severity,
            "target_type": stmt.excluded.target_type,
            "target_id": stmt.excluded.target_id,
            "type": stmt.excluded.type,
        },
    ).returning(table.c.id)

    result = await db.execute(stmt)
    row_id = result.scalar_one()
    await db.flush()
    alert = await db.get(Alert, row_id)
    if alert is None:
        alert = await db.scalar(select(Alert).where(Alert.id == row_id))
    else:
        # ON CONFLICT updates the row in the DB; identity-map may still hold
        # the pre-update occurrence_count / timestamps.
        await db.refresh(alert)
    assert alert is not None
    return alert


async def emit_incident(
    *,
    fingerprint: str,
    type_: str,
    severity: str,
    target_type: str,
    target_id: int,
    message: str,
) -> None:
    """Own SessionLocal, upsert + commit, best effort, never raises.

    Use after caller rollback or outside a domain transaction so the
    incident still lands without owning the caller's session.
    """
    try:
        async with SessionLocal() as db:
            await upsert_incident(
                db,
                fingerprint=fingerprint,
                type_=type_,
                severity=severity,
                target_type=target_type,
                target_id=target_id,
                message=message,
            )
            await db.commit()
    except Exception as e:  # noqa: BLE001 — best effort
        logger.warning(
            "emit_incident_failed",
            fingerprint=fingerprint,
            type=type_,
            error=str(e),
        )


async def list_active_alerts(db: AsyncSession) -> list[Alert]:
    result = await db.execute(select(Alert).where(Alert.is_active).order_by(Alert.created_at.desc()))
    return list(result.scalars().all())


async def dismiss_alert(alert_id: int, db: AsyncSession) -> Alert:
    alert = await db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Không tìm thấy cảnh báo")
    alert.is_active = False
    alert.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(alert)
    return alert


async def dismiss_seller_alert(alert_id: int, seller_id: int, db: AsyncSession) -> Alert:
    alert = await db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Không tìm thấy cảnh báo")
    if alert.target_type != "seller" or alert.target_id != seller_id:
        raise HTTPException(status_code=403, detail="Đây không phải cảnh báo của bạn")
    alert.is_active = False
    alert.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(alert)
    return alert


async def list_seller_alerts(seller_id: int, db: AsyncSession) -> list[Alert]:
    result = await db.execute(
        select(Alert).where(Alert.is_active, Alert.target_type == "seller", Alert.target_id == seller_id)
        .order_by(Alert.created_at.desc())
    )
    return list(result.scalars().all())
