"""Notification history: written with the change that caused it, listed and
marked read per account, one unread row per chat thread."""
import uuid

import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.notification import Notification
from src.models.order import Order, OrderStatus
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _setup(client):
    """The shared fixture credits the buyer by hand; start from an empty feed."""
    parties = await setup_buyable_product(client)
    async with SessionLocal() as db:
        await db.execute(Notification.__table__.delete())
        await db.commit()
    return parties


async def _feed(client, token, **params):
    resp = await client.get("/me/notifications", params=params, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_notifications_require_sign_in(client):
    assert (await client.get("/me/notifications")).status_code == 401
    assert (await client.get("/me/notifications/unread")).status_code == 401
    assert (await client.post("/me/notifications/read", json={})).status_code == 401


@pytest.mark.asyncio
async def test_order_lifecycle_notifies_buyer_and_seller(client):
    buyer, seller, _, instant_id, _ = await _setup(client)
    order = (await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))).json()
    code = order["order_code"]

    mine = await _feed(client, buyer)
    assert [(n["kind"], n["params"]["order_code"], n["href"]) for n in mine["items"]] == [
        ("order_delivered", code, f"/orders/{code}"),
    ]
    assert mine["unread"] == 1 and mine["by_category"]["order"] == 1
    shop = await _feed(client, seller)
    assert [n["kind"] for n in shop["items"]] == ["order_new"]
    assert shop["items"][0]["href"] == f"/seller/orders/{code}"

    # Delivered from stock: the seller only needs to know it sold.
    assert shop["items"][0]["params"] == {"order_code": code, "auto": True}

    await client.post(f"/orders/{order['id']}/confirm", headers=_auth(buyer))
    shop = await _feed(client, seller)
    assert [n["kind"] for n in shop["items"]] == ["order_completed", "order_new"]
    # Confirming tells the buyer nothing new and settles "delivered — check it".
    mine = await _feed(client, buyer)
    assert mine["unread"] == 0 and [n["read"] for n in mine["items"]] == [True]


@pytest.mark.asyncio
async def test_status_set_right_before_commit_is_still_told(client):
    # Nothing flushes between the assignment and commit() (the adapter-error
    # cancel path): the change must still reach both sides.
    buyer, seller, _, instant_id, _ = await _setup(client)
    order = (await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))).json()
    async with SessionLocal() as db:
        await db.execute(Notification.__table__.delete())
        await db.commit()
        row = await db.get(Order, order["id"])
        row.status = OrderStatus.refunded
        await db.commit()
    assert [n["kind"] for n in (await _feed(client, buyer))["items"]] == ["order_refunded"]
    assert [n["kind"] for n in (await _feed(client, seller))["items"]] == ["order_refunded"]


@pytest.mark.asyncio
async def test_seeded_orders_notify_no_one(client):
    buyer, seller, _, instant_id, _ = await _setup(client)
    order = (await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))).json()
    async with SessionLocal() as db:
        await db.execute(update(Order).where(Order.id == order["id"]).values(is_seeded=True))
        await db.execute(Notification.__table__.delete())
        await db.commit()
    await client.post(f"/orders/{order['id']}/confirm", headers=_auth(buyer))
    assert (await _feed(client, seller))["items"] == []


@pytest.mark.asyncio
async def test_mark_read_by_id_category_or_all_only_touches_own_rows(client):
    buyer, seller, admin, instant_id, _ = await _setup(client)
    for _ in range(3):
        await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))
    me = (await client.get("/me", headers=_auth(buyer))).json()
    await client.post(
        "/wallet/topup", json={"reason": "bù tiền", "account_id": me["id"], "amount": 5000}, headers=_auth(admin),
    )
    feed = await _feed(client, buyer)
    assert feed["unread"] == 4 and feed["by_category"] == {"order": 3, "wallet": 1, "message": 0, "system": 0}
    wallet = await _feed(client, buyer, category="wallet")
    assert [(n["kind"], n["params"]) for n in wallet["items"]] == [("wallet_credited", {"amount": 5000})]

    first = feed["items"][-1]["id"]
    seller_row = (await _feed(client, seller))["items"][0]["id"]
    # Someone else's id is ignored, not an error.
    done = await client.post("/me/notifications/read", json={"ids": [first, seller_row]}, headers=_auth(buyer))
    assert done.status_code == 200 and done.json()["unread"] == 3
    assert (await _feed(client, seller))["unread"] == 3
    assert (await _feed(client, buyer, unread_only=True))["items"][-1]["id"] != first

    counts = (await client.post("/me/notifications/read", json={"category": "order"}, headers=_auth(buyer))).json()
    assert counts["unread"] == 1 and counts["by_category"]["wallet"] == 1
    counts = (await client.post("/me/notifications/read", json={}, headers=_auth(buyer))).json()
    assert counts["unread"] == 0
    assert (await client.get("/me/notifications/unread", headers=_auth(buyer))).json()["unread"] == 0

    bad = await client.post("/me/notifications/read", json={"category": "spam"}, headers=_auth(buyer))
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_feed_pages_newest_first(client):
    buyer, _, _, instant_id, _ = await _setup(client)
    for _ in range(3):
        await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))
    page = await _feed(client, buyer, limit=2)
    assert len(page["items"]) == 2 and page["next_cursor"] == page["items"][-1]["id"]
    rest = await _feed(client, buyer, limit=2, before=page["next_cursor"])
    assert len(rest["items"]) == 1 and rest["next_cursor"] is None
    ids = [n["id"] for n in page["items"] + rest["items"]]
    assert ids == sorted(ids, reverse=True)


@pytest.mark.asyncio
async def test_chat_thread_keeps_one_unread_row_and_reading_the_chat_clears_it(client):
    buyer, seller, _, instant_id, _ = await _setup(client)
    order = (await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))).json()
    room = (await client.post(f"/chat/orders/{order['id']}", headers=_auth(buyer))).json()

    async def say(token, body):
        resp = await client.post(
            f"/chat/conversations/{room['id']}/messages",
            json={"body": body, "client_message_id": str(uuid.uuid4())}, headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text

    await say(buyer, "Shop ơi tài khoản dùng được bao lâu?")
    await say(seller, "Chào bạn, bảo hành 7 ngày.")
    await say(seller, "Có gì cứ nhắn nhé.")

    chats = await _feed(client, buyer, category="message")
    assert len(chats["items"]) == 1
    row = chats["items"][0]
    assert row["kind"] == "chat_message" and row["href"] == f"/messages/{room['id']}"
    assert row["params"]["from"] == "shop" and row["params"]["count"] == 2
    assert (await _feed(client, seller, category="message"))["items"][0]["params"] == {"from": "buyer", "count": 1}

    opened = await client.get(f"/chat/conversations/{room['id']}", headers=_auth(buyer))
    assert opened.status_code == 200
    assert (await _feed(client, buyer, category="message"))["by_category"]["message"] == 0
    await say(seller, "Bạn đã nhận được chưa?")
    after = await _feed(client, buyer, category="message")
    assert [n["read"] for n in after["items"]] == [False, True]


@pytest.mark.asyncio
async def test_dispute_outcome_is_told_once(client):
    buyer, seller, admin, instant_id, _ = await _setup(client)
    order = (await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))).json()
    opened = await client.post(f"/orders/{order['id']}/dispute", json={"reason": "Không đăng nhập được"}, headers=_auth(buyer))
    assert opened.status_code == 201, opened.text
    assert (await _feed(client, seller))["items"][0]["kind"] == "dispute_opened"

    refunded = await client.post(f"/admin/disputes/{opened.json()['id']}/refund", json={"admin_note": "hoàn"}, headers=_auth(admin))
    assert refunded.status_code == 200, refunded.text
    kinds = [n["kind"] for n in (await _feed(client, buyer))["items"]]
    assert kinds == ["dispute_resolved", "order_delivered"]
    resolved = (await _feed(client, buyer))["items"][0]
    assert resolved["params"] == {"order_code": order["order_code"], "outcome": "resolved_refund"}
    async with SessionLocal() as db:
        total = len((await db.scalars(select(Notification).where(Notification.kind == "order_refunded"))).all())
    assert total == 0
