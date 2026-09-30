"""Saved replies ("canned replies") for desk composers.

Scoped by owner: ``owner_type='admin'`` with ``owner_id=None`` is the shared
desk set used today; ``owner_type='seller'`` + the seller's account id is
reserved for shop inboxes, so the same table and functions serve them once a
seller surface exists. Placeholders ({ten} {ma_don} {shop}) are rendered by
the client; the server stores the text as typed.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.chat.schemas import CannedReplyInput
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.logging import current_request_id
from src.models.chat import CannedReply

MAX_PER_OWNER = 500


@dataclass(frozen=True)
class Owner:
    type: str = "admin"
    id: int | None = None


ADMIN_DESK = Owner()


def _owned(owner: Owner):
    clause = [CannedReply.owner_type == owner.type]
    clause.append(CannedReply.owner_id.is_(None) if owner.id is None else CannedReply.owner_id == owner.id)
    return clause


async def list_replies(db: AsyncSession, owner: Owner = ADMIN_DESK) -> list[CannedReply]:
    return list((await db.execute(
        select(CannedReply).where(*_owned(owner)).order_by(CannedReply.shortcut)
    )).scalars())


async def _get(db: AsyncSession, reply_id: int, owner: Owner) -> CannedReply:
    reply = await db.scalar(select(CannedReply).where(CannedReply.id == reply_id, *_owned(owner)))
    if reply is None:
        raise api_error(ErrorCode.CANNED_REPLY_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return reply


async def _audit(db, event: str, reply: CannedReply, actor_id: int, **extra) -> None:
    await log_event(
        db, "info", f"Canned reply /{reply.shortcut} {event.rsplit('_', 1)[-1]}", request_id=current_request_id(),
        metadata={
            "event": event, "actor_id": actor_id, "actor_type": "admin", "subject_type": "canned_reply",
            "subject_id": reply.id, "outcome": "success", "shortcut": reply.shortcut, **extra,
        },
    )


async def _flush_unique(db: AsyncSession) -> None:
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise api_error(ErrorCode.CANNED_REPLY_SHORTCUT_TAKEN, status.HTTP_409_CONFLICT) from None


async def create_reply(db: AsyncSession, data: CannedReplyInput, *, actor_id: int, owner: Owner = ADMIN_DESK) -> CannedReply:
    count = int(await db.scalar(select(func.count(CannedReply.id)).where(*_owned(owner))) or 0)
    if count >= MAX_PER_OWNER:
        raise api_error(ErrorCode.CANNED_REPLY_SHORTCUT_TAKEN, status.HTTP_409_CONFLICT)
    reply = CannedReply(
        owner_type=owner.type, owner_id=owner.id, shortcut=data.shortcut, title=data.title, body=data.body,
        created_by_id=actor_id,
    )
    db.add(reply)
    await _flush_unique(db)
    await _audit(db, "canned_reply_created", reply, actor_id)
    await db.commit()
    await db.refresh(reply)
    return reply


async def update_reply(
    db: AsyncSession, reply_id: int, patch: dict, *, actor_id: int, owner: Owner = ADMIN_DESK,
) -> CannedReply:
    reply = await _get(db, reply_id, owner)
    merged = CannedReplyInput.model_validate({
        "shortcut": reply.shortcut, "title": reply.title, "body": reply.body,
        **{k: v for k, v in patch.items() if v is not None},
    })
    changed = [f for f in ("shortcut", "title", "body") if getattr(reply, f) != getattr(merged, f)]
    for field in changed:
        setattr(reply, field, getattr(merged, field))
    if changed:
        await _flush_unique(db)
        await _audit(db, "canned_reply_updated", reply, actor_id, fields=changed)
        await db.commit()
        await db.refresh(reply)
    return reply


async def delete_reply(db: AsyncSession, reply_id: int, *, actor_id: int, owner: Owner = ADMIN_DESK) -> None:
    reply = await _get(db, reply_id, owner)
    await _audit(db, "canned_reply_deleted", reply, actor_id)
    await db.delete(reply)
    await db.commit()
