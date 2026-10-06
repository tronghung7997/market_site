from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import select, update

from src.config import settings
from src.database import SessionLocal
from src.models.mail import MailOutbox, MailOutboxStatus

from .adapters import MailAdapter, MailMessage, MailSendError, PermanentMailSendError
from .factory import get_mail_adapter
from .catalog import CopySnapshot, load_copies, lookup_copy
from .runtime import MailRuntime, load_runtime
from .templates import render

logger = structlog.get_logger()

_BATCH = 20
_STALE_SENDING = timedelta(minutes=10)
# Rows stuck in `sending` only exist after a crash mid-send; looking for them
# on every 20 s tick was most of the idle cost. Process start always sweeps.
_STALE_SWEEP_EVERY = 300.0  # seconds
_MAX_ERROR = 500

_last_stale_sweep: float | None = None


def _backoff_seconds(attempts: int) -> int:
    return min(1800, 30 * (2 ** max(attempts - 1, 0)))


def _stale_sweep_due() -> bool:
    return _last_stale_sweep is None or time.monotonic() - _last_stale_sweep >= _STALE_SWEEP_EVERY


def _mark_stale_swept() -> None:
    global _last_stale_sweep
    _last_stale_sweep = time.monotonic()


def _due_rows(now: datetime):
    return (
        MailOutbox.status == MailOutboxStatus.pending.value,
        MailOutbox.scheduled_at <= now,
    )


async def mail_outbox_send_job() -> None:
    """Scheduler tick. An idle tick is one indexed probe of the outbox.

    Runtime config (provider, from, ``worker_enabled``) is read from the DB
    only when there is something to send, and then fresh on every such tick,
    so switching the worker off stops the very next batch.
    """
    sweep = _stale_sweep_due()
    async with SessionLocal() as db:
        if not sweep:
            due = await db.scalar(select(MailOutbox.id).where(*_due_rows(datetime.now(timezone.utc))).limit(1))
            if due is None:
                await db.commit()
                return
        runtime = await load_runtime(db)
        await db.commit()
    if not runtime.worker_enabled:
        return
    await process_mail_outbox(runtime=runtime, requeue_stale=sweep)


async def _persist_send_outcome(
    db,
    row: MailOutbox,
    adapter: MailAdapter | None,
    runtime: MailRuntime,
    copies: CopySnapshot,
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
            row.template, row.locale, row.payload,
            copy=lookup_copy(row.template, row.locale, copies),
            brand=runtime.mail_from_name,
            site_url=settings.frontend_base_url,
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
        if isinstance(exc, PermanentMailSendError) or row.attempts >= settings.mail_max_attempts:
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
    async with SessionLocal() as db:
        rt = runtime or await load_runtime(db)
        adapter = get_mail_adapter(rt)
        row = await db.get(MailOutbox, outbox_id)
        if row is None:
            await db.commit()
            return "missing"
        copies = await load_copies(db, [(row.template, row.locale)])
        return await _persist_send_outcome(db, row, adapter, rt, copies)


async def process_mail_outbox(
    *,
    runtime: MailRuntime | None = None,
    copies: CopySnapshot | None = None,
    requeue_stale: bool = True,
) -> int:
    """Claim pending rows, send outside the claim transaction, persist outcome.

    Runtime and template copy are resolved from the DB once per batch and
    reused for every row, so an admin edit landing mid-batch cannot change
    provider/from/copy between rows. Copy is read only for the templates and
    locales of the claimed rows.
    """
    if runtime is None:
        async with SessionLocal() as db:
            runtime = await load_runtime(db)
            await db.commit()
    adapter = get_mail_adapter(runtime)
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        if requeue_stale:
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
            .where(*_due_rows(now))
            .order_by(MailOutbox.id)
            .limit(_BATCH)
            .with_for_update(skip_locked=True)
        )
        rows = list(result.scalars().all())
        if rows and adapter is None:
            nxt = now + timedelta(minutes=5)
            for row in rows:
                row.scheduled_at = nxt
                row.updated_at = now
            rows = []
        for row in rows:
            row.status = MailOutboxStatus.sending.value
            row.updated_at = now
        if rows and copies is None:
            copies = await load_copies(db, [(row.template, row.locale) for row in rows])
        await db.commit()
    if requeue_stale:
        _mark_stale_swept()
    claimed_ids = [row.id for row in rows]

    sent = 0
    for row_id in claimed_ids:
        async with SessionLocal() as db:
            row = await db.get(MailOutbox, row_id)
            if row is None:
                continue
            status = await _persist_send_outcome(db, row, adapter, runtime, copies)
            if status == MailOutboxStatus.sent.value:
                sent += 1
    return sent
