import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from src.chat.retention import purge_expired_messages
from src.chat.service import get_conversation
from src.database import SessionLocal
from src.models.account import Account
from src.models.chat import ChatConversation, ChatMessage, ChatParticipant
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus


async def _account(db, email: str, roles: list[str]) -> Account:
    row = Account(email=email, password_hash="test-only", roles=roles)
    db.add(row)
    await db.flush()
    return row


@pytest.mark.asyncio
async def test_conversation_detail_returns_latest_50_with_older_cursor():
    async with SessionLocal() as db:
        buyer = await _account(db, "cursor-buyer@example.test", ["buyer"])
        seller = await _account(db, "cursor-seller@example.test", ["buyer", "seller"])
        room = ChatConversation(
            kind="order", status="open", buyer_id=buyer.id, seller_id=seller.id,
            created_by_id=buyer.id,
        )
        db.add(room)
        await db.flush()
        db.add_all([
            ChatParticipant(conversation_id=room.id, account_id=buyer.id, context_role="buyer"),
            ChatParticipant(conversation_id=room.id, account_id=seller.id, context_role="seller"),
        ])
        messages = [
            ChatMessage(
                conversation_id=room.id, sender_id=buyer.id, sender_role="buyer",
                client_message_id=uuid.uuid4(), body=f"message-{index}",
            )
            for index in range(55)
        ]
        db.add_all(messages)
        await db.flush()
        room.last_message_id = messages[-1].id
        room.last_message_at = messages[-1].created_at
        await db.commit()

        latest = await get_conversation(buyer, room.id, db)
        assert [message.body for message in latest.messages] == [
            f"message-{index}" for index in range(5, 55)
        ]
        assert latest.next_cursor == messages[5].id
        older = await get_conversation(buyer, room.id, db, before_id=latest.next_cursor)
        assert [message.body for message in older.messages] == [
            f"message-{index}" for index in range(5)
        ]
        assert older.next_cursor is None


@pytest.mark.asyncio
async def test_retention_keeps_active_chat_and_terminal_chat_preview():
    old = datetime.now(timezone.utc) - timedelta(days=31)
    async with SessionLocal() as db:
        buyer = await _account(db, "retention-buyer@example.test", ["buyer"])
        seller = await _account(db, "retention-seller@example.test", ["buyer", "seller"])
        completed = Order(
            buyer_id=buyer.id, seller_id=seller.id, quantity=1, total_amount=100,
            status=OrderStatus.completed,
        )
        active = Order(
            buyer_id=buyer.id, seller_id=seller.id, quantity=1, total_amount=100,
            status=OrderStatus.delivered,
        )
        db.add_all([completed, active])
        await db.flush()
        rooms = [
            ChatConversation(
                kind="order", status="open", order_id=order.id, buyer_id=buyer.id,
                seller_id=seller.id, created_by_id=buyer.id, last_message_at=old,
                created_at=old,
            )
            for order in (completed, active)
        ]
        db.add_all(rooms)
        await db.flush()
        messages = []
        for room in rooms:
            pair = [
                ChatMessage(
                    conversation_id=room.id, sender_id=buyer.id, sender_role="buyer",
                    client_message_id=uuid.uuid4(), body=f"old-{index}", created_at=old,
                )
                for index in range(2)
            ]
            db.add_all(pair)
            await db.flush()
            room.last_message_id = pair[-1].id
            messages.append(pair)
        await db.commit()

        assert await purge_expired_messages(db) == 1
        completed_count = await db.scalar(select(func.count(ChatMessage.id)).where(
            ChatMessage.conversation_id == rooms[0].id
        ))
        active_count = await db.scalar(select(func.count(ChatMessage.id)).where(
            ChatMessage.conversation_id == rooms[1].id
        ))
        assert completed_count == 1
        assert active_count == 2


@pytest.mark.asyncio
async def test_support_retention_uses_latest_resolved_dispute():
    now = datetime.now(timezone.utc)
    old = now - timedelta(days=120)
    recent = now - timedelta(days=10)
    async with SessionLocal() as db:
        buyer = await _account(db, "support-buyer@example.test", ["buyer"])
        seller = await _account(db, "support-seller@example.test", ["buyer", "seller"])
        order = Order(
            buyer_id=buyer.id, seller_id=seller.id, quantity=1, total_amount=100,
            status=OrderStatus.completed,
        )
        db.add(order)
        await db.flush()
        room = ChatConversation(
            kind="support", status="open", order_id=order.id, buyer_id=buyer.id,
            seller_id=seller.id, requester_id=buyer.id, requester_role="buyer",
            created_by_id=buyer.id, last_message_at=old, created_at=old,
        )
        db.add(room)
        await db.flush()
        db.add_all([
            Dispute(
                order_id=order.id, buyer_id=buyer.id, reason="old case",
                status=DisputeStatus.resolved_reject, resolved_at=old,
            ),
            Dispute(
                order_id=order.id, buyer_id=buyer.id, reason="recent case",
                status=DisputeStatus.resolved_refund, resolved_at=recent,
            ),
        ])
        pair = [
            ChatMessage(
                conversation_id=room.id, sender_id=buyer.id, sender_role="buyer",
                client_message_id=uuid.uuid4(), body=f"old-{index}", created_at=old,
            )
            for index in range(2)
        ]
        db.add_all(pair)
        await db.flush()
        room.last_message_id = pair[-1].id
        await db.commit()

        assert await purge_expired_messages(db) == 0
        remaining = await db.scalar(select(func.count(ChatMessage.id)).where(
            ChatMessage.conversation_id == room.id
        ))
        assert remaining == 2
