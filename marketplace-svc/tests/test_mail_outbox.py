from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from src.database import SessionLocal
from src.mail.adapters import RecordingMailAdapter
from src.mail.factory import get_mail_adapter, set_mail_adapter
from src.mail.service import enqueue_mail
from src.mail.templates import UnknownMailTemplate
from src.mail.worker import process_mail_outbox
from src.models.mail import MailOutbox, MailOutboxStatus


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
