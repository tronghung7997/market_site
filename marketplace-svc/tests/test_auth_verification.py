"""Sign-up email verification: link mail, confirm, resend, and the
purchase/deposit/withdraw gate controlled by the admin auth policy."""
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.mail import MailOutbox
from tests.conftest import make_admin, register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _outbox(template: str) -> list[MailOutbox]:
    async with SessionLocal() as db:
        result = await db.execute(select(MailOutbox).where(MailOutbox.template == template).order_by(MailOutbox.id))
        return list(result.scalars().all())


def _token_from_url(url: str) -> str:
    return parse_qs(urlparse(url).query)["token"][0]


async def _admin(client, email="ver_admin@example.com"):
    await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


async def _require_verification(client, admin_token, on: bool = True):
    resp = await client.patch("/admin/auth-config", json={"require_email_verification": on}, headers=_auth(admin_token))
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_register_mails_link_and_verify_marks_account(client):
    resp = await client.post("/auth/register", json={"email": "ver_u1@example.com", "password": "StrongPass123!", "locale": "en"})
    assert resp.status_code == 201
    assert resp.json()["email_verified"] is False

    rows = await _outbox("email_verify")
    assert len(rows) == 1
    assert rows[0].locale == "en"
    assert "/en/verify-email?token=" in rows[0].payload["action_url"]
    token = _token_from_url(rows[0].payload["action_url"])

    bad = await client.post("/auth/verify-email", json={"token": "x" * 40})
    assert bad.status_code == 400 and bad.json()["error_code"] == "VERIFY_TOKEN_INVALID"

    ok = await client.post("/auth/verify-email", json={"token": token})
    assert ok.status_code == 200, ok.text
    assert ok.json()["email_verified"] is True
    # One-shot link.
    again = await client.post("/auth/verify-email", json={"token": token})
    assert again.status_code == 400

    login = await client.post("/auth/login", json={"email": "ver_u1@example.com", "password": "StrongPass123!"})
    me = await client.get("/me", headers=_auth(login.json()["access_token"]))
    assert me.json()["email_verified"] is True


@pytest.mark.asyncio
async def test_resend_replaces_link_and_refuses_when_verified(client):
    token = await register_and_login(client, "ver_u2@example.com")
    first = (await _outbox("email_verify"))[0]
    first_token = _token_from_url(first.payload["action_url"])

    resend = await client.post("/auth/verify-email/resend", json={"locale": "vi"}, headers=_auth(token))
    assert resend.status_code == 204
    rows = await _outbox("email_verify")
    assert len(rows) == 2
    second_token = _token_from_url(rows[1].payload["action_url"])
    assert second_token != first_token
    # The old link died when the new one was issued.
    assert (await client.post("/auth/verify-email", json={"token": first_token})).status_code == 400
    assert (await client.post("/auth/verify-email", json={"token": second_token})).status_code == 200

    already = await client.post("/auth/verify-email/resend", json={"locale": "vi"}, headers=_auth(token))
    assert already.status_code == 400 and already.json()["error_code"] == "EMAIL_ALREADY_VERIFIED"
    assert (await client.post("/auth/verify-email/resend", json={})).status_code == 401


@pytest.mark.asyncio
async def test_gate_blocks_orders_until_verified_when_policy_on(client):
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    await _require_verification(client, admin_token, True)

    denied = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    assert denied.status_code == 403, denied.text
    assert denied.json()["error_code"] == "EMAIL_NOT_VERIFIED"
    # Browsing and reading own data still work.
    assert (await client.get("/wallet", headers=_auth(buyer_token))).status_code == 200
    assert (await client.get("/products")).status_code == 200
    # Seller withdrawals are gated too.
    withdraw = await client.post("/wallet/withdraw", json={"amount": 1000}, headers=_auth(seller_token))
    assert withdraw.status_code == 403 and withdraw.json()["error_code"] == "EMAIL_NOT_VERIFIED"

    # Buyer confirms the mailbox → order goes through.
    buyer_mail = [r for r in await _outbox("email_verify") if r.to_email == "ord_buyer@example.com"][-1]
    ok = await client.post("/auth/verify-email", json={"token": _token_from_url(buyer_mail.payload["action_url"])})
    assert ok.status_code == 200
    order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    assert order.status_code == 201, order.text

    # Admin can vouch for a mailbox by hand.
    seller_id = (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    marked = await client.post(f"/admin/accounts/{seller_id}/verify-email", headers=_auth(admin_token))
    assert marked.status_code == 200 and marked.json()["email_verified"] is True

    # Policy off → unverified accounts are not blocked.
    await _require_verification(client, admin_token, False)
    other = await register_and_login(client, "ver_u3@example.com")
    other_id = (await client.get("/me", headers=_auth(other))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test", "account_id": other_id, "amount": 10_000}, headers=_auth(admin_token))
    assert (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(other))).status_code == 201


@pytest.mark.asyncio
async def test_auth_config_requires_admin_and_validates(client):
    admin_token = await _admin(client)
    user_token = await register_and_login(client, "ver_u4@example.com")
    assert (await client.get("/admin/auth-config", headers=_auth(user_token))).status_code == 403
    cfg = await client.get("/admin/auth-config", headers=_auth(admin_token))
    assert cfg.status_code == 200 and cfg.json()["require_email_verification"] is False
    bad = await client.patch("/admin/auth-config", json={"verification_link_hours": 0}, headers=_auth(admin_token))
    assert bad.status_code == 422
    ok = await client.patch("/admin/auth-config", json={"verification_link_hours": 48}, headers=_auth(admin_token))
    assert ok.json()["verification_link_hours"] == 48
