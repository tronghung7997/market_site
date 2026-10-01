"""Public presence signals on a shop: reply-speed band and last-active band."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from src.database import SessionLocal
from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.auth_session import AuthSession
from src.models.chat import ChatConversation, ChatMessage, ChatParticipant
from src.sellers.activity import active_band, response_band

NOW = datetime(2026, 9, 27, 12, 0, tzinfo=timezone.utc)


def test_response_band_uses_the_median_and_needs_a_sample():
    ask = NOW - timedelta(days=2)
    fast = [(ask, ask + timedelta(minutes=m)) for m in (5, 10, 40)]
    assert response_band(fast, NOW) == {"within": "15m", "rate": 100, "sample": 3}
    assert response_band(fast[:2], NOW) is None
    slowish = fast + [(ask, ask + timedelta(hours=5)), (ask, ask + timedelta(hours=7))]
    assert response_band(slowish, NOW)["within"] == "1h"
    # Unanswered chats count only once they are a day old.
    fresh_unanswered = fast + [(NOW - timedelta(hours=2), None)]
    assert response_band(fresh_unanswered, NOW)["sample"] == 3
    old_unanswered = fast + [(NOW - timedelta(days=3), None)]
    assert response_band(old_unanswered, NOW) == {"within": "15m", "rate": 75, "sample": 4}
    never = [(NOW - timedelta(days=3), None)] * 3
    assert response_band(never, NOW) == {"within": "slow", "rate": 0, "sample": 3}


def test_active_band_is_coarse():
    assert active_band(None, NOW) is None
    assert active_band(NOW - timedelta(minutes=3), NOW) == "15m"
    assert active_band(NOW - timedelta(minutes=50), NOW) == "1h"
    assert active_band(NOW - timedelta(hours=20), NOW) == "24h"
    assert active_band(NOW - timedelta(days=6), NOW) == "7d"
    assert active_band(NOW - timedelta(days=29), NOW) == "30d"
    assert active_band(NOW - timedelta(days=40), NOW) is None


async def _chat(db, buyer, seller, asked_at, replied_after):
    # An order chat (order row not needed for the reply-speed query).
    room = ChatConversation(
        kind="order", status="open", buyer_id=buyer.id, seller_id=seller.id,
        created_by_id=buyer.id, last_message_at=asked_at,
    )
    db.add(room)
    await db.flush()
    db.add_all([
        ChatParticipant(conversation_id=room.id, account_id=buyer.id, context_role="buyer"),
        ChatParticipant(conversation_id=room.id, account_id=seller.id, context_role="seller"),
        ChatMessage(conversation_id=room.id, sender_id=buyer.id, sender_role="buyer",
                    client_message_id=uuid.uuid4(), body="Còn hàng không?", created_at=asked_at),
    ])
    if replied_after is not None:
        db.add(ChatMessage(conversation_id=room.id, sender_id=seller.id, sender_role="seller",
                           client_message_id=uuid.uuid4(), body="Còn ạ", created_at=asked_at + replied_after))
        room.last_message_at = asked_at + replied_after


@pytest.mark.asyncio
async def test_shop_profile_shows_reply_speed_and_activity(client):
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        seller = Account(email="presence-seller@example.test", password_hash="x", roles=["buyer", "seller"])
        buyer = Account(email="presence-buyer@example.test", password_hash="x", roles=["buyer"])
        db.add_all([seller, buyer])
        await db.flush()
        db.add(SellerApplication(account_id=seller.id, business_name="Kho Nhanh", status=ApplicationStatus.approved))
        for minutes in (4, 8, 12):
            await _chat(db, buyer, seller, now - timedelta(days=1), timedelta(minutes=minutes))
        db.add(AuthSession(
            account_id=seller.id, family_id=uuid.uuid4(), refresh_token_hash=uuid.uuid4().hex,
            access_jti=str(uuid.uuid4()), expires_at=now + timedelta(days=7), last_used_at=now - timedelta(minutes=30),
        ))
        await db.commit()
        key = seller.public_key

    profile = await client.get(f"/sellers/{key}")
    assert profile.status_code == 200, profile.text
    body = profile.json()
    assert body["response_time"] == {"within": "15m", "rate": 100, "sample": 3}
    assert body["active_within"] == "1h"
    # Bands only: no timestamps or counts of sessions leak.
    assert "last_used_at" not in profile.text and "last_seen" not in profile.text


@pytest.mark.asyncio
async def test_new_shop_shows_no_presence_bands(client):
    async with SessionLocal() as db:
        seller = Account(email="presence-new@example.test", password_hash="x", roles=["buyer", "seller"])
        db.add(seller)
        await db.flush()
        db.add(SellerApplication(account_id=seller.id, business_name="Kho Mới", status=ApplicationStatus.approved))
        await db.commit()
        key = seller.public_key
    body = (await client.get(f"/sellers/{key}")).json()
    assert body["response_time"] is None and body["active_within"] is None


@pytest.mark.asyncio
async def test_presences_for_many_shops_take_two_queries_not_two_per_shop():
    from sqlalchemy import event

    from src.database import engine
    from src.sellers.service import _presence_cache, seller_presences

    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        buyer = Account(email="batch-buyer@example.test", password_hash="x", roles=["buyer"])
        sellers = [
            Account(email=f"batch-seller-{i}@example.test", password_hash="x", roles=["buyer", "seller"])
            for i in range(4)
        ]
        db.add_all([buyer, *sellers])
        await db.flush()
        fast, idle = sellers[0], sellers[1]
        for minutes in (4, 8, 12):
            await _chat(db, buyer, fast, now - timedelta(days=1), timedelta(minutes=minutes))
        db.add(AuthSession(
            account_id=fast.id, family_id=uuid.uuid4(), refresh_token_hash=uuid.uuid4().hex,
            access_jti=str(uuid.uuid4()), expires_at=now + timedelta(days=7), last_used_at=now - timedelta(minutes=30),
        ))
        await db.commit()
        ids = [s.id for s in sellers]

    _presence_cache.invalidate()
    statements: list[str] = []

    def count(conn, cursor, statement, *args):
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        async with SessionLocal() as db:
            presences = await seller_presences(ids, db)
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count)

    assert len(statements) == 2
    assert presences[fast.id] == {"response_time": {"within": "15m", "rate": 100, "sample": 3}, "active_within": "1h"}
    assert presences[idle.id] == {"response_time": None, "active_within": None}
    assert set(presences) == set(ids)

    # Second call is served from the per-process cache.
    statements.clear()
    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        async with SessionLocal() as db:
            assert await seller_presences(ids, db) == presences
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count)
    assert statements == []
