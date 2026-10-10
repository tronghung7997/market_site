"""Marketplace ops Telegram bot: admin config (write-only token, audited),
events collected from alerts / audit log / SePay journal into the outbox and
delivered once, channel posts for newly listed products, Telegram 429/401/403
and network failures."""
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, text, update

from src import rate_limit
from src.alerts.service import add_alert, upsert_incident
from src.database import SessionLocal
from src.models.alert import Alert
from src.models.ops_telegram import OpsTelegramConfig, OpsTelegramOutbox
from src.models.payment import SePayWebhookEvent
from src.models.product import Product
from src.ops_telegram import dispatch
from src.ops_telegram.service import enqueue_ops_message
from src.seller_telegram import client as tg_client
from src.wallet.service import request_withdraw
from tests.conftest import make_admin, make_seller, register_and_login, set_seller_tier
from tests.test_payments import _payload, _post_webhook

TOKEN = "7412345678:AAHfakeOpsTokenForTestsOnly_abcdefghijklmWq7"
OTHER_TOKEN = "7999999999:AAHanotherFakeOpsTokenForTests_abcdefghZz1"
OPS_CHAT = "-1001234567890"
CHANNEL = "@gmmo_new_products"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class FakeTelegram:
    def __init__(self):
        self.bots = {
            TOKEN: {"id": 7412345678, "is_bot": True, "first_name": "GMMO Ops", "username": "gmmo_ops_bot"},
            OTHER_TOKEN: {"id": 7999999999, "is_bot": True, "first_name": "Other", "username": "other_ops_bot"},
        }
        self.sent: list[dict] = []
        self.send_errors: list[tuple[int, dict]] = []  # consumed one per sendMessage call
        self.blocked_chats: set = set()
        self.calls: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        _, bot_part, method = request.url.path.split("/")
        token = bot_part[3:]
        body = json.loads(request.content or b"{}")
        self.calls.append(method)
        if token not in self.bots:
            return httpx.Response(401, json={"ok": False, "error_code": 401, "description": "Unauthorized"})
        if method == "getMe":
            return httpx.Response(200, json={"ok": True, "result": self.bots[token]})
        if method == "sendMessage":
            if self.send_errors:
                status, payload = self.send_errors.pop(0)
                return httpx.Response(status, json={"ok": False, "error_code": status, **payload})
            if body.get("chat_id") in self.blocked_chats:
                return httpx.Response(403, json={"ok": False, "error_code": 403,
                                                 "description": "Forbidden: bot is not a member of the channel chat"})
            self.sent.append(body)
            return httpx.Response(200, json={"ok": True, "result": {"message_id": len(self.sent)}})
        return httpx.Response(404, json={"ok": False, "error_code": 404, "description": "Not Found"})


@pytest.fixture
async def telegram(monkeypatch):
    redis = rate_limit._get_client()
    keys = [key async for key in redis.scan_iter("ratelimit:ops-telegram:*")]
    if keys:
        await redis.delete(*keys)
    fake = FakeTelegram()
    tg_client.set_transport(httpx.MockTransport(fake.handler))
    monkeypatch.setattr(dispatch, "_SEND_GAP_SECONDS", 0)
    monkeypatch.setattr(dispatch, "_last_purge", None)
    yield fake
    tg_client.set_transport(None)


async def _admin(client, email="ops_admin@example.com") -> str:
    await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


async def _enable(client, admin: str, **extra) -> dict:
    resp = await client.patch("/admin/ops-telegram", json={
        "bot_token": TOKEN, "ops_chat_id": OPS_CHAT, "enabled": True, **extra,
    }, headers=_auth(admin))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _cfg() -> OpsTelegramConfig:
    async with SessionLocal() as db:
        return await db.get(OpsTelegramConfig, 1)


async def _outbox() -> list[OpsTelegramOutbox]:
    async with SessionLocal() as db:
        return list((await db.scalars(select(OpsTelegramOutbox).order_by(OpsTelegramOutbox.id))).all())


async def _age_everything(minutes: int = 10) -> None:
    """Rows look older than the settle window, as they would a while later."""
    when = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    async with SessionLocal() as db:
        await db.execute(update(Alert).values(created_at=when))
        await db.execute(text("UPDATE log_entries SET created_at = :w"), {"w": when})
        await db.execute(update(SePayWebhookEvent).values(received_at=when))
        await db.commit()


# --- access ---------------------------------------------------------------------

@pytest.mark.asyncio
async def test_requires_admin(client, telegram):
    assert (await client.get("/admin/ops-telegram")).status_code == 401
    buyer = await register_and_login(client, "ops_buyer@example.com")
    for method, path, body in (
        ("GET", "/admin/ops-telegram", None),
        ("PATCH", "/admin/ops-telegram", {"bot_token": TOKEN, "enabled": True}),
        ("POST", "/admin/ops-telegram/check", {"token": TOKEN}),
        ("POST", "/admin/ops-telegram/test", None),
    ):
        resp = await client.request(method, path, json=body, headers=_auth(buyer))
        assert resp.status_code == 403, (method, path, resp.text)
    seller = await register_and_login(client, "ops_seller@example.com")
    await make_seller("ops_seller@example.com")
    seller = await register_and_login(client, "ops_seller@example.com")
    assert (await client.get("/admin/ops-telegram", headers=_auth(seller))).status_code == 403
    assert telegram.calls == []
    assert await _cfg() is None


# --- config -----------------------------------------------------------------------

@pytest.mark.asyncio
async def test_defaults_before_any_save(client, telegram):
    admin = await _admin(client)
    state = (await client.get("/admin/ops-telegram", headers=_auth(admin))).json()
    assert state["enabled"] is False and state["token_set"] is False and state["token_hint"] is None
    assert all(state["events"].values()) and state["channel_interval_minutes"] == 30
    assert state["outbox"] == {"pending": 0, "failed_24h": 0, "last_sent_at": None}


@pytest.mark.asyncio
async def test_token_is_encrypted_masked_and_never_echoed_or_logged(client, telegram):
    admin = await _admin(client)
    resp = await client.patch("/admin/ops-telegram", json={
        "bot_token": f"  {TOKEN} ", "ops_chat_id": OPS_CHAT, "enabled": True,
    }, headers=_auth(admin))
    assert resp.status_code == 200, resp.text
    state = resp.json()
    assert state["token_set"] is True and state["token_hint"] == "…mWq7"
    assert state["bot_username"] == "gmmo_ops_bot" and state["enabled"] is True
    assert TOKEN not in resp.text and TOKEN.split(":")[1] not in resp.text
    got = await client.get("/admin/ops-telegram", headers=_auth(admin))
    assert TOKEN.split(":")[1] not in got.text

    async with SessionLocal() as db:
        raw = await db.scalar(text("SELECT bot_token FROM ops_telegram_config WHERE id = 1"))
        audit = (await db.execute(text(
            "SELECT metadata::text FROM log_entries WHERE metadata->>'event' = 'ops_telegram_config_changed'"
        ))).scalars().all()
    assert raw.startswith("gAAAA") and TOKEN not in raw
    assert len(audit) == 1 and TOKEN.split(":")[1] not in audit[0]
    changed = json.loads(audit[0])["changed"]
    assert changed["ops_enabled"] == [False, True]
    assert changed["ops_bot_token"] == [None, "…mWq7"]
    assert changed["ops_chat_id"] == ["", OPS_CHAT]

    # Toggling an event is audited per key; omitting the token keeps it.
    resp = await client.patch("/admin/ops-telegram", json={"events": {"system_alert": False}}, headers=_auth(admin))
    assert resp.json()["events"]["system_alert"] is False and resp.json()["token_set"] is True
    async with SessionLocal() as db:
        last = (await db.execute(text(
            "SELECT metadata::text FROM log_entries WHERE metadata->>'event' = 'ops_telegram_config_changed' "
            "ORDER BY id DESC LIMIT 1"
        ))).scalar()
    assert json.loads(last)["changed"] == {"ops_event.system_alert": [True, False]}

    # "" removes the token; an enabled bot without one is refused.
    refused = await client.patch("/admin/ops-telegram", json={"bot_token": ""}, headers=_auth(admin))
    assert refused.status_code == 422 and refused.json()["error_code"] == "OPS_TELEGRAM_INCOMPLETE"
    cleared = await client.patch("/admin/ops-telegram", json={"bot_token": "", "enabled": False}, headers=_auth(admin))
    assert cleared.json()["token_set"] is False and cleared.json()["bot_username"] is None


@pytest.mark.asyncio
async def test_invalid_input_is_refused(client, telegram):
    admin = await _admin(client)
    bad = await client.patch("/admin/ops-telegram", json={"bot_token": "12345-no-colon"}, headers=_auth(admin))
    assert bad.status_code == 422 and bad.json()["error_code"] == "TELEGRAM_TOKEN_INVALID"
    assert telegram.calls == []  # format checked before calling Telegram
    revoked = "7412345678:AAHrevokedOpsTokenForTestsOnly_abcdefghijk"
    resp = await client.patch("/admin/ops-telegram", json={"bot_token": revoked}, headers=_auth(admin))
    assert resp.status_code == 422 and resp.json()["error_code"] == "TELEGRAM_TOKEN_INVALID"
    for chat in ("not a chat", "@ab", "12"):
        resp = await client.patch("/admin/ops-telegram", json={"ops_chat_id": chat}, headers=_auth(admin))
        assert resp.status_code == 422 and resp.json()["error_code"] == "OPS_TELEGRAM_CHAT_INVALID", chat
    resp = await client.patch("/admin/ops-telegram", json={"channel_interval_minutes": 1}, headers=_auth(admin))
    assert resp.status_code == 422
    resp = await client.patch("/admin/ops-telegram", json={"events": {"bogus": True}}, headers=_auth(admin))
    assert resp.status_code == 422 and resp.json()["error_code"] == "TELEGRAM_EVENT_UNKNOWN"
    resp = await client.patch("/admin/ops-telegram", json={"enabled": True}, headers=_auth(admin))
    assert resp.status_code == 422 and resp.json()["error_code"] == "OPS_TELEGRAM_INCOMPLETE"
    assert (await _cfg()) is None or (await _cfg()).enabled is False


@pytest.mark.asyncio
async def test_check_token_and_send_test(client, telegram):
    admin = await _admin(client)
    missing = await client.post("/admin/ops-telegram/check", json={}, headers=_auth(admin))
    assert missing.status_code == 404 and missing.json()["error_code"] == "TELEGRAM_NOT_CONNECTED"
    checked = await client.post("/admin/ops-telegram/check", json={"token": OTHER_TOKEN}, headers=_auth(admin))
    assert checked.json() == {"username": "other_ops_bot", "name": "Other"}
    assert await _cfg() is None  # checking stores nothing

    await _enable(client, admin, channel_chat_id=CHANNEL)
    stored = await client.post("/admin/ops-telegram/check", json={}, headers=_auth(admin))
    assert stored.json()["username"] == "gmmo_ops_bot"

    telegram.blocked_chats.add(CHANNEL)
    result = await client.post("/admin/ops-telegram/test", headers=_auth(admin))
    assert result.json() == {"ops": "ok", "channel": "unreachable"}
    assert telegram.sent[0]["chat_id"] == int(OPS_CHAT) and "Bot vận hành" in telegram.sent[0]["text"]


# --- events -------------------------------------------------------------------------

async def _make_events(client, admin: str) -> dict:
    """One of each ops event, produced the way the marketplace produces them."""
    # Withdrawal request (seller with balance).
    seller = await register_and_login(client, "ops_wd@example.com")
    await make_seller("ops_wd@example.com")
    seller = await register_and_login(client, "ops_wd@example.com")
    seller_id = (await client.get("/me", headers=_auth(seller))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "ops test topup", "account_id": seller_id, "amount": 900_000}, headers=_auth(admin))
    async with SessionLocal() as db:
        await request_withdraw(seller_id, 300_000, db, bank_name="Vietcombank", bank_account_number="0123456789",
                               bank_account_holder="NGUYEN VAN A")
    # Maintenance switched on by an admin.
    assert (await client.patch("/admin/site-status", json={"maintenance_enabled": True}, headers=_auth(admin))).status_code == 200
    await client.patch("/admin/site-status", json={"maintenance_enabled": False}, headers=_auth(admin))
    # A buyer applies to sell (name with HTML-looking characters).
    applicant = await register_and_login(client, "ops_apply@example.com")
    applied = await client.post("/seller/apply", json={"business_name": "Shop <b>A&B</b>"}, headers=_auth(applicant))
    assert applied.status_code == 201, applied.text
    async with SessionLocal() as db:
        await add_alert(db, type_="dispute_opened", severity="warning", target_type="order", target_id=4242,
                        message="Đơn #4242 bị khiếu nại: không đăng nhập được")
        await add_alert(db, type_="dispute_seller_timeout", severity="warning", target_type="order", target_id=4243,
                        message="Đơn #4243: seller im lặng quá hạn", href="/admin/disputes?dispute=77")
        await upsert_incident(db, fingerprint="provider:9:supplier_sync_failed", type_="supplier_sync_failed",
                              severity="warning", target_type="provider", target_id=9, message="Nguồn igbm lỗi 3 lần")
        await upsert_incident(db, fingerprint="deposit:31:fx_drift", type_="deposit_anomaly", severity="warning",
                              target_type="deposit", target_id=31, message="Lệnh nạp USDT #31: FX drift 4%")
        # A seller's own low-stock alert is the seller's, not the operators'.
        await add_alert(db, type_="resource_low", severity="warning", target_type="seller", target_id=seller_id,
                        message="Sắp hết hàng")
        await db.commit()
    # An incoming transfer without a payment code (also raises the collapsed
    # deposit:0:unmatched_transfer alert, which must not be sent twice).
    resp = await _post_webhook(client, _payload(0, 40_000, transaction_id=88001, reference="FT-OPS1", code=""))
    assert resp.status_code == 200, resp.text
    return {"seller_id": seller_id}


@pytest.mark.asyncio
async def test_each_event_kind_is_formatted_and_sent_once(client, telegram, monkeypatch):
    monkeypatch.setattr(dispatch, "SUMMARY_OVER", 100)
    admin = await _admin(client)
    await _enable(client, admin)
    await _make_events(client, admin)

    await dispatch.ops_telegram_dispatch_job()
    first = {row.kind: row for row in await _outbox()}
    # Rows younger than the settle window are queued already (dedupe guards a
    # second look), except SePay transfers, which wait until they settle.
    assert "deposit_unmatched" not in first
    await _age_everything()
    await dispatch.ops_telegram_dispatch_job()
    await dispatch.ops_telegram_dispatch_job()

    rows = await _outbox()
    kinds = sorted(row.kind for row in rows)
    # Maintenance on, then off: two flips, two messages.
    assert kinds == sorted([
        "withdrawal_requested", "site_switch", "site_switch", "seller_application", "dispute_opened",
        "dispute_timeout", "system_alert", "deposit_anomaly", "deposit_unmatched",
    ]), kinds
    assert all(row.status == "sent" for row in rows)
    texts_ = [m["text"] for m in telegram.sent]
    assert len(texts_) == len(rows) and all(m["chat_id"] == int(OPS_CHAT) for m in telegram.sent)
    sent_by_id = dict(zip(sorted(row.id for row in rows), telegram.sent))
    by_kind: dict[str, list[str]] = {}
    for row in rows:
        by_kind.setdefault(row.kind, []).append(sent_by_id[row.id]["text"])

    [wd] = by_kind["withdrawal_requested"]
    assert "[CẦN XỬ LÝ] Yêu cầu rút tiền mới · 300.000" in wd
    assert "Vietcombank ••••6789" in wd and "0123456789" not in wd
    assert "ops_wd@example.com" not in wd and "op•••@example.com" in wd
    on, off = by_kind["site_switch"]
    assert "[KHẨN]" in on and "Chế độ bảo trì: BẬT" in on and "ops_admin@example.com" in on
    assert "[CẦN XỬ LÝ]" in off and "Chế độ bảo trì: TẮT" in off
    [app] = by_kind["seller_application"]
    assert "Shop &lt;b&gt;A&amp;B&lt;/b&gt;" in app and "<b>A&B</b>" not in app
    assert "Khiếu nại mới" in by_kind["dispute_opened"][0]
    assert "/vi/admin/disputes?dispute=77" in by_kind["dispute_timeout"][0]
    assert "Đồng bộ nguồn cung bị lỗi" in by_kind["system_alert"][0]
    assert "FX drift" in by_kind["deposit_anomaly"][0]
    assert "40.000" in by_kind["deposit_unmatched"][0] and "FT-OPS1" in by_kind["deposit_unmatched"][0]
    assert all("Sắp hết hàng" not in t for t in texts_)

    # More ticks send nothing new.
    before = len(telegram.sent)
    await dispatch.ops_telegram_dispatch_job()
    assert len(telegram.sent) == before


@pytest.mark.asyncio
async def test_switched_off_event_is_not_sent_and_burst_becomes_summary(client, telegram, monkeypatch):
    admin = await _admin(client)
    await _enable(client, admin, events={"system_alert": False})
    async with SessionLocal() as db:
        for i in range(7):
            await add_alert(db, type_="dispute_opened", severity="warning", target_type="order", target_id=500 + i,
                            message=f"Đơn #{500 + i} bị khiếu nại")
        await upsert_incident(db, fingerprint="provider:3:provider_down", type_="provider_down", severity="critical",
                              target_type="provider", target_id=3, message="Nguồn DProxy down")
        await db.commit()
    await dispatch.ops_telegram_dispatch_job()
    assert len(telegram.sent) == 1
    summary = telegram.sent[0]["text"]
    assert "7 sự kiện vận hành mới" in summary and summary.count("Khiếu nại mới") == 7
    assert "DProxy" not in summary
    assert {row.status for row in await _outbox()} == {"sent"}


@pytest.mark.asyncio
async def test_bot_off_collects_nothing_and_does_not_replay_on_enable(client, telegram):
    admin = await _admin(client)
    async with SessionLocal() as db:
        await add_alert(db, type_="dispute_opened", severity="warning", target_type="order", target_id=1,
                        message="Đơn #1 bị khiếu nại")
        await db.commit()
    await dispatch.ops_telegram_dispatch_job()
    await _enable(client, admin)
    await _age_everything()
    await dispatch.ops_telegram_dispatch_job()
    assert telegram.sent == [] and await _outbox() == []


@pytest.mark.asyncio
async def test_enqueue_ops_message_api(client, telegram):
    admin = await _admin(client)
    async with SessionLocal() as db:
        assert await enqueue_ops_message(db, "tier_demotion", "Hạ hạng shop X") is False  # bot off
    await _enable(client, admin, events={"seller_application": False}, quiet_low_priority=True)
    async with SessionLocal() as db:
        assert await enqueue_ops_message(
            db, "tier_demotion", "Hạ hạng <shop>\nLý do: điểm < 50", dedupe_key="tier:1", link="/admin/accounts/1",
            low_priority=True,
        ) is True
        assert await enqueue_ops_message(db, "tier_demotion", "again", dedupe_key="tier:1") is False
        assert await enqueue_ops_message(db, "seller_application", "switched off") is False
        with pytest.raises(ValueError):
            await enqueue_ops_message(db, "", "x")
        await db.commit()
    await dispatch.ops_telegram_dispatch_job()
    assert len(telegram.sent) == 1
    msg = telegram.sent[0]
    assert msg["text"].startswith("<b>[THÔNG TIN] Hạ hạng &lt;shop&gt;</b>\nLý do: điểm &lt; 50")
    assert msg["parse_mode"] == "HTML" and msg["disable_notification"] is True
    assert "/vi/admin/accounts/1" in msg["text"]  # http dev URL goes into the text, not a button


@pytest.mark.asyncio
async def test_rolled_back_enqueue_is_never_sent(client, telegram):
    admin = await _admin(client)
    await _enable(client, admin)
    async with SessionLocal() as db:
        await enqueue_ops_message(db, "maker_checker", "Chờ duyệt thay đổi phí")
        await db.rollback()
    await dispatch.ops_telegram_dispatch_job()
    assert telegram.sent == []


# --- channel ------------------------------------------------------------------------

async def _product(client, seller: str, cat_id: int, title: str, price: int = 25_000) -> int:
    resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": title, "status": "active", "escrow_days": 2,
    }, headers=_auth(seller))
    assert resp.status_code in (200, 201), resp.text
    pid = resp.json()["id"]
    await client.post(f"/seller/products/{pid}/variants", json={
        "name": "Gói 1", "price": price, "delivery_mode": "manual", "sla_hours": 24,
    }, headers=_auth(seller))
    return pid


@pytest.mark.asyncio
async def test_channel_announces_new_products_once_batched(client, telegram):
    admin = await _admin(client)
    await client.post("/admin/categories", json={"name": "Tài khoản AI", "slug": "tai-khoan-ai"}, headers=_auth(admin))
    cat_id = (await client.get("/categories")).json()[-1]["id"]
    seller = await register_and_login(client, "ops_ch_seller@example.com")
    await make_seller("ops_ch_seller@example.com")
    await set_seller_tier("ops_ch_seller@example.com", "enterprise")  # more than 3 products on sale
    seller = await register_and_login(client, "ops_ch_seller@example.com")
    await _product(client, seller, cat_id, "Có sẵn trước khi bật kênh")

    await _enable(client, admin, channel_chat_id=CHANNEL, channel_enabled=True, channel_interval_minutes=30)
    await dispatch.ops_telegram_dispatch_job()
    assert telegram.sent == []  # already public when the channel was switched on

    a = await _product(client, seller, cat_id, "ChatGPT Plus <1 tháng>", 120_000)
    b = await _product(client, seller, cat_id, "Claude Pro", 450_000)
    draft = await client.post("/seller/products", json={"category_id": cat_id, "title": "Bản nháp", "status": "draft"},
                              headers=_auth(seller))
    assert draft.status_code in (200, 201)
    await dispatch.ops_telegram_dispatch_job()
    assert len(telegram.sent) == 1
    post = telegram.sent[0]
    assert post["chat_id"] == CHANNEL
    assert "ChatGPT Plus &lt;1 tháng&gt;" in post["text"] and "Claude Pro" in post["text"]
    assert "giá từ 120.000" in post["text"] and "Tài khoản AI" in post["text"]
    assert "Bản nháp" not in post["text"] and "Có sẵn trước" not in post["text"]
    async with SessionLocal() as db:
        keys = dict((await db.execute(select(Product.id, Product.public_key).where(Product.id.in_([a, b])))).all())
    assert f"-{keys[a]}" in post["text"] and f"/products/{a}" not in post["text"]

    # A product listed within the interval waits for the next post.
    await _product(client, seller, cat_id, "Gemini Advanced")
    await dispatch.ops_telegram_dispatch_job()
    assert len(telegram.sent) == 1
    async with SessionLocal() as db:
        await db.execute(update(OpsTelegramConfig).values(
            channel_last_post_at=datetime.now(timezone.utc) - timedelta(minutes=31)))
        await db.commit()
    await dispatch.ops_telegram_dispatch_job()
    assert len(telegram.sent) == 2 and "Gemini Advanced" in telegram.sent[1]["text"]
    # Paused then reactivated is not "first time".
    await client.patch(f"/seller/products/{a}", json={"status": "paused"}, headers=_auth(seller))
    await client.patch(f"/seller/products/{a}", json={"status": "active"}, headers=_auth(seller))
    async with SessionLocal() as db:
        await db.execute(update(OpsTelegramConfig).values(channel_last_post_at=None))
        await db.commit()
    await dispatch.ops_telegram_dispatch_job()
    assert len(telegram.sent) == 2


# --- Telegram failures ----------------------------------------------------------------

async def _queue_one(text_: str = "Sự kiện thử") -> None:
    async with SessionLocal() as db:
        assert await enqueue_ops_message(db, "custom", text_)
        await db.commit()


@pytest.mark.asyncio
async def test_429_waits_retry_after(client, telegram):
    admin = await _admin(client)
    await _enable(client, admin)
    await _queue_one()
    telegram.send_errors.append((429, {"description": "Too Many Requests", "parameters": {"retry_after": 17}}))
    await dispatch.ops_telegram_dispatch_job()
    cfg = await _cfg()
    assert cfg.retry_after_at is not None
    assert 10 <= (cfg.retry_after_at - datetime.now(timezone.utc)).total_seconds() <= 17
    assert [row.status for row in await _outbox()] == ["pending"]
    calls = len(telegram.calls)
    await dispatch.ops_telegram_dispatch_job()
    assert len(telegram.calls) == calls  # still waiting
    async with SessionLocal() as db:
        await db.execute(update(OpsTelegramConfig).values(retry_after_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await db.commit()
    await dispatch.ops_telegram_dispatch_job()
    assert [row.status for row in await _outbox()] == ["sent"] and len(telegram.sent) == 1


@pytest.mark.asyncio
async def test_401_pauses_bot_raises_alert_and_resume_clears_it(client, telegram):
    admin = await _admin(client)
    await _enable(client, admin)
    await _queue_one()
    del telegram.bots[TOKEN]  # revoked in @BotFather
    await dispatch.ops_telegram_dispatch_job()
    cfg = await _cfg()
    assert cfg.status == "paused" and cfg.paused_reason == "token_rejected"
    async with SessionLocal() as db:
        alert = await db.scalar(select(Alert).where(Alert.type == "ops_telegram_paused"))
    assert alert is not None and alert.severity == "critical" and alert.is_active
    state = (await client.get("/admin/ops-telegram", headers=_auth(admin))).json()
    assert state["status"] == "paused" and state["outbox"]["pending"] == 1

    calls = len(telegram.calls)
    await dispatch.ops_telegram_dispatch_job()
    assert len(telegram.calls) == calls  # paused: nothing sent

    resumed = await client.patch("/admin/ops-telegram", json={"bot_token": OTHER_TOKEN}, headers=_auth(admin))
    assert resumed.json()["status"] == "active" and resumed.json()["bot_username"] == "other_ops_bot"
    async with SessionLocal() as db:
        alert = await db.scalar(select(Alert).where(Alert.type == "ops_telegram_paused"))
    assert alert.is_active is False
    await dispatch.ops_telegram_dispatch_job()
    assert len(telegram.sent) == 1


@pytest.mark.asyncio
async def test_403_from_group_pauses_with_reason(client, telegram):
    admin = await _admin(client)
    await _enable(client, admin)
    await _queue_one()
    telegram.blocked_chats.add(int(OPS_CHAT))
    await dispatch.ops_telegram_dispatch_job()
    cfg = await _cfg()
    assert cfg.status == "paused" and cfg.paused_reason == "ops_chat_unreachable"
    telegram.blocked_chats.clear()
    resp = await client.patch("/admin/ops-telegram", json={"resume": True}, headers=_auth(admin))
    assert resp.json()["status"] == "active"


@pytest.mark.asyncio
async def test_network_errors_back_off_then_fail(client, telegram, monkeypatch):
    monkeypatch.setattr(dispatch, "MAX_ATTEMPTS", 2)
    admin = await _admin(client)
    await _enable(client, admin)
    await _queue_one()
    telegram.send_errors.append((502, {"description": "Bad Gateway"}))
    await dispatch.ops_telegram_dispatch_job()
    [row] = await _outbox()
    assert row.status == "pending" and row.attempts == 1 and row.next_attempt_at > datetime.now(timezone.utc)
    async with SessionLocal() as db:
        await db.execute(update(OpsTelegramOutbox).values(next_attempt_at=datetime.now(timezone.utc)))
        await db.commit()
    telegram.send_errors.append((502, {"description": "Bad Gateway"}))
    await dispatch.ops_telegram_dispatch_job()
    [row] = await _outbox()
    assert row.status == "failed" and row.attempts == 2
    assert (await _cfg()).status == "active"  # a flaky network never pauses the bot


@pytest.mark.asyncio
async def test_refused_message_does_not_block_the_queue(client, telegram):
    admin = await _admin(client)
    await _enable(client, admin)
    await _queue_one("Một")
    await _queue_one("Hai")
    telegram.send_errors.append((400, {"description": "Bad Request: can't parse entities"}))
    await dispatch.ops_telegram_dispatch_job()
    statuses = [row.status for row in await _outbox()]
    assert statuses == ["failed", "sent"]


@pytest.mark.asyncio
async def test_key_rotation_reencrypts_ops_bot_token(client, telegram):
    import base64
    import hashlib
    import importlib.util
    from pathlib import Path

    from cryptography.fernet import Fernet

    path = Path(__file__).resolve().parents[1] / "scripts" / "rotate_encryption_key.py"
    spec = importlib.util.spec_from_file_location("rotate_encryption_key_ops", path)
    rotate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rotate)

    admin = await _admin(client)
    await _enable(client, admin)
    old_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"previous-key-for-ops-rotation").digest()))
    async with SessionLocal() as db:
        await db.execute(text("UPDATE ops_telegram_config SET bot_token = :t"),
                         {"t": old_fernet.encrypt(TOKEN.encode()).decode()})
        await db.commit()
    async with SessionLocal() as db:
        stats = await rotate._rotate_telegram_tokens(db, old_fernet)
        await db.commit()
    assert stats == {"rotated": 1, "current": 0, "undecryptable": []}
    assert (await _cfg()).bot_token == TOKEN


@pytest.mark.asyncio
async def test_a_failing_source_does_not_stop_the_bot_or_delivery(client, telegram, monkeypatch):
    from src.ops_telegram import collect as collect_mod

    async def broken(*_a, **_k):
        raise ValueError("malformed audit metadata")

    admin = await _admin(client)
    await _enable(client, admin)
    await _queue_one("Đã xếp hàng trước khi nguồn hỏng")
    monkeypatch.setattr(collect_mod, "_collect_log", broken)
    await dispatch.ops_telegram_dispatch_job()   # must not raise
    assert [row.status for row in await _outbox()] == ["sent"] and len(telegram.sent) == 1
