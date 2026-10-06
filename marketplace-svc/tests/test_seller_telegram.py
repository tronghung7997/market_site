"""Seller's own Telegram bot: connect, link a chat by code, deliver the
seller's notifications/alerts, back off and pause on Telegram errors."""
import json
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, text, update

from src import rate_limit
from src.database import SessionLocal
from src.models.alert import Alert
from src.models.mail import MailOutbox
from src.models.notification import Notification
from src.models.provider import Provider
from src.models.seller_telegram import SellerTelegramBot, SellerTelegramChat
from src.seller_telegram import client as tg_client
from src.seller_telegram import dispatch
from tests.conftest import make_seller, register_and_login, statement_log
from tests.test_orders import setup_buyable_product

TOKEN = "7412345678:AAHfakeTokenForTestsOnly_abcdefghijklmnQx9"
OTHER_TOKEN = "7999999999:AAHanotherFakeTokenForTests_abcdefghijkZz1"
CHAT_ID = 55501
GROUP_ID = -100777


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class FakeTelegram:
    """Just enough Bot API: bots by token, a webhook, an update queue, a sent log
    and scripted failures for sendMessage."""

    def __init__(self):
        self.bots = {
            TOKEN: {"id": 7412345678, "is_bot": True, "first_name": "Shop ABC Thông báo", "username": "shopabc_notify_bot"},
            OTHER_TOKEN: {"id": 7999999999, "is_bot": True, "first_name": "Other", "username": "other_notify_bot"},
        }
        self.webhook = ""
        self.updates: list[dict] = []
        self.next_update_id = 900
        self.sent: list[dict] = []
        self.send_errors: list[tuple[int, dict]] = []  # consumed one per sendMessage call
        self.calls: list[str] = []

    def push_message(self, chat: dict, text_: str) -> None:
        self.next_update_id += 1
        self.updates.append({"update_id": self.next_update_id, "message": {"message_id": 1, "chat": chat, "text": text_}})

    def handler(self, request: httpx.Request) -> httpx.Response:
        _, bot_part, method = request.url.path.split("/")
        token = bot_part[3:]
        body = json.loads(request.content or b"{}")
        self.calls.append(method)
        if token not in self.bots:
            return httpx.Response(401, json={"ok": False, "error_code": 401, "description": "Unauthorized"})
        if method == "getMe":
            return httpx.Response(200, json={"ok": True, "result": self.bots[token]})
        if method == "getWebhookInfo":
            return httpx.Response(200, json={"ok": True, "result": {"url": self.webhook}})
        if method == "deleteWebhook":
            self.webhook = ""
            return httpx.Response(200, json={"ok": True, "result": True})
        if method == "getUpdates":
            if self.webhook:
                return httpx.Response(409, json={"ok": False, "error_code": 409, "description": "Conflict"})
            offset = body.get("offset")
            if offset == -1:
                return httpx.Response(200, json={"ok": True, "result": self.updates[-1:]})
            if offset is not None:
                self.updates = [u for u in self.updates if u["update_id"] >= offset]
            return httpx.Response(200, json={"ok": True, "result": list(self.updates)})
        if method == "sendMessage":
            if self.send_errors:
                status, payload = self.send_errors.pop(0)
                return httpx.Response(status, json={"ok": False, "error_code": status, **payload})
            self.sent.append(body)
            return httpx.Response(200, json={"ok": True, "result": {"message_id": len(self.sent)}})
        return httpx.Response(404, json={"ok": False, "error_code": 404, "description": "Not Found"})


async def _clear_rate_limits() -> None:
    # Account ids restart at 1 after every TRUNCATE; Redis counters do not.
    redis = rate_limit._get_client()
    keys = [key async for key in redis.scan_iter("ratelimit:seller-telegram:*")]
    if keys:
        await redis.delete(*keys)


@pytest.fixture
async def telegram():
    await _clear_rate_limits()
    fake = FakeTelegram()
    tg_client.set_transport(httpx.MockTransport(fake.handler))
    dispatch._SEND_GAP_SECONDS = 0
    yield fake
    tg_client.set_transport(None)
    dispatch._SEND_GAP_SECONDS = 1.0


async def _seller(client, email="tg_seller@example.com") -> tuple[str, int]:
    await register_and_login(client, email)
    await make_seller(email)
    token = await register_and_login(client, email)
    me = (await client.get("/me", headers=_auth(token))).json()
    return token, me["id"]


async def _connect_and_link(client, telegram, seller_token) -> dict:
    resp = await client.put("/seller/telegram", json={"token": TOKEN}, headers=_auth(seller_token))
    assert resp.status_code == 200, resp.text
    link = (await client.post("/seller/telegram/link", headers=_auth(seller_token))).json()
    telegram.push_message({"id": CHAT_ID, "type": "private", "first_name": "Văn A", "username": "vana"}, f"/start {link['code']}")
    polled = (await client.get("/seller/telegram/link", headers=_auth(seller_token))).json()
    assert polled["status"] == "linked"
    state = await client.post(f"/seller/telegram/chats/{polled['chat']['key']}/confirm", headers=_auth(seller_token))
    assert state.status_code == 200, state.text
    telegram.sent.clear()
    return state.json()


async def _bot(seller_id: int) -> SellerTelegramBot:
    async with SessionLocal() as db:
        return await db.scalar(select(SellerTelegramBot).where(SellerTelegramBot.seller_id == seller_id))


async def _add_notification(seller_id: int, kind: str, params: dict, *, category="order", href=None, age_minutes=10) -> int:
    async with SessionLocal() as db:
        row = Notification(account_id=seller_id, category=category, kind=kind, params=params, href=href,
                           created_at=datetime.now(timezone.utc) - timedelta(minutes=age_minutes))
        db.add(row)
        await db.commit()
        return row.id


async def _add_alert(type_: str, target_type: str, target_id: int, message: str, age_minutes=10) -> int:
    when = datetime.now(timezone.utc) - timedelta(minutes=age_minutes)
    async with SessionLocal() as db:
        row = Alert(type=type_, severity="warning", target_type=target_type, target_id=target_id, message=message,
                    is_active=True, first_seen_at=when, last_seen_at=when, created_at=when)
        db.add(row)
        await db.commit()
        return row.id


async def _deliver(seller_id: int) -> None:
    await dispatch.deliver((await _bot(seller_id)).id)


# --- access -----------------------------------------------------------------

@pytest.mark.asyncio
async def test_requires_seller(client, telegram):
    assert (await client.get("/seller/telegram")).status_code == 401
    buyer = await register_and_login(client, "tg_buyer@example.com")
    assert (await client.get("/seller/telegram", headers=_auth(buyer))).status_code == 403
    assert (await client.put("/seller/telegram", json={"token": TOKEN}, headers=_auth(buyer))).status_code == 403
    assert telegram.calls == []


# --- connect ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_connect_stores_encrypted_token_and_never_returns_it(client, telegram):
    seller, seller_id = await _seller(client)
    before = (await client.get("/seller/telegram", headers=_auth(seller))).json()
    assert before["connected"] is False and all(before["events"].values())

    resp = await client.put("/seller/telegram", json={"token": f"  {TOKEN} "}, headers=_auth(seller))
    assert resp.status_code == 200, resp.text
    state = resp.json()
    assert state["bot"] == {"username": "shopabc_notify_bot", "name": "Shop ABC Thông báo", "token_hint": "7412…Qx9"}
    assert state["status"] == "active" and state["chats"] == []
    assert TOKEN not in resp.text and TOKEN.split(":")[1] not in resp.text

    async with SessionLocal() as db:
        raw = await db.scalar(text("SELECT token FROM seller_telegram_bots WHERE seller_id = :s"), {"s": seller_id})
        audit = await db.scalar(text(
            "SELECT count(*) FROM log_entries WHERE metadata->>'event' = 'seller_telegram_connected'"
        ))
    assert raw.startswith("gAAAA") and TOKEN not in raw
    assert audit == 1


@pytest.mark.asyncio
async def test_connect_rejects_bad_or_revoked_token(client, telegram):
    seller, _ = await _seller(client)
    bad = await client.put("/seller/telegram", json={"token": "7412345678AAH-no-colon"}, headers=_auth(seller))
    assert bad.status_code == 422 and bad.json()["error_code"] == "TELEGRAM_TOKEN_INVALID"
    assert telegram.calls == []  # format is checked before calling Telegram

    revoked = "7412345678:AAHrevokedTokenForTestsOnly_abcdefghijklmn"
    resp = await client.put("/seller/telegram", json={"token": revoked}, headers=_auth(seller))
    assert resp.status_code == 422 and resp.json()["error_code"] == "TELEGRAM_TOKEN_INVALID"
    assert (await client.get("/seller/telegram", headers=_auth(seller))).json()["connected"] is False


@pytest.mark.asyncio
async def test_connect_refuses_bot_owned_by_a_webhook_unless_seller_agrees(client, telegram):
    seller, _ = await _seller(client)
    telegram.webhook = "https://other-tool.example/hook"
    resp = await client.put("/seller/telegram", json={"token": TOKEN}, headers=_auth(seller))
    assert resp.status_code == 409 and resp.json()["error_code"] == "TELEGRAM_WEBHOOK_IN_USE"
    assert telegram.webhook

    resp = await client.put("/seller/telegram", json={"token": TOKEN, "replace_webhook": True}, headers=_auth(seller))
    assert resp.status_code == 200 and telegram.webhook == ""


@pytest.mark.asyncio
async def test_connect_attempts_are_rate_limited(client, telegram):
    seller, _ = await _seller(client)
    codes = [
        (await client.put("/seller/telegram", json={"token": "1234567:bad"}, headers=_auth(seller))).status_code
        for _ in range(11)
    ]
    assert codes[:10] == [422] * 10 and codes[10] == 429


@pytest.mark.asyncio
async def test_telegram_down_is_503_and_error_hides_token(client, telegram):
    def boom(request):
        raise httpx.ConnectError(f"cannot reach {request.url}")

    tg_client.set_transport(httpx.MockTransport(boom))
    with pytest.raises(tg_client.TelegramError) as exc_info:
        await tg_client.get_me(TOKEN)
    assert exc_info.value.kind == "unavailable"
    assert TOKEN not in str(exc_info.value) and TOKEN not in exc_info.value.description
    assert exc_info.value.__cause__ is None and exc_info.value.__suppress_context__

    seller, _ = await _seller(client)
    resp = await client.put("/seller/telegram", json={"token": TOKEN}, headers=_auth(seller))
    assert resp.status_code == 503 and resp.json()["error_code"] == "TELEGRAM_UNAVAILABLE"


# --- linking ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_link_by_code_then_confirm_sends_test_message(client, telegram):
    seller, seller_id = await _seller(client)
    await client.put("/seller/telegram", json={"token": TOKEN}, headers=_auth(seller))
    telegram.push_message({"id": 1, "type": "private", "first_name": "Old"}, "/start 000000")  # before the code

    link = (await client.post("/seller/telegram/link", headers=_auth(seller))).json()
    assert re.fullmatch(r"\d{6}", link["code"])
    assert link["deep_link"] == f"https://t.me/shopabc_notify_bot?start={link['code']}"
    assert link["group_command"] == f"/start@shopabc_notify_bot {link['code']}"
    assert (await client.get("/seller/telegram/link", headers=_auth(seller))).json() == {"status": "waiting", "chat": None}

    # Wrong code, and the right code addressed to another bot, are ignored.
    telegram.push_message({"id": 2, "type": "private", "first_name": "X"}, "/start 123")
    telegram.push_message({"id": 3, "type": "group", "title": "Other"}, f"/start@other_notify_bot {link['code']}")
    assert (await client.get("/seller/telegram/link", headers=_auth(seller))).json()["status"] == "waiting"

    telegram.push_message({"id": GROUP_ID, "type": "supergroup", "title": "Shop ABC team"},
                          f"/start@ShopAbc_Notify_Bot {link['code']}")
    polled = (await client.get("/seller/telegram/link", headers=_auth(seller))).json()
    assert polled["status"] == "linked"
    assert polled["chat"]["title"] == "Shop ABC team" and polled["chat"]["status"] == "pending"
    assert (await client.get("/seller/telegram/link", headers=_auth(seller))).json()["status"] == "idle"

    state = (await client.post(f"/seller/telegram/chats/{polled['chat']['key']}/confirm", headers=_auth(seller))).json()
    assert [c["status"] for c in state["chats"]] == ["active"]
    assert telegram.sent[-1]["chat_id"] == GROUP_ID and "Kết nối thành công" in telegram.sent[-1]["text"]

    test = (await client.post("/seller/telegram/test", headers=_auth(seller))).json()
    assert test == {"delivered": [polled["chat"]["key"]], "failed": []}


@pytest.mark.asyncio
async def test_expired_code_and_other_sellers_chat(client, telegram):
    seller, seller_id = await _seller(client)
    state = await _connect_and_link(client, telegram, seller)
    key = state["chats"][0]["key"]

    await client.post("/seller/telegram/link", headers=_auth(seller))
    async with SessionLocal() as db:
        await db.execute(update(SellerTelegramBot).values(link_code_expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await db.commit()
    assert (await client.get("/seller/telegram/link", headers=_auth(seller))).json()["status"] == "expired"

    other, _ = await _seller(client, "tg_other@example.com")
    assert (await client.post(f"/seller/telegram/chats/{key}/confirm", headers=_auth(other))).status_code == 404
    assert (await client.delete(f"/seller/telegram/chats/{key}", headers=_auth(other))).status_code == 404
    await client.put("/seller/telegram", json={"token": OTHER_TOKEN}, headers=_auth(other))
    resp = await client.delete(f"/seller/telegram/chats/{key}", headers=_auth(other))
    assert resp.status_code == 404 and resp.json()["error_code"] == "TELEGRAM_CHAT_NOT_FOUND"
    assert (await client.get("/seller/telegram", headers=_auth(seller))).json()["chats"][0]["key"] == key


@pytest.mark.asyncio
async def test_events_validation_and_disconnect(client, telegram):
    seller, seller_id = await _seller(client)
    await _connect_and_link(client, telegram, seller)
    bad = await client.patch("/seller/telegram/events", json={"events": {"everything": True}}, headers=_auth(seller))
    assert bad.status_code == 422 and bad.json()["error_code"] == "TELEGRAM_EVENT_UNKNOWN"
    state = (await client.patch("/seller/telegram/events", json={"events": {"withdrawal": False}}, headers=_auth(seller))).json()
    assert state["events"]["withdrawal"] is False and state["events"]["dispute"] is True

    gone = (await client.delete("/seller/telegram", headers=_auth(seller))).json()
    assert gone["connected"] is False
    async with SessionLocal() as db:
        assert await db.scalar(select(SellerTelegramChat.id)) is None


# --- delivery -------------------------------------------------------------------

@pytest.mark.asyncio
async def test_manual_order_is_announced_instant_order_is_not(client, telegram):
    buyer, seller, _, instant_id, manual_id = await setup_buyable_product(client)
    seller_id = (await client.get("/me", headers=_auth(seller))).json()["id"]
    await _connect_and_link(client, telegram, seller)

    await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))
    manual = (await client.post("/orders", json={"variant_id": manual_id, "quantity": 1}, headers=_auth(buyer))).json()
    await _deliver(seller_id)

    assert len(telegram.sent) == 1
    message = telegram.sent[0]
    assert message["chat_id"] == CHAT_ID and message["parse_mode"] == "HTML"
    assert "Đơn mới cần giao" in message["text"]
    assert f"{manual['order_code']} · Order Test · Manual Var ×1 · 5.000 ₫" in message["text"]
    # Local dev links are http://localhost: no URL button, the link is in the text.
    assert "reply_markup" not in message and f"/vi/seller/orders/{manual['order_code']}" in message["text"]
    assert "uid1" not in message["text"] and "ord_buyer" not in message["text"]

    await _deliver(seller_id)
    assert len(telegram.sent) == 1  # nothing twice


@pytest.mark.asyncio
async def test_alerts_events_switches_and_summary(client, telegram, monkeypatch):
    seller, seller_id = await _seller(client)
    await _connect_and_link(client, telegram, seller)
    stranger, stranger_id = await _seller(client, "tg_stranger@example.com")
    async with SessionLocal() as db:
        mine = Provider(name="Nguồn A", type="proxy", adapter_type="mock", seller_id=seller_id, config={})
        theirs = Provider(name="Nguồn B", type="proxy", adapter_type="mock", seller_id=stranger_id, config={})
        db.add_all([mine, theirs])
        await db.commit()
        mine_id, theirs_id = mine.id, theirs.id

    await _add_alert("resource_low", "seller", seller_id, "Gói Gmail · US chỉ còn 2 tài nguyên sẵn sàng")
    await _add_alert("provider_out_of_credit", "provider", mine_id, "admin text")
    await _add_alert("provider_out_of_credit", "provider", theirs_id, "admin text")
    await _add_alert("resource_low", "seller", stranger_id, "not mine")
    await _add_notification(seller_id, "withdrawal_rejected", {"amount": 2_000_000, "reason": "Sai tên chủ tài khoản"},
                            category="wallet", href="/seller/withdrawals")
    await client.patch("/seller/telegram/events", json={"events": {"withdrawal": False}}, headers=_auth(seller))
    await _deliver(seller_id)

    texts_ = [m["text"] for m in telegram.sent]
    assert len(texts_) == 2
    assert "Sắp hết hàng" in texts_[0] and "chỉ còn 2" in texts_[0]
    assert "[KHẨN] Nguồn hàng hết tiền" in texts_[1] and "Nguồn A" in texts_[1] and "admin text" not in texts_[1]
    assert not any("not mine" in t or "Nguồn B" in t or "rút tiền" in t for t in texts_)

    # A burst becomes one summary message.
    telegram.sent.clear()
    for n in range(6):
        await _add_notification(seller_id, "dispute_opened", {"order_code": f"ORD-TEST{n}"},
                                href=f"/seller/orders/ORD-TEST{n}")
    await _deliver(seller_id)
    assert len(telegram.sent) == 1
    assert "Thông báo mới của shop" in telegram.sent[0]["text"] and telegram.sent[0]["text"].count("Khiếu nại mới") == 6


@pytest.mark.asyncio
async def test_recent_rows_are_not_resent_while_cursor_waits(client, telegram):
    seller, seller_id = await _seller(client)
    await _connect_and_link(client, telegram, seller)
    fresh = await _add_notification(seller_id, "dispute_opened", {"order_code": "ORD-FRESH1"}, age_minutes=0)
    await _deliver(seller_id)
    bot = await _bot(seller_id)
    assert len(telegram.sent) == 1
    assert bot.last_notification_id < fresh and bot.recent_sent["n"] == [fresh]

    await _deliver(seller_id)
    assert len(telegram.sent) == 1
    async with SessionLocal() as db:
        await db.execute(update(Notification).where(Notification.id == fresh)
                         .values(created_at=datetime.now(timezone.utc) - timedelta(minutes=10)))
        await db.commit()
    await _deliver(seller_id)
    bot = await _bot(seller_id)
    assert len(telegram.sent) == 1 and bot.last_notification_id == fresh and bot.recent_sent["n"] == []


async def _buyer_says(client, buyer: str, room_id: str, body: str) -> None:
    resp = await client.post(f"/chat/conversations/{room_id}/messages",
                             json={"body": body, "client_message_id": str(uuid.uuid4())}, headers=_auth(buyer))
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_buyer_messages_are_forwarded_in_full_every_ten_minutes(client, telegram):
    buyer, seller, _, _, _ = await setup_buyable_product(client)
    seller_id = (await client.get("/me", headers=_auth(seller))).json()["id"]
    buyer_key = (await client.get("/me", headers=_auth(buyer))).json()["public_key"]
    await _connect_and_link(client, telegram, seller)
    product = (await client.get("/seller/products", headers=_auth(seller))).json()["items"][-1]
    room = (await client.post("/chat/inquiries", json={
        "product_id": product["id"], "initial_message": "Shop ơi còn hàng không?",
        "client_message_id": str(uuid.uuid4()),
    }, headers=_auth(buyer))).json()
    # Replying reads the thread: only what the buyer wrote after that is new.
    await client.post(f"/chat/conversations/{room['id']}/messages",
                      json={"body": "Shop trả lời", "client_message_id": str(uuid.uuid4())}, headers=_auth(seller))
    await _buyer_says(client, buyer, room["id"], "Mua 5 cái được giảm <b>giá</b> & bảo hành không?")
    await _buyer_says(client, buyer, room["id"], "Cần gấp trong hôm nay")
    await _deliver(seller_id)

    assert len(telegram.sent) == 1
    text_ = telegram.sent[0]["text"]
    assert "Tin nhắn mới từ buyer" in text_ and "2 tin chưa đọc trong 1 cuộc trò chuyện" in text_
    assert f"<b>Khách hàng #{buyer_key} · hỏi về Order Test</b>" in text_
    assert "› Mua 5 cái được giảm &lt;b&gt;giá&lt;/b&gt; &amp; bảo hành không?" in text_  # buyer text is escaped
    assert "› Cần gấp trong hôm nay" in text_
    assert "Shop trả lời" not in text_ and "còn hàng" not in text_
    assert f"/vi/messages/{room['id']}" in text_

    # A new message right after: held until ten minutes have passed.
    await _buyer_says(client, buyer, room["id"], "Shop ơi?")
    await _deliver(seller_id)
    assert len(telegram.sent) == 1
    async with SessionLocal() as db:
        await db.execute(update(SellerTelegramBot).values(
            chat_digest_sent_at=datetime.now(timezone.utc) - timedelta(minutes=11)))
        await db.commit()
    await _deliver(seller_id)
    assert len(telegram.sent) == 2
    assert "› Shop ơi?" in telegram.sent[1]["text"] and "Cần gấp" not in telegram.sent[1]["text"]

    # Read on the site before the round-up: nothing to forward.
    await _buyer_says(client, buyer, room["id"], "Đã đọc chưa?")
    await client.get(f"/chat/conversations/{room['id']}", headers=_auth(seller))
    async with SessionLocal() as db:
        await db.execute(update(SellerTelegramBot).values(
            chat_digest_sent_at=datetime.now(timezone.utc) - timedelta(minutes=11)))
        await db.commit()
    await _deliver(seller_id)
    assert len(telegram.sent) == 2


@pytest.mark.asyncio
async def test_long_buyer_chat_is_cut_to_telegram_size(client, telegram):
    buyer, seller, _, _, _ = await setup_buyable_product(client)
    seller_id = (await client.get("/me", headers=_auth(seller))).json()["id"]
    await _connect_and_link(client, telegram, seller)
    product = (await client.get("/seller/products", headers=_auth(seller))).json()["items"][-1]
    room = (await client.post("/chat/inquiries", json={
        "product_id": product["id"], "initial_message": "x" * 3000, "client_message_id": str(uuid.uuid4()),
    }, headers=_auth(buyer))).json()
    for n in range(12):
        await _buyer_says(client, buyer, room["id"], f"tin {n} " + "y" * 500)
    await _deliver(seller_id)
    text_ = telegram.sent[0]["text"]
    assert len(text_) < 4096
    assert "x" * 600 + "…" in text_ and "x" * 601 not in text_
    assert re.search(r"… và \d+ tin nữa — mở trên sàn để đọc tiếp", text_)


@pytest.mark.asyncio
async def test_rate_limit_backs_off_without_losing_the_message(client, telegram):
    seller, seller_id = await _seller(client)
    await _connect_and_link(client, telegram, seller)
    note = await _add_notification(seller_id, "dispute_opened", {"order_code": "ORD-RATE1"})
    telegram.send_errors = [(429, {"description": "Too Many Requests", "parameters": {"retry_after": 17}})]
    await _deliver(seller_id)
    bot = await _bot(seller_id)
    assert telegram.sent == [] and bot.last_notification_id < note
    assert bot.retry_after_at > datetime.now(timezone.utc) + timedelta(seconds=10)
    async with SessionLocal() as db:  # the job skips the bot until then
        bots = await db.scalar(text("SELECT count(*) FROM seller_telegram_bots WHERE retry_after_at > now()"))
    assert bots == 1

    await _deliver(seller_id)
    assert len(telegram.sent) == 1 and "ORD-RATE1" in telegram.sent[0]["text"]


@pytest.mark.asyncio
async def test_blocked_chat_three_times_pauses_bot_and_tells_seller(client, telegram):
    seller, seller_id = await _seller(client)
    await _connect_and_link(client, telegram, seller)
    for n in range(3):
        await _add_notification(seller_id, "dispute_opened", {"order_code": f"ORD-BLK{n}"})
        telegram.send_errors = [(403, {"description": "Forbidden: bot was blocked by the user"})]
        await _deliver(seller_id)

    state = (await client.get("/seller/telegram", headers=_auth(seller))).json()
    assert state["status"] == "paused" and state["paused_reason"] == "no_chats"
    assert state["chats"][0]["status"] == "broken"
    async with SessionLocal() as db:
        told = await db.scalar(select(Notification).where(Notification.kind == "telegram_paused"))
        mail = await db.scalar(select(MailOutbox).where(MailOutbox.template == "telegram_paused"))
    assert told.account_id == seller_id and told.href == "/seller/telegram"
    assert mail.account_id == seller_id and "chặn" in mail.payload["reason"]

    # Paused: the job does not pick it up any more.
    await _add_notification(seller_id, "dispute_opened", {"order_code": "ORD-AFTER"})
    telegram.sent.clear()
    await dispatch.telegram_dispatch_job()
    assert telegram.sent == []


@pytest.mark.asyncio
async def test_revoked_token_pauses_after_three_ticks_and_relinking_resumes_from_now(client, telegram):
    seller, seller_id = await _seller(client)
    await _connect_and_link(client, telegram, seller)
    await _add_notification(seller_id, "dispute_opened", {"order_code": "ORD-REV1"})
    for _ in range(3):
        telegram.send_errors = [(401, {"description": "Unauthorized"})]
        await _deliver(seller_id)
    state = (await client.get("/seller/telegram", headers=_auth(seller))).json()
    assert state["status"] == "paused" and state["paused_reason"] == "token_rejected"
    assert state["chats"][0]["status"] == "active"

    # Pasting the (new) token again resumes without replaying the backlog.
    resp = await client.put("/seller/telegram", json={"token": TOKEN}, headers=_auth(seller))
    assert resp.json()["status"] == "active" and len(resp.json()["chats"]) == 1
    await _deliver(seller_id)
    assert telegram.sent == []


@pytest.mark.asyncio
async def test_group_upgraded_to_supergroup_follows_new_id(client, telegram):
    seller, seller_id = await _seller(client)
    await _connect_and_link(client, telegram, seller)
    await _add_notification(seller_id, "dispute_opened", {"order_code": "ORD-MIG1"})
    telegram.send_errors = [(400, {"description": "Bad Request: group chat was upgraded to a supergroup chat",
                                   "parameters": {"migrate_to_chat_id": -1009999}})]
    await _deliver(seller_id)
    assert telegram.sent[0]["chat_id"] == -1009999
    async with SessionLocal() as db:
        assert await db.scalar(select(SellerTelegramChat.chat_id)) == -1009999


@pytest.mark.asyncio
async def test_replacing_bot_drops_chats_of_the_old_bot(client, telegram):
    seller, seller_id = await _seller(client)
    await _connect_and_link(client, telegram, seller)
    state = (await client.put("/seller/telegram", json={"token": OTHER_TOKEN}, headers=_auth(seller))).json()
    assert state["bot"]["username"] == "other_notify_bot" and state["chats"] == []


@pytest.mark.asyncio
async def test_key_rotation_reencrypts_bot_tokens(client, telegram):
    import base64
    import hashlib
    import importlib.util
    from pathlib import Path

    from cryptography.fernet import Fernet

    path = Path(__file__).resolve().parents[1] / "scripts" / "rotate_encryption_key.py"
    spec = importlib.util.spec_from_file_location("rotate_encryption_key_tg", path)
    rotate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rotate)

    seller, seller_id = await _seller(client)
    await client.put("/seller/telegram", json={"token": TOKEN}, headers=_auth(seller))
    old_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"previous-key-for-telegram-rotation").digest()))
    async with SessionLocal() as db:
        await db.execute(text("UPDATE seller_telegram_bots SET token = :t"),
                         {"t": old_fernet.encrypt(TOKEN.encode()).decode()})
        await db.commit()
    async with SessionLocal() as db:
        stats = await rotate._rotate_telegram_tokens(db, old_fernet)
        await db.commit()
    assert stats == {"rotated": 1, "current": 0, "undecryptable": []}
    assert (await _bot(seller_id)).token == TOKEN


# --- scheduler tick -------------------------------------------------------------

@pytest.fixture
def ordinary_ticks(monkeypatch):
    """The periodic full pass ran just now: ticks below rely on the work probe."""
    monkeypatch.setattr(dispatch, "_last_full_pass", time.monotonic())


async def _tick() -> list[str]:
    with statement_log() as statements:
        await dispatch.telegram_dispatch_job()
    return list(statements)


@pytest.mark.asyncio
async def test_idle_tick_is_one_query(client, telegram, ordinary_ticks):
    seller, seller_id = await _seller(client)
    await _connect_and_link(client, telegram, seller)
    other, other_id = await _seller(client, "tg_other@example.com")
    # Work for nobody with a bot: another seller's alert, an instant order.
    await _add_alert("resource_low", "seller", other_id, "not mine", age_minutes=0)
    await _add_notification(seller_id, "order_new", {"order_code": "ORD-AUTO1", "auto": True}, age_minutes=0)
    await _add_notification(seller_id, "chat_message", {"from": "buyer"}, category="message", age_minutes=0)

    statements = await _tick()
    assert len(statements) == 1 and telegram.sent == []

    # The periodic full pass still visits the bot (and finds nothing to send).
    dispatch._last_full_pass = None
    assert len(await _tick()) > 1
    assert telegram.sent == []


@pytest.mark.asyncio
async def test_tick_sends_once_and_goes_idle_until_the_cursor_can_move(client, telegram, ordinary_ticks):
    seller, seller_id = await _seller(client)
    await _connect_and_link(client, telegram, seller)
    fresh = await _add_notification(seller_id, "dispute_opened", {"order_code": "ORD-TICK1"}, age_minutes=0)

    await _tick()
    assert len(telegram.sent) == 1 and "ORD-TICK1" in telegram.sent[0]["text"]
    # Sent but not settled: nothing to do, the bot is not even loaded.
    assert len(await _tick()) == 1
    assert len(telegram.sent) == 1

    async with SessionLocal() as db:
        await db.execute(update(Notification).where(Notification.id == fresh)
                         .values(created_at=datetime.now(timezone.utc) - timedelta(minutes=10)))
        await db.commit()
    assert len(await _tick()) > 1  # settled: one pass moves the cursor
    bot = await _bot(seller_id)
    assert bot.last_notification_id == fresh and bot.recent_sent["n"] == []
    assert len(await _tick()) == 1
    assert len(telegram.sent) == 1

    # A seller alert and a provider alert of the seller's own provider wake it up.
    async with SessionLocal() as db:
        mine = Provider(name="Nguồn A", type="proxy", adapter_type="mock", seller_id=seller_id, config={})
        db.add(mine)
        await db.commit()
        mine_id = mine.id
    await _add_alert("provider_out_of_credit", "provider", mine_id, "admin text", age_minutes=0)
    await _tick()
    assert len(telegram.sent) == 2 and "Nguồn A" in telegram.sent[1]["text"]
    assert len(await _tick()) == 1


@pytest.mark.asyncio
async def test_tick_forwards_a_new_buyer_message_exactly_once(client, telegram, ordinary_ticks):
    buyer, seller, _, _, _ = await setup_buyable_product(client)
    seller_id = (await client.get("/me", headers=_auth(seller))).json()["id"]
    await _connect_and_link(client, telegram, seller)
    product = (await client.get("/seller/products", headers=_auth(seller))).json()["items"][-1]
    room = (await client.post("/chat/inquiries", json={
        "product_id": product["id"], "initial_message": "Shop ơi còn hàng không?",
        "client_message_id": str(uuid.uuid4()),
    }, headers=_auth(buyer))).json()

    await _tick()
    assert len(telegram.sent) == 1 and "› Shop ơi còn hàng không?" in telegram.sent[0]["text"]
    assert len(await _tick()) == 1

    async def round_up_due() -> None:
        async with SessionLocal() as db:
            await db.execute(update(SellerTelegramBot).where(SellerTelegramBot.seller_id == seller_id).values(
                chat_digest_sent_at=datetime.now(timezone.utc) - timedelta(minutes=11)))
            await db.commit()

    await round_up_due()
    assert len(await _tick()) == 1  # due, but nothing new since the last round-up
    await _buyer_says(client, buyer, room["id"], "Còn không shop?")
    await _tick()
    await _tick()
    assert len(telegram.sent) == 2
    assert "› Còn không shop?" in telegram.sent[1]["text"] and "còn hàng" not in telegram.sent[1]["text"]

    # Written while the switch was off: not forwarded after it is turned back on.
    await client.patch("/seller/telegram/events", json={"events": {"chat_messages": False}}, headers=_auth(seller))
    await _buyer_says(client, buyer, room["id"], "Tin lúc tắt")
    await client.patch("/seller/telegram/events", json={"events": {"chat_messages": True}}, headers=_auth(seller))
    await round_up_due()
    await _tick()
    assert len(telegram.sent) == 2
    await _buyer_says(client, buyer, room["id"], "Tin sau khi bật")
    await _tick()
    assert len(telegram.sent) == 3 and "Tin sau khi bật" in telegram.sent[2]["text"]
    assert "Tin lúc tắt" not in telegram.sent[2]["text"]


@pytest.mark.asyncio
async def test_tick_skips_rate_limited_and_paused_bots_and_counts_failures(client, telegram, ordinary_ticks):
    seller, seller_id = await _seller(client)
    await _connect_and_link(client, telegram, seller)
    await _add_notification(seller_id, "dispute_opened", {"order_code": "ORD-WAIT1"})
    async with SessionLocal() as db:
        await db.execute(update(SellerTelegramBot).values(
            retry_after_at=datetime.now(timezone.utc) + timedelta(minutes=1)))
        await db.commit()
    await _tick()
    assert telegram.sent == []
    async with SessionLocal() as db:
        await db.execute(update(SellerTelegramBot).values(
            retry_after_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await db.commit()
    await _tick()
    assert len(telegram.sent) == 1

    # The chat blocks the bot: each tick retries the unsent row and counts it.
    for n in range(3):
        await _add_notification(seller_id, "dispute_opened", {"order_code": f"ORD-BLKT{n}"})
        telegram.send_errors = [(403, {"description": "Forbidden: bot was blocked by the user"})]
        await _tick()
        if n < 2:
            async with SessionLocal() as db:
                assert await db.scalar(select(SellerTelegramChat.fail_count)) == n + 1
    state = (await client.get("/seller/telegram", headers=_auth(seller))).json()
    assert state["status"] == "paused" and state["chats"][0]["status"] == "broken"

    telegram.sent.clear()
    await _add_notification(seller_id, "dispute_opened", {"order_code": "ORD-PAUSED"})
    dispatch._last_full_pass = None  # even a full pass leaves a paused bot alone
    assert len(await _tick()) == 1
    assert telegram.sent == []
