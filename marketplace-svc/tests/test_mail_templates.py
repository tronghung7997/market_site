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
    assert len(items) == 24  # 12 templates × vi/en (email_verify added with sign-up verification)
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
    # The admin's own sign-up queued an email_verify mail; drain it first so
    # the assertions below only see the template under test.
    await process_mail_outbox()
    recording_mail.sent.clear()

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


@pytest.mark.no_db
def test_html_layout_renders_button_from_label_line_in_order():
    _, _, html_body = render(
        "password_reset",
        "vi",
        {"action_url": "https://site.test/reset?t=1&x=<y>"},
        copy=("S", "Intro <b>\n\nĐặt lại mật khẩu:\n{action_url}\n\nOutro"),
        brand="GMMO <Ops>",
        site_url="https://gmmo.test/",
    )
    assert "GMMO &lt;Ops&gt;" in html_body
    assert 'href="https://gmmo.test/"' in html_body
    assert ">gmmo.test<" in html_body
    button = '>Đặt lại mật khẩu</a>'
    assert button in html_body
    assert 'href="https://site.test/reset?t=1&amp;x=&lt;y&gt;"' in html_body
    assert "Đặt lại mật khẩu:" not in html_body
    assert "Intro &lt;b&gt;" in html_body
    assert html_body.index("Intro") < html_body.index(button) < html_body.index("Outro")
    assert "dán liên kết này vào trình duyệt" in html_body


@pytest.mark.no_db
def test_html_layout_without_action_url_has_no_button():
    _, _, html_body = render("admin_test", "en", {}, copy=("S", "Just text\n\nSecond paragraph"))
    assert "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"margin:4px" not in html_body
    assert html_body.count("<p style=\"margin:0 0 16px") == 2
    assert "paste this link" not in html_body


@pytest.mark.asyncio
async def test_send_test_and_worker_use_admin_copy_with_cold_cache(client, recording_mail):
    """Admin copy must be read from DB on send paths, not only from the TTL cache."""
    from src.mail import catalog

    headers = await _admin(client, "tpl-cold-admin@test.com")
    patched = await client.patch(
        "/admin/mail-templates",
        json={
            "template": "admin_test",
            "locale": "en",
            "subject": "Custom test subject",
            "body": "Custom body {action_url}",
        },
        headers=headers,
    )
    assert patched.status_code == 200, patched.text

    # Simulate TTL expiry in this (or another) worker process.
    catalog._cache.invalidate()
    sent = await client.post(
        "/admin/mail-config/send-test",
        json={"to_email": "cold@example.com", "locale": "en"},
        headers=headers,
    )
    assert sent.status_code == 200, sent.text
    assert recording_mail.sent[-1].subject == "Custom test subject"

    async with SessionLocal() as db:
        await enqueue_mail(
            db,
            template="admin_test",
            to_email="cold-worker@example.com",
            locale="en",
            idempotency_key="tpl-cold-worker",
            payload={"action_url": "https://x.test"},
        )
        await db.commit()
    catalog._cache.invalidate()
    assert await process_mail_outbox() >= 1
    assert recording_mail.sent[-1].subject == "Custom test subject"
