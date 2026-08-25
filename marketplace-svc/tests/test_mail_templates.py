"""Admin-editable mail templates: seed, auth, override, reset, HTML escape."""
import pytest

from src.database import SessionLocal
from src.mail.adapters import RecordingMailAdapter
from src.mail.factory import set_mail_adapter
from src.mail.service import enqueue_mail
from src.mail.templates import render
from src.mail.worker import process_mail_outbox
from tests.conftest import make_admin, register_and_login


@pytest.fixture
def recording_mail():
    adapter = RecordingMailAdapter()
    set_mail_adapter(adapter)
    yield adapter
    set_mail_adapter(None)


async def _admin(client, email: str):
    await register_and_login(client, email)
    await make_admin(email)
    token = await register_and_login(client, email)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_mail_templates_require_admin(client):
    anon = await client.get("/admin/mail-templates")
    assert anon.status_code in (401, 403)
    buyer = await register_and_login(client, "tpl-buyer@test.com")
    forbidden = await client.get(
        "/admin/mail-templates",
        headers={"Authorization": f"Bearer {buyer}"},
    )
    assert forbidden.status_code == 403


@pytest.mark.asyncio
async def test_mail_templates_seed_patch_reset_and_preview(client):
    headers = await _admin(client, "tpl-admin@test.com")
    listing = await client.get("/admin/mail-templates", headers=headers)
    assert listing.status_code == 200, listing.text
    items = listing.json()["items"]
    assert len(items) == 22
    row = next(item for item in items if item["template"] == "admin_test" and item["locale"] == "en")
    assert row["customized"] is False
    assert "{action_url}" in row["body"]

    unknown = await client.patch(
        "/admin/mail-templates",
        json={"template": "not_a_template", "locale": "en", "subject": "x", "body": "y"},
        headers=headers,
    )
    assert unknown.status_code == 422

    patched = await client.patch(
        "/admin/mail-templates",
        json={
            "template": "admin_test",
            "locale": "en",
            "subject": "Custom test subject",
            "body": "Hello from admin.\n{action_url}",
        },
        headers=headers,
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["customized"] is True
    assert patched.json()["subject"] == "Custom test subject"

    preview = await client.post(
        "/admin/mail-templates/preview",
        json={
            "template": "admin_test",
            "locale": "en",
            "subject": "Preview {action_url}",
            "body": "Go {action_url}",
        },
        headers=headers,
    )
    assert preview.status_code == 200, preview.text
    assert "https://example.com" in preview.json()["body"]
    assert "{action_url}" not in preview.json()["body"]

    reset = await client.post(
        "/admin/mail-templates/reset",
        json={"template": "admin_test", "locale": "en"},
        headers=headers,
    )
    assert reset.status_code == 200
    assert reset.json()["customized"] is False
    assert reset.json()["subject"] == row["default_subject"]


@pytest.mark.asyncio
async def test_send_uses_admin_template_and_escapes_html(client, recording_mail):
    headers = await _admin(client, "tpl-send-admin@test.com")
    await client.get("/admin/mail-templates", headers=headers)
    patched = await client.patch(
        "/admin/mail-templates",
        json={
            "template": "withdrawal_rejected",
            "locale": "en",
            "subject": "No payout",
            "body": "Why: {reason}\nAmount: {amount}",
        },
        headers=headers,
    )
    assert patched.status_code == 200, patched.text

    async with SessionLocal() as db:
        await enqueue_mail(
            db,
            template="withdrawal_rejected",
            to_email="seller@example.com",
            locale="en",
            idempotency_key="tpl-html",
            payload={"reason": "<script>x</script>", "amount": 150000, "action_url": "https://x.test/w"},
        )
        await db.commit()

    sent = await process_mail_outbox()
    assert sent == 1
    msg = recording_mail.sent[0]
    assert msg.subject == "No payout"
    assert "<script>x</script>" in msg.text
    assert "&lt;script&gt;x&lt;/script&gt;" in (msg.html or "")
    assert "<script>x</script>" not in (msg.html or "")
    assert "150.000 ₫" in msg.text


@pytest.mark.no_db
def test_default_render_still_matches_catalog():
    subject, text, html_body = render(
        "password_reset",
        "en",
        {"action_url": "https://site.test/reset"},
    )
    assert "Reset your Marketplace password" == subject
    assert "https://site.test/reset" in text
    assert "https://site.test/reset" in html_body
