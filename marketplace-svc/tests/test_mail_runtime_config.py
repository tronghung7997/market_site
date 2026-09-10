"""Admin mail runtime config: env seed, secret mask, send-test, outbox list."""
import pytest

from src.database import SessionLocal
from src.mail.adapters import RecordingMailAdapter
from src.mail.factory import set_mail_adapter
from src.mail.service import enqueue_mail
from src.models.mail import MailOutboxStatus
from src.models.mail_runtime_config import MailRuntimeConfig
from tests.conftest import make_admin, register_and_login


@pytest.fixture
def recording_mail():
    adapter = RecordingMailAdapter()
    set_mail_adapter(adapter)
    yield adapter
    set_mail_adapter(None)


async def _admin(client, email: str):
    token = await register_and_login(client, email)
    await make_admin(email)
    token = await register_and_login(client, email)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_mail_config_requires_admin(client):
    anon = await client.get("/admin/mail-config")
    assert anon.status_code in (401, 403)

    buyer = await register_and_login(client, "mail-buyer@test.com")
    forbidden = await client.get(
        "/admin/mail-config",
        headers={"Authorization": f"Bearer {buyer}"},
    )
    assert forbidden.status_code == 403


@pytest.mark.asyncio
async def test_mail_config_seeds_from_env_and_masks_secrets(client):
    headers = await _admin(client, "mail-cfg-admin@test.com")
    r = await client.get("/admin/mail-config", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider"] == "log"
    assert body["worker_enabled"] is False  # conftest MAIL_WORKER_ENABLED=false
    assert body["source"] == "db"
    assert body["resend_api_key_configured"] is False
    assert body["smtp_host_configured"] is False
    assert "resend_api_key" not in body
    assert "smtp_password" not in body
    assert "smtp_username" not in body
    dumped = r.text.lower()
    assert "re_" not in dumped
    assert "smtp_password" not in dumped

    async with SessionLocal() as db:
        row = await db.get(MailRuntimeConfig, 1)
        assert row is not None
        assert row.provider == "log"


@pytest.mark.asyncio
async def test_mail_config_patch_and_reset_to_env(client):
    headers = await _admin(client, "mail-patch-admin@test.com")
    await client.get("/admin/mail-config", headers=headers)

    patch = await client.patch(
        "/admin/mail-config",
        json={
            "provider": "log",
            "mail_from": "noreply@example.com",
            "mail_from_name": "Proxora Ops",
            "worker_enabled": True,
        },
        headers=headers,
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["mail_from"] == "noreply@example.com"
    assert patch.json()["mail_from_name"] == "Proxora Ops"
    assert patch.json()["worker_enabled"] is True

    bad = await client.patch(
        "/admin/mail-config",
        json={"provider": "resend", "mail_from": "not-an-email"},
        headers=headers,
    )
    assert bad.status_code == 422

    empty = await client.patch("/admin/mail-config", json={}, headers=headers)
    assert empty.status_code == 422

    reset = await client.post("/admin/mail-config/reset-to-env", headers=headers)
    assert reset.status_code == 200, reset.text
    assert reset.json()["provider"] == "log"
    assert reset.json()["worker_enabled"] is False

    not_ready = await client.patch(
        "/admin/mail-config",
        json={"provider": "resend", "mail_from": "noreply@example.com"},
        headers=headers,
    )
    assert not_ready.status_code == 200
    assert not_ready.json()["effective_ready"] is False
    assert not_ready.json()["resend_api_key_configured"] is False
    blocked = await client.post(
        "/admin/mail-config/send-test",
        json={"to_email": "ops@example.com"},
        headers=headers,
    )
    assert blocked.status_code == 400


@pytest.mark.asyncio
async def test_send_test_and_outbox_list(client, recording_mail):
    headers = await _admin(client, "mail-test-admin@test.com")
    await client.get("/admin/mail-config", headers=headers)

    sent = await client.post(
        "/admin/mail-config/send-test",
        json={"to_email": "ops@example.com", "locale": "en"},
        headers=headers,
    )
    assert sent.status_code == 200, sent.text
    body = sent.json()
    assert body["status"] == "sent"
    assert body["logged_only"] is True
    assert body["to_email"] == "ops@example.com"
    assert len(recording_mail.sent) == 1
    assert recording_mail.sent[0].template == "admin_test"
    assert "test email" in recording_mail.sent[0].text.lower()

    cooldown = await client.post(
        "/admin/mail-config/send-test",
        json={"to_email": "ops@example.com"},
        headers=headers,
    )
    assert cooldown.status_code == 429

    listing = await client.get("/admin/mail-outbox?template=admin_test", headers=headers)
    assert listing.status_code == 200, listing.text
    data = listing.json()
    assert data["total"] >= 1
    row = data["items"][0]
    assert row["template"] == "admin_test"
    assert row["status"] == "sent"
    assert "payload" not in row
    assert "action_url" not in listing.text


@pytest.mark.asyncio
async def test_send_test_reports_provider_failure(client, recording_mail):
    headers = await _admin(client, "mail-test-failure-admin@test.com")
    await client.get("/admin/mail-config", headers=headers)
    recording_mail.fail_times = 1

    response = await client.post(
        "/admin/mail-config/send-test",
        json={"to_email": "failure@example.com", "locale": "vi"},
        headers=headers,
    )

    assert response.status_code == 502
    assert response.json()["detail"] == "recording adapter forced failure"
    listing = await client.get("/admin/mail-outbox?template=admin_test", headers=headers)
    assert listing.json()["items"][0]["status"] == "pending"


@pytest.mark.asyncio
async def test_outbox_retry_and_buyer_forbidden(client, recording_mail):
    headers = await _admin(client, "mail-retry-admin@test.com")
    await client.get("/admin/mail-config", headers=headers)

    async with SessionLocal() as db:
        row = await enqueue_mail(
            db,
            template="password_changed",
            to_email="retry@example.com",
            idempotency_key="retry-key",
            payload={"action_url": "http://localhost:3000/vi/forgot-password?token=secret-token"},
        )
        row.status = MailOutboxStatus.failed.value
        row.last_error = "boom"
        await db.commit()
        outbox_id = row.id

    listing = await client.get("/admin/mail-outbox?status=failed", headers=headers)
    assert listing.status_code == 200
    assert "secret-token" not in listing.text
    assert listing.json()["items"][0]["id"] == outbox_id

    retry = await client.post(f"/admin/mail-outbox/{outbox_id}/retry", headers=headers)
    assert retry.status_code == 200, retry.text
    assert retry.json()["status"] == "pending"

    buyer = await register_and_login(client, "mail-retry-buyer@test.com")
    denied = await client.get(
        "/admin/mail-outbox",
        headers={"Authorization": f"Bearer {buyer}"},
    )
    assert denied.status_code == 403

    missing = await client.post("/admin/mail-outbox/999999/retry", headers=headers)
    assert missing.status_code == 404
