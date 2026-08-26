from __future__ import annotations

from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import select, update

from src.config import settings
from src.database import SessionLocal
from src.models.mail import MailOutbox, MailOutboxStatus

from .adapters import MailAdapter, MailMessage, MailSendError
from .factory import get_mail_adapter
from .runtime import MailRuntime, current_runtime
from .catalog import lookup_copy
from .templates import render

logger = structlog.get_logger()

_BATCH = 20
_STALE_SENDING = timedelta(minutes=10)
_MAX_ERROR = 500


def _backoff_seconds(attempts: int) -> int:
    return min(1800, 30 * (2 ** max(attempts - 1, 0)))


async def mail_outbox_send_job() -> None:
    from .catalog import ensure_seeded as ensure_templates_seeded
    from .runtime import ensure_seeded

    async with SessionLocal() as db:
        await ensure_seeded(db)
        await ensure_templates_seeded(db)
        await db.commit()
    if not current_runtime().worker_enabled:
        return
    await process_mail_outbox()


async def _persist_send_outcome(
    db,
    row: MailOutbox,
    adapter: MailAdapter | None,
    runtime: MailRuntime,
) -> str:
    now = datetime.now(timezone.utc)
    if adapter is None:
        row.status = MailOutboxStatus.pending.value
        row.scheduled_at = now + timedelta(minutes=5)
        row.last_error = "mail adapter unconfigured"
        row.updated_at = now
        await db.commit()
        return row.status
    try:
        subject, text, html_body = render(
            row.template, row.locale, row.payload, copy=lookup_copy(row.template, row.locale),
        )
        await adapter.send(
            MailMessage(
                to=row.to_email,
                subject=subject,
                text=text,
                html=html_body,
                template=row.template,
                idempotency_key=row.idempotency_key,
                from_email=runtime.mail_from,
                from_name=runtime.mail_from_name,
            )
        )
    except Exception as exc:  # noqa: BLE001 — worker must not die on one row
        row.attempts += 1
        row.last_error = str(exc)[:_MAX_ERROR]
        row.updated_at = datetime.now(timezone.utc)
        if row.attempts >= settings.mail_max_attempts:
            row.status = MailOutboxStatus.failed.value
            logger.error(
                "mail_outbox_failed",
                outbox_id=row.id,
                template=row.template,
                attempts=row.attempts,
                error=str(exc)[:200],
            )
        else:
            row.status = MailOutboxStatus.pending.value
            row.scheduled_at = datetime.now(timezone.utc) + timedelta(
                seconds=_backoff_seconds(row.attempts)
            )
            if not isinstance(exc, MailSendError):
                logger.warning(
                    "mail_outbox_retry",
                    outbox_id=row.id,
                    template=row.template,
                    attempts=row.attempts,
                )
        await db.commit()
        return row.status
    row.status = MailOutboxStatus.sent.value
    row.sent_at = datetime.now(timezone.utc)
    row.updated_at = row.sent_at
    row.last_error = None
    await db.commit()
    logger.info("mail_outbox_sent", outbox_id=row.id, template=row.template)
    return row.status


async def deliver_now(outbox_id: int, *, runtime: MailRuntime | None = None) -> str:
    """Send one outbox row immediately (admin test). Uses its own session."""
    rt = runtime or current_runtime()
    adapter = get_mail_adapter(rt)
    async with SessionLocal() as db:
        row = await db.get(MailOutbox, outbox_id)
        if row is None:
            return "missing"
        return await _persist_send_outcome(db, row, adapter, rt)


async def process_mail_outbox() -> int:
    """Claim pending rows, send outside the claim transaction, persist outcome."""
    from .catalog import ensure_seeded as ensure_templates_seeded

    async with SessionLocal() as db:
        await ensure_templates_seeded(db)
        await db.commit()
    runtime = current_runtime()
    adapter = get_mail_adapter(runtime)
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        await db.execute(
            update(MailOutbox)
            .where(
                MailOutbox.status == MailOutboxStatus.sending.value,
                MailOutbox.updated_at <= now - _STALE_SENDING,
            )
            .values(status=MailOutboxStatus.pending.value, updated_at=now)
        )
        result = await db.execute(
            select(MailOutbox)
            .where(
                MailOutbox.status == MailOutboxStatus.pending.value,
                MailOutbox.scheduled_at <= now,
            )
            .order_by(MailOutbox.id)
            .limit(_BATCH)
            .with_for_update(skip_locked=True)
        )
        rows = list(result.scalars().all())
        if not rows:
            await db.commit()
            return 0
        if adapter is None:
            nxt = now + timedelta(minutes=5)
            for row in rows:
                row.scheduled_at = nxt
                row.updated_at = now
            await db.commit()
            return 0
        for row in rows:
            row.status = MailOutboxStatus.sending.value
            row.updated_at = now
        await db.commit()
        claimed_ids = [row.id for row in rows]

    sent = 0
    for row_id in claimed_ids:
        async with SessionLocal() as db:
            row = await db.get(MailOutbox, row_id)
            if row is None:
                continue
            status = await _persist_send_outcome(db, row, adapter, runtime)
            if status == MailOutboxStatus.sent.value:
                sent += 1
    return sent
