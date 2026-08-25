import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.mail import MailOutbox
from tests.conftest import make_admin, register_and_login
from tests.test_disputes import create_delivered_order
from tests.test_seller_self_service import _trusted_seller


async def _outbox(*templates: str) -> list[MailOutbox]:
    async with SessionLocal() as db:
        q = select(MailOutbox).order_by(MailOutbox.id)
        if templates:
            q = q.where(MailOutbox.template.in_(templates))
        return list((await db.execute(q)).scalars().all())


@pytest.mark.asyncio
async def test_seller_application_decision_enqueues_mail(client):
    buyer_token = await register_and_login(client, "apply-mail@example.com")
    await client.post(
        "/seller/apply",
        json={"business_name": "Mail Shop"},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    admin_token = await register_and_login(client, "apply-admin@example.com")
    await make_admin("apply-admin@example.com")
    admin_token = await register_and_login(client, "apply-admin@example.com")
    apps = await client.get("/admin/seller-applications", headers={"Authorization": f"Bearer {admin_token}"})
    app_id = apps.json()[-1]["id"]

    reject = await client.post(
        f"/admin/seller-applications/{app_id}/reject",
        json={"reason": "Thiếu thông tin liên hệ"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert reject.status_code == 200
    rows = await _outbox("seller_application_rejected")
    assert len(rows) == 1
    assert rows[0].to_email == "apply-mail@example.com"
    assert "Thiếu thông tin" in rows[0].payload["reason"]

    again = await client.post(
        f"/admin/seller-applications/{app_id}/reject",
        json={"reason": "again"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert again.status_code == 400
    assert len(await _outbox("seller_application_rejected")) == 1


@pytest.mark.asyncio
async def test_provider_review_enqueues_mail(client):
    admin_token = await register_and_login(client, "prov-admin@example.com")
    await make_admin("prov-admin@example.com")
    admin_token = await register_and_login(client, "prov-admin@example.com")
    seller_token = await _trusted_seller(client, "prov-seller@example.com")
    created = await client.post(
        "/seller/providers",
        json={
            "name": "Mail Backend",
            "adapter_type": "seller_gateway",
            "config": {"base_url": "https://mail.example.com", "api_key": "k"},
        },
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert created.status_code == 201, created.text
    provider_id = created.json()["id"]

    denied = await client.post(
        f"/admin/providers/{provider_id}/reject",
        json={"note": "Sai base URL"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert denied.status_code == 200, denied.text
    rows = await _outbox("provider_rejected")
    assert len(rows) == 1
    assert rows[0].to_email == "prov-seller@example.com"
    assert rows[0].payload["reason"] == "Sai base URL"


@pytest.mark.asyncio
async def test_withdrawal_reject_requires_reason_and_mails(client):
    from tests.test_wallet import _seller_with_balance

    seller_token, admin_token = await _seller_with_balance(client, "wd-mail@example.com", 1_000_000)
    req = (
        await client.post(
            "/wallet/withdraw",
            json={
                "bank_name": "Vietcombank",
                "bank_account_number": "0123456789",
                "bank_account_holder": "TEST USER",
                "amount": 100_000,
            },
            headers={"Authorization": f"Bearer {seller_token}"},
        )
    ).json()

    missing = await client.post(
        f"/admin/withdrawals/{req['id']}/reject",
        json={},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert missing.status_code == 422

    rejected = await client.post(
        f"/admin/withdrawals/{req['id']}/reject",
        json={"reason": "STK không khớp"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["reject_reason"] == "STK không khớp"
    rows = await _outbox("withdrawal_rejected")
    assert len(rows) == 1
    assert "STK không khớp" in rows[0].payload["reason"]


@pytest.mark.asyncio
async def test_dispute_opened_mails_seller_resolved_mails_both(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client)
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Account not working"},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert opened.status_code == 201
    opened_mail = await _outbox("dispute_opened")
    assert len(opened_mail) == 1
    assert opened_mail[0].to_email == "disp_seller@example.com"

    disputes = await client.get("/admin/disputes", headers={"Authorization": f"Bearer {admin_token}"})
    dispute_id = disputes.json()[-1]["id"]
    resolved = await client.post(
        f"/admin/disputes/{dispute_id}/refund",
        json={"admin_note": "Confirmed broken"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resolved.status_code == 200
    resolved_mail = await _outbox("dispute_resolved")
    emails = {row.to_email for row in resolved_mail}
    assert emails == {"disp_buyer@example.com", "disp_seller@example.com"}
    assert all(row.payload["outcome"] == "refund" for row in resolved_mail)
    assert "Confirmed broken" in resolved_mail[0].payload["admin_note"]
