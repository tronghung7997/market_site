import time
from datetime import datetime, timedelta, timezone

import pytest
import httpx
from sqlalchemy import func, select, update

from src.database import SessionLocal
from src.mail.adapters import (
    MailMessage,
    MailSendError,
    PermanentMailSendError,
    RecordingMailAdapter,
    ResendMailAdapter,
)
from src.mail.factory import get_mail_adapter, set_mail_adapter
from src.mail.service import enqueue_mail
from src.mail.templates import UnknownMailTemplate
from src.mail import worker as mail_worker
from src.mail.runtime import ensure_seeded as ensure_runtime_seeded
from src.mail.worker import mail_outbox_send_job, process_mail_outbox
from src.models.mail import MailOutbox, MailOutboxStatus
from src.models.mail_runtime_config import MailRuntimeConfig
from tests.conftest import statement_log


@pytest.fixture
def recording_mail():
    adapter = RecordingMailAdapter()
    set_mail_adapter(adapter)
    yield adapter
    set_mail_adapter(None)


@pytest.mark.no_db
def test_log_adapter_is_default_when_unconfigured():
    from src.mail.adapters import LogMailAdapter
    from src.mail.factory import mail_configured

    set_mail_adapter(None)
    assert mail_configured() is True
    adapter = get_mail_adapter()
    assert isinstance(adapter, LogMailAdapter)


@pytest.mark.no_db
@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status_code", "error_type"),
    [(403, PermanentMailSendError), (422, PermanentMailSendError), (429, MailSendError), (503, MailSendError)],
)
async def test_resend_classifies_permanent_and_transient_errors(monkeypatch, status_code, error_type):
    async def fake_post(_client, _url, **_kwargs):
        return httpx.Response(status_code)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    with pytest.raises(error_type, match=f"resend_http_{status_code}") as caught:
        await ResendMailAdapter().send(
            MailMessage(
                to="recipient@example.com",
                subject="Test",
                text="Test body",
                from_email="sender@example.com",
            )
        )
    assert type(caught.value) is error_type


@pytest.mark.asyncio
async def test_enqueue_rollback_does_not_persist(recording_mail):
    async with SessionLocal() as db:
        await enqueue_mail(
            db,
            template="password_changed",
            to_email="a@example.com",
            idempotency_key="rollback-key",
            payload={"action_url": "http://localhost:3000/vi/forgot-password"},
        )
        await db.rollback()

    async with SessionLocal() as db:
        count = await db.scalar(select(func.count()).select_from(MailOutbox))
    assert count == 0


@pytest.mark.asyncio
async def test_idempotency_key_does_not_duplicate(recording_mail):
    async with SessionLocal() as db:
        first = await enqueue_mail(
            db,
            template="password_changed",
            to_email="a@example.com",
            idempotency_key="same-key",
            payload={"action_url": "http://localhost:3000/vi/forgot-password"},
        )
        second = await enqueue_mail(
            db,
            template="password_changed",
            to_email="a@example.com",
            idempotency_key="same-key",
            payload={"action_url": "http://localhost:3000/vi/forgot-password"},
        )
        await db.commit()

    assert first is not None
    assert second is None
    async with SessionLocal() as db:
        count = await db.scalar(select(func.count()).select_from(MailOutbox))
    assert count == 1


@pytest.mark.asyncio
async def test_unknown_template_raises_before_insert():
    async with SessionLocal() as db:
        with pytest.raises(UnknownMailTemplate):
            await enqueue_mail(
                db,
                template="not_a_template",
                to_email="a@example.com",
                idempotency_key="bad-template",
            )
        await db.rollback()


@pytest.mark.asyncio
async def test_worker_sends_once(recording_mail):
    async with SessionLocal() as db:
        await enqueue_mail(
            db,
            template="password_changed",
            to_email="send@example.com",
            idempotency_key="send-once",
            payload={"action_url": "http://localhost:3000/vi/forgot-password"},
        )
        await db.commit()

    sent = await process_mail_outbox()
    assert sent == 1
    sent_again = await process_mail_outbox()
    assert sent_again == 0
    assert len(recording_mail.sent) == 1
    assert recording_mail.sent[0].to == "send@example.com"
    assert "password" in recording_mail.sent[0].subject.lower() or "mật khẩu" in recording_mail.sent[0].subject.lower()

    async with SessionLocal() as db:
        row = await db.scalar(select(MailOutbox))
    assert row.status == MailOutboxStatus.sent.value


@pytest.mark.asyncio
async def test_worker_retries_then_fails(recording_mail, monkeypatch):
    monkeypatch.setattr("src.mail.worker._backoff_seconds", lambda attempts: 0)
    recording_mail.fail_times = 100
    async with SessionLocal() as db:
        await enqueue_mail(
            db,
            template="password_changed",
            to_email="fail@example.com",
            idempotency_key="fail-key",
            payload={"action_url": "http://localhost:3000/vi/forgot-password"},
        )
        await db.commit()

    from src.config import settings
    for _ in range(settings.mail_max_attempts):
        await process_mail_outbox()
        async with SessionLocal() as db:
            row = await db.scalar(select(MailOutbox))
            row.scheduled_at = datetime.now(timezone.utc)
            await db.commit()

    async with SessionLocal() as db:
        row = await db.scalar(select(MailOutbox))
    assert row.status == MailOutboxStatus.failed.value
    assert row.attempts == settings.mail_max_attempts
    assert recording_mail.sent == []


@pytest.mark.asyncio
async def test_worker_does_not_retry_permanent_provider_error(recording_mail):
    async def reject(_message):
        raise PermanentMailSendError("resend_http_403")

    recording_mail.send = reject
    async with SessionLocal() as db:
        await enqueue_mail(
            db,
            template="password_changed",
            to_email="reject@example.com",
            idempotency_key="permanent-failure",
            payload={"action_url": "http://localhost:3000/vi/forgot-password"},
        )
        await db.commit()

    sent = await process_mail_outbox()

    assert sent == 0
    async with SessionLocal() as db:
        row = await db.scalar(select(MailOutbox))
    assert row.status == MailOutboxStatus.failed.value
    assert row.attempts == 1
    assert row.last_error == "resend_http_403"


# --- scheduler tick -------------------------------------------------------------

async def _worker_switch(on: bool) -> None:
    """Flip worker_enabled straight in the DB, as an admin in another process
    would: this process's config cache is not told."""
    async with SessionLocal() as db:
        await ensure_runtime_seeded(db)
        await db.execute(update(MailRuntimeConfig).values(worker_enabled=on))
        await db.commit()


async def _queue(key: str, *, to: str = "tick@example.com", locale: str = "vi") -> None:
    async with SessionLocal() as db:
        await enqueue_mail(
            db, template="password_changed", to_email=to, locale=locale, idempotency_key=key,
            payload={"action_url": "http://localhost:3000/vi/forgot-password"},
        )
        await db.commit()


@pytest.fixture
def swept(monkeypatch):
    """The stale-`sending` sweep ran just now, so ticks below are ordinary ticks."""
    monkeypatch.setattr(mail_worker, "_last_stale_sweep", time.monotonic())


@pytest.mark.asyncio
async def test_idle_tick_is_one_outbox_probe(recording_mail, swept):
    await _worker_switch(True)
    with statement_log() as statements:
        await mail_outbox_send_job()
    assert len(statements) == 1
    assert "FROM mail_outbox" in statements[0] and "mail_templates" not in statements[0]

    # Pending but not yet due (backoff) is still idle.
    await _queue("later")
    async with SessionLocal() as db:
        await db.execute(update(MailOutbox).values(scheduled_at=datetime.now(timezone.utc) + timedelta(minutes=5)))
        await db.commit()
    with statement_log() as statements:
        await mail_outbox_send_job()
    assert len(statements) == 1 and recording_mail.sent == []


@pytest.mark.asyncio
async def test_busy_tick_reads_only_the_copy_it_sends(recording_mail, swept):
    await _worker_switch(True)
    await _queue("busy-1", to="b1@example.com")
    await _queue("busy-2", to="b2@example.com", locale="en")
    with statement_log() as statements:
        await mail_outbox_send_job()
    assert [m.to for m in recording_mail.sent] == ["b1@example.com", "b2@example.com"]
    template_reads = [s for s in statements if "FROM mail_templates" in s]
    assert len(template_reads) == 1 and "WHERE" in template_reads[0]
    # probe + runtime + claim + mark sending + copy, then read + write per row
    assert len(statements) == 5 + 2 * 2


@pytest.mark.asyncio
async def test_disabling_the_worker_stops_the_next_tick(recording_mail, swept):
    await _worker_switch(True)
    await _queue("on-1")
    await mail_outbox_send_job()
    assert len(recording_mail.sent) == 1

    await _worker_switch(False)
    await _queue("off-1")
    await mail_outbox_send_job()
    assert len(recording_mail.sent) == 1
    async with SessionLocal() as db:
        row = await db.scalar(select(MailOutbox).where(MailOutbox.idempotency_key == "off-1"))
    assert row.status == MailOutboxStatus.pending.value and row.attempts == 0

    await _worker_switch(True)
    await mail_outbox_send_job()
    assert len(recording_mail.sent) == 2


@pytest.mark.asyncio
async def test_stale_sending_rows_are_requeued_on_the_sweep_interval(recording_mail, swept, monkeypatch):
    await _worker_switch(True)
    await _queue("stuck")
    async with SessionLocal() as db:
        await db.execute(update(MailOutbox).values(
            status=MailOutboxStatus.sending.value, updated_at=datetime.now(timezone.utc) - timedelta(minutes=20),
        ))
        await db.commit()

    await mail_outbox_send_job()  # sweep not due: the row is left alone
    async with SessionLocal() as db:
        assert await db.scalar(select(MailOutbox.status)) == MailOutboxStatus.sending.value
    assert recording_mail.sent == []

    monkeypatch.setattr(mail_worker, "_last_stale_sweep", time.monotonic() - mail_worker._STALE_SWEEP_EVERY - 1)
    await mail_outbox_send_job()
    assert len(recording_mail.sent) == 1
    async with SessionLocal() as db:
        assert await db.scalar(select(MailOutbox.status)) == MailOutboxStatus.sent.value
    assert not mail_worker._stale_sweep_due()
