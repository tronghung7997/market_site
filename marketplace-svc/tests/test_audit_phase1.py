"""Audit checklist phase 1: account lock, login history, content filter,
manual top-up reason, escrow snapshot and affiliate config."""
import uuid

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.log_entry import LogEntry
from src.models.login_event import LoginEvent
from tests.conftest import make_admin, register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _admin(client, email="p1_admin@example.com"):
    await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


# ── A1: lock / unlock + login history ───────────────────────────────────────

@pytest.mark.asyncio
async def test_lock_revokes_sessions_and_blocks_login(client):
    admin_token = await _admin(client)
    user_token = await register_and_login(client, "p1_user@example.com")
    me = await client.get("/me", headers=_auth(user_token))
    user_id = me.json()["id"]

    locked = await client.patch(
        f"/admin/accounts/{user_id}/status", json={"is_active": False, "reason": "clone farm"},
        headers=_auth(admin_token),
    )
    assert locked.status_code == 200, locked.text
    assert locked.json()["is_active"] is False

    # Existing session is dead immediately, not at token expiry.
    assert (await client.get("/me", headers=_auth(user_token))).status_code == 401
    # And a fresh login is refused with the generic credentials error.
    relogin = await client.post("/auth/login", json={"email": "p1_user@example.com", "password": "StrongPass123!"})
    assert relogin.status_code == 401

    unlocked = await client.patch(
        f"/admin/accounts/{user_id}/status", json={"is_active": True}, headers=_auth(admin_token),
    )
    assert unlocked.json()["is_active"] is True
    relogin = await client.post("/auth/login", json={"email": "p1_user@example.com", "password": "StrongPass123!"})
    assert relogin.status_code == 200

    events = await client.get(f"/admin/accounts/{user_id}/login-events", headers=_auth(admin_token))
    assert events.status_code == 200
    kinds = [(e["kind"], e["outcome"]) for e in events.json()]
    # newest first: login ok, unlocked, login refused while inactive, locked, first login
    assert kinds[:4] == [("login", "success"), ("unlocked", "success"), ("login", "inactive"), ("locked", "success")]
    assert kinds[-1] == ("login", "success")
    assert all(e["ip"] for e in events.json())

    async with SessionLocal() as db:
        row = await db.scalar(
            select(LogEntry).where(LogEntry.metadata_["event"].astext == "account_locked")
        )
        assert row is not None
        assert row.metadata_["reason"] == "clone farm"
        assert row.metadata_["actor_id"] != user_id
        assert row.metadata_.get("ip")


@pytest.mark.asyncio
async def test_admin_cannot_lock_self_and_non_admin_cannot_lock(client):
    admin_token = await _admin(client)
    admin_id = (await client.get("/me", headers=_auth(admin_token))).json()["id"]
    resp = await client.patch(f"/admin/accounts/{admin_id}/status", json={"is_active": False}, headers=_auth(admin_token))
    assert resp.status_code == 400

    user_token = await register_and_login(client, "p1_user2@example.com")
    user_id = (await client.get("/me", headers=_auth(user_token))).json()["id"]
    resp = await client.patch(f"/admin/accounts/{user_id}/status", json={"is_active": False}, headers=_auth(user_token))
    assert resp.status_code == 403
    resp = await client.get(f"/admin/accounts/{user_id}/login-events", headers=_auth(user_token))
    assert resp.status_code == 403
    resp = await client.get("/admin/accounts/999999/login-events", headers=_auth(admin_token))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_failed_login_recorded_with_forwarded_ip_and_user_agent(client):
    await register_and_login(client, "p1_user3@example.com")
    bad = await client.post(
        "/auth/login", json={"email": "p1_user3@example.com", "password": "wrong-pass-123"},
        headers={"X-Client-IP": "203.0.113.9", "User-Agent": "pytest-agent/1.0"},
    )
    assert bad.status_code == 401
    # Unknown email leaves no trace (no account enumeration via history).
    await client.post("/auth/login", json={"email": "nobody@example.com", "password": "wrong-pass-123"})
    async with SessionLocal() as db:
        rows = list((await db.execute(select(LoginEvent).order_by(LoginEvent.id))).scalars())
    assert [r.outcome for r in rows] == ["success", "invalid_credentials"]
    assert rows[-1].ip == "203.0.113.9"
    assert rows[-1].user_agent == "pytest-agent/1.0"


@pytest.mark.asyncio
async def test_register_stores_forwarded_client_ip(client):
    resp = await client.post(
        "/auth/register", json={"email": "p1_ip@example.com", "password": "StrongPass123!"},
        headers={"X-Client-IP": "198.51.100.7"},
    )
    assert resp.status_code == 201
    async with SessionLocal() as db:
        from src.models.account import Account

        account = await db.scalar(select(Account).where(Account.email == "p1_ip@example.com"))
        assert account.registration_ip == "198.51.100.7"


# ── A3.1: content filter ────────────────────────────────────────────────────

async def _enable_filter(client, admin_token, **overrides):
    body = {"enabled": True, "action": "block", "keywords": ["zalo", "telegram"], "block_phone_numbers": True}
    body.update(overrides)
    resp = await client.patch("/admin/content-filter", json=body, headers=_auth(admin_token))
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_content_filter_blocks_chat_and_logs_violation(client):
    buyer_token, seller_token, admin_token, _, _ = await setup_buyable_product(client)
    await _enable_filter(client, admin_token)
    product = (await client.get("/seller/products", headers=_auth(seller_token))).json()["items"][-1]

    blocked = await client.post(
        "/chat/inquiries",
        json={"product_id": product["id"], "initial_message": "add Z.a.l.o mình 0912 345 678 nhé",
              "client_message_id": str(uuid.uuid4())},
        headers=_auth(buyer_token),
    )
    assert blocked.status_code == 422, blocked.text
    assert blocked.json()["error_code"] == "CONTENT_BLOCKED"
    assert set(blocked.json()["params"]["matches"]) == {"zalo", "phone"}
    # Nothing was created for the buyer.
    rooms = await client.get("/chat/conversations?perspective=all", headers=_auth(buyer_token))
    assert rooms.json()["items"] == []
    # …but the violation is on record even though the request failed.
    async with SessionLocal() as db:
        hits = list((await db.execute(
            select(LogEntry).where(LogEntry.metadata_["event"].astext == "content_filter_hit")
        )).scalars())
    assert len(hits) == 1
    assert hits[0].metadata_["outcome"] == "blocked"

    ok = await client.post(
        "/chat/inquiries",
        json={"product_id": product["id"], "initial_message": "Còn hàng không shop?",
              "client_message_id": str(uuid.uuid4())},
        headers=_auth(buyer_token),
    )
    assert ok.status_code == 201
    room_id = ok.json()["id"]
    reply = await client.post(
        f"/chat/conversations/{room_id}/messages",
        json={"body": "ib telegram @shop nhé", "client_message_id": str(uuid.uuid4())},
        headers=_auth(seller_token),
    )
    assert reply.status_code == 422
    assert reply.json()["error_code"] == "CONTENT_BLOCKED"


@pytest.mark.asyncio
async def test_content_filter_mask_mode_stores_masked_text(client):
    buyer_token, seller_token, admin_token, _, _ = await setup_buyable_product(client)
    await _enable_filter(client, admin_token, action="mask", mask_char="#")
    product = (await client.get("/seller/products", headers=_auth(seller_token))).json()["items"][-1]
    opened = await client.post(
        "/chat/inquiries",
        json={"product_id": product["id"], "initial_message": "gọi 0912345678 hoặc zalo nhé",
              "client_message_id": str(uuid.uuid4())},
        headers=_auth(buyer_token),
    )
    assert opened.status_code == 201, opened.text
    assert opened.json()["messages"][0]["body"] == "gọi ########## hoặc #### nhé"


@pytest.mark.asyncio
async def test_content_filter_disabled_lets_text_through(client):
    buyer_token, seller_token, admin_token, _, _ = await setup_buyable_product(client)
    await _enable_filter(client, admin_token, enabled=False)
    product = (await client.get("/seller/products", headers=_auth(seller_token))).json()["items"][-1]
    opened = await client.post(
        "/chat/inquiries",
        json={"product_id": product["id"], "initial_message": "zalo 0912345678",
              "client_message_id": str(uuid.uuid4())},
        headers=_auth(buyer_token),
    )
    assert opened.status_code == 201


@pytest.mark.asyncio
async def test_content_filter_applies_to_dispute_reason(client):
    buyer_token, _, admin_token, instant_vid, _ = await setup_buyable_product(client)
    await _enable_filter(client, admin_token)
    order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    resp = await client.post(
        f"/orders/{order.json()['id']}/dispute", json={"reason": "acc lỗi, liên hệ zalo 0987654321"},
        headers=_auth(buyer_token),
    )
    assert resp.status_code == 422
    assert resp.json()["error_code"] == "CONTENT_BLOCKED"
    resp = await client.post(
        f"/orders/{order.json()['id']}/dispute", json={"reason": "acc lỗi, không đăng nhập được"},
        headers=_auth(buyer_token),
    )
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_content_filter_admin_api_validation_and_test_endpoint(client):
    admin_token = await _admin(client)
    user_token = await register_and_login(client, "p1_plain@example.com")
    assert (await client.get("/admin/content-filter", headers=_auth(user_token))).status_code == 403

    cfg = await _enable_filter(client, admin_token, keywords=["  Zalo ", "TELEGRAM", "zalo", ""])
    assert cfg["keywords"] == ["zalo", "telegram"]
    bad = await client.patch("/admin/content-filter", json={"action": "delete"}, headers=_auth(admin_token))
    assert bad.status_code == 422

    dry = await client.post("/admin/content-filter/test", json={"text": "call 0912345678"}, headers=_auth(admin_token))
    assert dry.status_code == 200
    assert dry.json()["blocked"] is True and dry.json()["matches"] == ["phone"]
    dry = await client.post("/admin/content-filter/test", json={"text": "giá 150.000đ"}, headers=_auth(admin_token))
    assert dry.json()["blocked"] is False

    async with SessionLocal() as db:
        row = await db.scalar(
            select(LogEntry).where(LogEntry.metadata_["event"].astext == "content_filter_config_changed")
        )
        assert row is not None and row.metadata_["new"]["keywords"] == ["zalo", "telegram"]


# ── A3.6: manual top-up needs a reason ──────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_topup_requires_reason_and_records_it(client):
    admin_token = await _admin(client)
    user_token = await register_and_login(client, "p1_topup@example.com")
    user_id = (await client.get("/me", headers=_auth(user_token))).json()["id"]

    missing = await client.post("/wallet/topup", json={"account_id": user_id, "amount": 5000}, headers=_auth(admin_token))
    assert missing.status_code == 422
    short = await client.post("/wallet/topup", json={"account_id": user_id, "amount": 5000, "reason": "  a "}, headers=_auth(admin_token))
    assert short.status_code == 422

    ok = await client.post(
        "/wallet/topup", json={"account_id": user_id, "amount": 5000, "reason": "Đền bù đơn ORD-1"},
        headers=_auth(admin_token),
    )
    assert ok.status_code == 200, ok.text
    txs = await client.get("/wallet/transactions", headers=_auth(user_token))
    assert txs.json()[0]["description"] == "Admin topup — Đền bù đơn ORD-1"
    async with SessionLocal() as db:
        row = await db.scalar(select(LogEntry).where(LogEntry.metadata_["event"].astext == "manual_topup"))
        assert row.metadata_["reason"] == "Đền bù đơn ORD-1"
        assert row.metadata_.get("ip")


# ── A4.1: escrow snapshot in wallet ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_wallet_reports_escrow_paid_and_incoming(client):
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    before = (await client.get("/wallet", headers=_auth(buyer_token))).json()
    assert before["escrow_paid"] == 0

    order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 2}, headers=_auth(buyer_token))
    assert order.status_code == 201
    buyer_wallet = (await client.get("/wallet", headers=_auth(buyer_token))).json()
    assert buyer_wallet["escrow_paid"] == 2000
    seller_wallet = (await client.get("/wallet", headers=_auth(seller_token))).json()
    assert seller_wallet["escrow_incoming"] == 2000

    seller_id = (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    admin_view = await client.get(f"/admin/accounts/{seller_id}/wallet", headers=_auth(admin_token))
    assert admin_view.json()["escrow_incoming"] == 2000

    await client.post(f"/orders/{order.json()['id']}/confirm", headers=_auth(buyer_token))
    assert (await client.get("/wallet", headers=_auth(buyer_token))).json()["escrow_paid"] == 0
    assert (await client.get("/wallet", headers=_auth(seller_token))).json()["escrow_incoming"] == 0


# ── A4.2: affiliate config ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_affiliate_config_admin_and_public(client):
    admin_token = await _admin(client)
    public = await client.get("/public/affiliate-config")
    assert public.status_code == 200
    assert public.json()["attribution_days"] == 30

    updated = await client.patch(
        "/admin/affiliate-config",
        json={"commission_percent_of_fee": 25, "attribution_days": 90, "earning_days": 365},
        headers=_auth(admin_token),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["commission_percent_of_fee"] == 25
    assert (await client.get("/public/affiliate-config")).json()["attribution_days"] == 90
    assert "commission_percent_of_fee" not in (await client.get("/public/affiliate-config")).json()

    bad = await client.patch("/admin/affiliate-config", json={"commission_percent_of_fee": 150}, headers=_auth(admin_token))
    assert bad.status_code == 422
    user_token = await register_and_login(client, "p1_aff_user@example.com")
    assert (await client.get("/admin/affiliate-config", headers=_auth(user_token))).status_code == 403


@pytest.mark.asyncio
async def test_no_commission_when_platform_fee_is_zero(client):
    """Commission is a share of the fee: a 0 % fee order pays the referrer nothing."""
    from src.models.account import Account
    from src.models.affiliate import AffiliateCommission

    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    await client.patch("/admin/affiliate-config", json={"commission_percent_of_fee": 50}, headers=_auth(admin_token))
    await client.post("/admin/affiliate-fund/topup", json={"amount": 1_000_000, "note": "budget"}, headers=_auth(admin_token))
    await register_and_login(client, "p1_referrer@example.com")
    async with SessionLocal() as db:
        referrer = await db.scalar(select(Account).where(Account.email == "p1_referrer@example.com"))
        code = referrer.affiliate_code
    await client.post("/auth/register", json={"email": "p1_ref_buyer@example.com", "password": "StrongPass123!", "referral_code": code})
    ref_token = (await client.post("/auth/login", json={"email": "p1_ref_buyer@example.com", "password": "StrongPass123!"})).json()["access_token"]
    ref_id = (await client.get("/me", headers=_auth(ref_token))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test", "account_id": ref_id, "amount": 10_000}, headers=_auth(admin_token))
    order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(ref_token))
    await client.post(f"/orders/{order.json()['id']}/confirm", headers=_auth(ref_token))
    async with SessionLocal() as db:
        assert await db.scalar(select(AffiliateCommission.id)) is None
