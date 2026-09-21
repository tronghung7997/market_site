"""Self-service /account: profile fields, sessions, login history, seller shop profile, mail opt-out."""

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.mail.service import enqueue_mail
from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.mail import MailOutbox
from tests.conftest import make_admin, register_and_login


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_patch_me_profile_fields_and_validation(client):
    token = await register_and_login(client, "profile1@example.com")
    resp = await client.patch("/me", json={
        "display_name": "  Long  ", "phone": "0901 234 567", "telegram_username": "@long_dev",
        "preferred_locale": "en", "preferred_currency": "usd",
        "notification_prefs": {"marketing": False},
    }, headers=_h(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["display_name"] == "Long"
    assert body["telegram_username"] == "long_dev"
    assert body["preferred_locale"] == "en" and body["preferred_currency"] == "USD"
    assert body["notification_prefs"] == {"marketing": False}

    # Partial patch merges prefs and leaves other fields alone.
    resp = await client.patch("/me", json={"notification_prefs": {"wallet": False}}, headers=_h(token))
    assert resp.json()["notification_prefs"] == {"marketing": False, "wallet": False}
    assert resp.json()["display_name"] == "Long"
    # "" clears an optional field.
    resp = await client.patch("/me", json={"phone": ""}, headers=_h(token))
    assert resp.json()["phone"] is None

    for bad in ({"phone": "abc"}, {"telegram_username": "ab"}, {"preferred_locale": "fr"},
                {"preferred_currency": "EUR"}, {"notification_prefs": {"bogus": True}}):
        assert (await client.patch("/me", json=bad, headers=_h(token))).status_code == 422, bad
    assert (await client.get("/me", headers=_h(token))).json()["display_name"] == "Long"


@pytest.mark.asyncio
async def test_sessions_list_and_revoke(client):
    token_a = await register_and_login(client, "sess@example.com")
    token_b = await register_and_login(client, "sess@example.com")  # second device
    resp = await client.get("/me/sessions", headers=_h(token_b))
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) == 2
    current = [r for r in rows if r["is_current"]]
    assert len(current) == 1
    other = next(r for r in rows if not r["is_current"])
    assert "user_agent" in other and "ip" in other

    # Revoke the other device: its token stops working, ours still does.
    assert (await client.delete(f"/me/sessions/{other['id']}", headers=_h(token_b))).status_code == 204
    assert (await client.get("/me", headers=_h(token_a))).status_code == 401
    assert (await client.get("/me", headers=_h(token_b))).status_code == 200
    assert len((await client.get("/me/sessions", headers=_h(token_b))).json()) == 1

    # Cannot touch someone else's session.
    token_c = await register_and_login(client, "sess2@example.com")
    mine = (await client.get("/me/sessions", headers=_h(token_b))).json()[0]["id"]
    assert (await client.delete(f"/me/sessions/{mine}", headers=_h(token_c))).status_code == 404


@pytest.mark.asyncio
async def test_my_login_events(client):
    token = await register_and_login(client, "events@example.com")
    await client.post("/auth/login", json={"email": "events@example.com", "password": "wrong-pass-1"})
    resp = await client.get("/me/login-events", headers=_h(token))
    assert resp.status_code == 200
    outcomes = [e["outcome"] for e in resp.json()]
    assert "success" in outcomes and "invalid_credentials" in outcomes
    assert resp.json()[0]["outcome"] == "invalid_credentials"  # newest first


@pytest.mark.asyncio
async def test_seller_profile_edit_without_reapproval(client):
    token = await register_and_login(client, "shop@example.com")
    await client.post("/seller/apply", json={"business_name": "Shop Cũ", "description": "bio cũ"}, headers=_h(token))
    admin = await register_and_login(client, "shop_admin@example.com")
    await make_admin("shop_admin@example.com")
    admin = await register_and_login(client, "shop_admin@example.com")
    app_id = (await client.get("/admin/seller-applications", headers=_h(admin))).json()[0]["id"]
    assert (await client.post(f"/admin/seller-applications/{app_id}/approve", headers=_h(admin))).status_code == 200
    token = await register_and_login(client, "shop@example.com")

    resp = await client.get("/seller/profile", headers=_h(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["business_name"] == "Shop Cũ" and resp.json()["handle"]

    resp = await client.patch("/seller/profile", json={"business_name": "Shop Mới", "description": "bio mới"}, headers=_h(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["business_name"] == "Shop Mới" and resp.json()["description"] == "bio mới"
    async with SessionLocal() as db:
        app = await db.scalar(select(SellerApplication).where(SellerApplication.id == app_id))
        assert app.status == ApplicationStatus.approved and app.business_name == "Shop Mới"
    # Public profile reflects the edit immediately.
    public = await client.get(f"/sellers/{resp.json()['canonical_path'].rsplit('/', 1)[-1]}")
    assert public.status_code == 200 and public.json()["bio"] == "bio mới"

    buyer = await register_and_login(client, "notseller@example.com")
    assert (await client.get("/seller/profile", headers=_h(buyer))).status_code == 403


@pytest.mark.asyncio
async def test_seller_without_application_gets_empty_profile_then_creates_one(client):
    token = await register_and_login(client, "legacy_seller@example.com")
    async with SessionLocal() as db:
        acc = await db.scalar(select(Account).where(Account.email == "legacy_seller@example.com"))
        acc.roles = ["buyer", "seller"]
        await db.commit()
    token = await register_and_login(client, "legacy_seller@example.com")
    resp = await client.get("/seller/profile", headers=_h(token))
    assert resp.status_code == 200 and resp.json()["business_name"] == "" and resp.json()["handle"] is None
    assert (await client.patch("/seller/profile", json={"description": "x"}, headers=_h(token))).status_code == 400
    resp = await client.patch("/seller/profile", json={"business_name": "Legacy Shop"}, headers=_h(token))
    assert resp.status_code == 200 and resp.json()["handle"] == "legacy-shop"


@pytest.mark.asyncio
async def test_mail_opt_out_skips_category_but_not_security(client):
    token = await register_and_login(client, "optout@example.com")
    await client.patch("/me", json={"notification_prefs": {"wallet": False}}, headers=_h(token))
    async with SessionLocal() as db:
        account = await db.scalar(select(Account).where(Account.email == "optout@example.com"))
        skipped = await enqueue_mail(db, template="withdrawal_approved", account_id=account.id,
                                     idempotency_key="t:wd", payload={"amount": 1, "action_url": "x"})
        sent = await enqueue_mail(db, template="password_changed", account_id=account.id,
                                  idempotency_key="t:pw", payload={})
        await db.commit()
        assert skipped is None and sent is not None
        rows = (await db.execute(select(MailOutbox.template).where(MailOutbox.account_id == account.id))).scalars().all()
        assert "password_changed" in rows and "withdrawal_approved" not in rows
