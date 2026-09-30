"""Admin support desk: the ticket inbox over Marketplace threads.

A desk ticket is a support/helpdesk `chat_conversations` row plus the ticket
columns (assignee, resolved/first-response stamps, blocked reason) and its
`conversation_tags`. Status moves go through `chat.tickets`; messages still
go through `chat.service.send_message`. Internal notes reuse `audit.notes`
(subject ``conversation``). Every mutation writes an audit row with
``subject_type=conversation`` so `audit.history` can read a ticket's trail.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import and_, delete, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit import notes as admin_notes
from src.audit.service import log_event
from src.chat import tickets
from src.chat.enums import ContextRole, ConversationKind, ConversationStatus
from src.chat.schemas import AdminTicket, ConversationSummary
from src.chat.service import DESK_KINDS, DeskRow, desk_shop_name_subquery, desk_summaries, send_message
from src.common.pagination import decode_cursor, encode_cursor, keyset_after
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.logging import current_request_id
from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.chat import ChatConversation, ChatMessage, ConversationTag
from src.models.order import Order, OrderStatus
from src.models.product import Product

MAX_LIMIT = 50
PREVIEW_CHARS = 140
MAX_BODY_SEARCH_DAYS = 365


def _waiting_clause():
    """Open and the newest message is the requester's."""
    return and_(
        ChatConversation.status == ConversationStatus.OPEN,
        ChatConversation.last_requester_message_at.is_not(None),
        ChatConversation.last_requester_message_at >= ChatConversation.last_message_at,
    )


def _view_clause(view: str, admin_id: int):
    if view == "waiting":
        return _waiting_clause()
    if view == "mine":
        return and_(ChatConversation.assignee_id == admin_id, ChatConversation.status == ConversationStatus.OPEN)
    if view == "open":
        return ChatConversation.status == ConversationStatus.OPEN
    if view == "resolved":
        return ChatConversation.status == ConversationStatus.RESOLVED
    return None


def _filters(*, q: str | None, role: str | None, kind: str | None, tag: str | None) -> list:
    """Filters shared by the list and its tab counts (not view/assignee)."""
    out: list = []
    if kind in (ConversationKind.SUPPORT, ConversationKind.HELPDESK):
        out.append(ChatConversation.kind == kind)
    if role in (ContextRole.BUYER, ContextRole.SELLER):
        out.append(ChatConversation.requester_role == role)
    if tag:
        out.append(exists().where(
            ConversationTag.conversation_id == ChatConversation.id, ConversationTag.tag == tag.strip().lower(),
        ))
    needle = (q or "").strip()
    if needle:
        like = f"%{needle}%"
        requester_email = select(Account.email).where(Account.id == ChatConversation.requester_id).correlate(
            ChatConversation).scalar_subquery()
        order_code = select(Order.order_code).where(Order.id == ChatConversation.order_id).correlate(
            ChatConversation).scalar_subquery()
        since = datetime.now(timezone.utc) - timedelta(days=MAX_BODY_SEARCH_DAYS)
        out.append(or_(
            requester_email.ilike(like),
            ChatConversation.subject.ilike(like),
            order_code.ilike(like),
            desk_shop_name_subquery().ilike(like),
            exists().where(
                ChatMessage.conversation_id == ChatConversation.id,
                ChatMessage.created_at >= since,
                ChatMessage.body.ilike(like),
            ),
        ))
    return out


def _assignee_clause(assignee: str | None, admin_id: int):
    if assignee in (None, ""):
        return None
    if assignee == "me":
        return ChatConversation.assignee_id == admin_id
    if assignee == "none":
        return ChatConversation.assignee_id.is_(None)
    try:
        return ChatConversation.assignee_id == int(assignee)
    except ValueError:
        return None


async def _count(db: AsyncSession, clauses: list) -> int:
    return int(await db.scalar(
        select(func.count(ChatConversation.id)).where(ChatConversation.kind.in_(DESK_KINDS), *clauses)
    ) or 0)


async def _tickets_from_rows(db: AsyncSession, rows: list[DeskRow]) -> list[dict]:
    ids = [row.room.id for row in rows]
    tags: dict[uuid.UUID, list[str]] = {i: [] for i in ids}
    if ids:
        for conv_id, tag in (await db.execute(
            select(ConversationTag.conversation_id, ConversationTag.tag)
            .where(ConversationTag.conversation_id.in_(ids))
            .order_by(ConversationTag.tag)
        )).all():
            tags[conv_id].append(tag)
    assignee_ids = {row.room.assignee_id for row in rows if row.room.assignee_id}
    emails = dict((await db.execute(
        select(Account.id, Account.email).where(Account.id.in_(assignee_ids))
    )).all()) if assignee_ids else {}
    out = []
    for row in rows:
        room = row.room
        waiting = (
            room.status == ConversationStatus.OPEN
            and room.last_requester_message_at is not None
            and room.last_message_at is not None
            and room.last_requester_message_at >= room.last_message_at
        )
        message = row.last_message
        preview = None
        if message is not None:
            preview = (message.body or "").strip()[:PREVIEW_CHARS] or ("[ảnh]" if message.attachments else None)
        summary: ConversationSummary = row.summary
        out.append({
            **summary.model_dump(),
            "subject": room.subject,
            "assignee": {"id": room.assignee_id, "email": emails.get(room.assignee_id, "")} if room.assignee_id else None,
            "tags": tags.get(room.id, []),
            "requester": {
                "id": room.requester_id or 0, "email": row.requester_email or "",
                "role": room.requester_role or ContextRole.BUYER,
            },
            "order_code": summary.order.code if summary.order else None,
            "waiting_since": room.last_requester_message_at if waiting else None,
            "first_response_at": room.first_response_at,
            "resolved_at": room.resolved_at,
            "blocked_reason": room.blocked_reason,
            "last_message_at": room.last_message_at,
            "last_message_preview": preview,
        })
    return out


async def list_tickets(
    admin: Account, db: AsyncSession, *, view: str = "all", q: str | None = None, role: str | None = None,
    kind: str | None = None, assignee: str | None = None, tag: str | None = None, cursor: str | None = None,
    limit: int = 30,
) -> dict:
    limit = max(1, min(limit, MAX_LIMIT))
    shared = _filters(q=q, role=role, kind=kind, tag=tag)
    clauses = list(shared)
    for extra in (_view_clause(view, admin.id), _assignee_clause(assignee, admin.id)):
        if extra is not None:
            clauses.append(extra)

    waiting_sort = view == "waiting"
    sort_col = ChatConversation.last_requester_message_at if waiting_sort else ChatConversation.last_message_at
    decoded = decode_cursor(cursor)
    if decoded is not None:
        try:
            decoded = (decoded[0], uuid.UUID(decoded[1]))
        except ValueError:
            decoded = None
    after = keyset_after(sort_col, ChatConversation.id, decoded, descending=not waiting_sort)
    if after is not None:
        clauses.append(after)
    order_by = (
        [sort_col.asc().nulls_last(), ChatConversation.id.asc()]
        if waiting_sort else [sort_col.desc().nulls_last(), ChatConversation.id.desc()]
    )
    rows = await desk_summaries(admin, db, filters=clauses, order_by=order_by, limit=limit + 1)
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if has_more and rows:
        last = rows[-1].room
        next_cursor = encode_cursor(
            last.last_requester_message_at if waiting_sort else last.last_message_at, last.id,
        )
    counts = {
        name: await _count(db, [*shared, _view_clause(name, admin.id)])
        for name in ("waiting", "mine", "open", "resolved")
    }
    return {"items": await _tickets_from_rows(db, rows), "next_cursor": next_cursor, "counts": counts}


async def _desk_conversation(db: AsyncSession, conversation_id: uuid.UUID, *, lock: bool = False) -> ChatConversation:
    stmt = select(ChatConversation).where(ChatConversation.id == conversation_id)
    if lock:
        stmt = stmt.with_for_update()
    room = await db.scalar(stmt)
    if room is None or room.kind not in DESK_KINDS:
        raise api_error(ErrorCode.CHAT_CONVERSATION_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return room


async def get_ticket(admin: Account, db: AsyncSession, conversation_id: uuid.UUID) -> dict:
    rows = await desk_summaries(admin, db, filters=[ChatConversation.id == conversation_id], limit=1)
    if not rows:
        raise api_error(ErrorCode.CHAT_CONVERSATION_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return AdminTicket.model_validate((await _tickets_from_rows(db, rows))[0]).model_dump()


async def support_stats(db: AsyncSession) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=7)
    avg_seconds = await db.scalar(
        select(func.avg(func.extract("epoch", ChatConversation.first_response_at - ChatConversation.created_at)))
        .where(
            ChatConversation.kind.in_(DESK_KINDS),
            ChatConversation.first_response_at.is_not(None),
            ChatConversation.first_response_at >= since,
        )
    )
    waiting, oldest = (await db.execute(
        select(func.count(ChatConversation.id), func.min(ChatConversation.last_requester_message_at))
        .where(ChatConversation.kind.in_(DESK_KINDS), _waiting_clause())
    )).one()
    return {
        "avg_first_response_minutes_7d": round(float(avg_seconds) / 60, 1) if avg_seconds is not None else None,
        "waiting": int(waiting or 0),
        "oldest_waiting_at": oldest,
    }


async def _tags_of(db: AsyncSession, conversation_id: uuid.UUID) -> list[str]:
    return list((await db.execute(
        select(ConversationTag.tag).where(ConversationTag.conversation_id == conversation_id).order_by(ConversationTag.tag)
    )).scalars())


async def ticket_context(db: AsyncSession, conversation_id: uuid.UUID) -> dict:
    room = await _desk_conversation(db, conversation_id)
    requester = await db.get(Account, room.requester_id) if room.requester_id else None
    if requester is None:
        raise api_error(ErrorCode.CHAT_CONVERSATION_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    bought, spent = (await db.execute(
        select(func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
        .where(Order.buyer_id == requester.id, Order.status != OrderStatus.cancelled, Order.is_seeded.is_(False))
    )).one()
    order_ctx = None
    if room.order_id:
        order = await db.get(Order, room.order_id)
        if order is not None:
            product_title = await db.scalar(select(Product.title).where(Product.id == order.product_id))
            shop = await db.scalar(
                select(SellerApplication.business_name)
                .where(SellerApplication.account_id == order.seller_id, SellerApplication.status == ApplicationStatus.approved)
                .order_by(SellerApplication.id.desc()).limit(1)
            )
            order_ctx = {
                "id": order.id, "order_code": order.order_code, "total": order.total_amount,
                "status": order.status.value if hasattr(order.status, "value") else str(order.status),
                "product_title": product_title, "shop_name": shop,
            }
    previous = (await db.execute(
        select(ChatConversation.id, ChatConversation.subject, ChatConversation.status, ChatConversation.created_at)
        .where(
            ChatConversation.kind.in_(DESK_KINDS), ChatConversation.requester_id == requester.id,
            ChatConversation.id != room.id,
        )
        .order_by(ChatConversation.created_at.desc())
        .limit(10)
    )).all()
    assignee = await db.get(Account, room.assignee_id) if room.assignee_id else None
    return {
        "requester": {
            "id": requester.id, "email": requester.email, "role": room.requester_role or ContextRole.BUYER,
            "created_at": requester.created_at, "orders_bought": int(bought or 0), "spent": int(spent or 0),
            "email_verified": bool(requester.email_verified),
        },
        "order": order_ctx,
        "previous_tickets": [
            {"id": i, "subject": subj, "status": st, "created_at": created} for i, subj, st, created in previous
        ],
        "tags": await _tags_of(db, room.id),
        "assignee": {"id": assignee.id, "email": assignee.email} if assignee else None,
        "status": room.status,
        "blocked_reason": room.blocked_reason,
    }


async def _audit(db: AsyncSession, event: str, room: ChatConversation, actor_id: int, message: str, **extra) -> None:
    await log_event(
        db, "info", message, request_id=current_request_id(),
        metadata={
            "event": event, "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "conversation", "subject_id": str(room.id), "outcome": "success", **extra,
        },
    )


async def set_status(
    admin: Account, db: AsyncSession, conversation_id: uuid.UUID, *, target: str, reason: str | None,
    notify_requester: bool,
) -> dict:
    room = await _desk_conversation(db, conversation_id, lock=True)
    if not tickets.can_transition(str(room.status), target):
        raise api_error(
            ErrorCode.TICKET_INVALID_TRANSITION, status.HTTP_409_CONFLICT, current=str(room.status), target=target,
        )
    if target == tickets.RESOLVED and notify_requester:
        # Posted while the ticket is still open, through the normal send path
        # (it commits and publishes the message itself).
        await send_message(admin, room.id, tickets.RESOLVED_NOTICE, uuid.uuid4(), db)
        room = await _desk_conversation(db, conversation_id, lock=True)
    await tickets.transition(db, room, target, actor_id=admin.id, reason=reason)
    await db.commit()
    await tickets.publish_ticket_change(db, room)
    return await get_ticket(admin, db, room.id)


async def assign(admin: Account, db: AsyncSession, conversation_id: uuid.UUID, assignee_id: int | None) -> dict:
    room = await _desk_conversation(db, conversation_id, lock=True)
    if assignee_id is not None:
        target = await db.get(Account, assignee_id)
        if target is None or not target.is_active or "admin" not in (target.roles or []):
            raise api_error(ErrorCode.TICKET_ASSIGNEE_INVALID, status.HTTP_422_UNPROCESSABLE_CONTENT)
    if room.assignee_id != assignee_id:
        previous = room.assignee_id
        room.assignee_id = assignee_id
        await _audit(db, "ticket_assigned", room, admin.id, f"Desk ticket {room.id} assigned",
                     old=previous, new=assignee_id)
        await db.commit()
        await tickets.publish_ticket_change(db, room)
    return await get_ticket(admin, db, room.id)


async def set_tags(admin: Account, db: AsyncSession, conversation_id: uuid.UUID, tags: list[str]) -> dict:
    room = await _desk_conversation(db, conversation_id, lock=True)
    old = await _tags_of(db, room.id)
    new = sorted(set(tags))
    if old != new:
        await db.execute(delete(ConversationTag).where(ConversationTag.conversation_id == room.id))
        db.add_all([ConversationTag(conversation_id=room.id, tag=t) for t in new])
        await _audit(db, "ticket_tags_changed", room, admin.id, f"Desk ticket {room.id} tags changed", old=old, new=new)
        await db.commit()
        await tickets.publish_ticket_change(db, room)
    return await get_ticket(admin, db, room.id)


async def tag_counts(db: AsyncSession, *, limit: int = 200) -> list[dict]:
    rows = (await db.execute(
        select(ConversationTag.tag, func.count().label("n"))
        .group_by(ConversationTag.tag)
        .order_by(func.count().desc(), ConversationTag.tag)
        .limit(limit)
    )).all()
    return [{"tag": tag, "count": int(n)} for tag, n in rows]


async def list_ticket_notes(db: AsyncSession, conversation_id: uuid.UUID) -> list[dict]:
    room = await _desk_conversation(db, conversation_id)
    return await admin_notes.list_notes(db, "conversation", str(room.id))


async def add_ticket_note(admin: Account, db: AsyncSession, conversation_id: uuid.UUID, body: str) -> dict:
    room = await _desk_conversation(db, conversation_id)
    return await admin_notes.add_note(db, "conversation", str(room.id), body, author_id=admin.id)
