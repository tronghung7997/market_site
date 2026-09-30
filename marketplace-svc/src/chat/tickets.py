"""Desk ticket lifecycle for Marketplace threads (kinds support + helpdesk).

The status of a desk thread moves only along ``TRANSITIONS``; `transition`
validates the move, stamps the ticket fields, writes the audit row and leaves
the commit to the caller, who then calls `publish_ticket_change` so open
inboxes refresh. The send path (`chat.service.send_message`) calls
`on_desk_message` for every desk message:

* the first admin reply stamps ``first_response_at``;
* a requester message stamps ``last_requester_message_at`` (what "waiting"
  and the waiting timer read) and reopens a ``resolved`` ticket;
* ``blocked`` refuses the requester (403 ``CHAT_BLOCKED``) but not admins;
* ``closed`` is read-only for everyone until an admin reopens it.

Buyer↔seller threads (inquiry/order) do not use this module.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.chat.enums import ConversationKind, ConversationStatus
from src.chat.events import publish
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.logging import current_request_id
from src.models.account import Account
from src.models.chat import ChatConversation, ChatMessage, ChatParticipant

OPEN, RESOLVED, CLOSED, BLOCKED = (
    ConversationStatus.OPEN.value, ConversationStatus.RESOLVED.value,
    ConversationStatus.CLOSED.value, ConversationStatus.BLOCKED.value,
)

# from → allowed targets. Adding a state means adding a row here (and to the
# chat_conversations status check constraint), nothing else.
TRANSITIONS: dict[str, frozenset[str]] = {
    OPEN: frozenset({RESOLVED, CLOSED, BLOCKED}),
    RESOLVED: frozenset({OPEN, CLOSED}),
    CLOSED: frozenset({OPEN}),
    BLOCKED: frozenset({OPEN}),
}
DESK_KINDS = (ConversationKind.SUPPORT.value, ConversationKind.HELPDESK.value)
BLOCK_REASON_MIN, BLOCK_REASON_MAX = 3, 300
RESOLVED_NOTICE = (
    "Đã xử lý yêu cầu của bạn. Nếu bạn cần hỗ trợ thêm, chỉ cần trả lời tin nhắn này — "
    "cuộc trò chuyện sẽ tự mở lại."
)


def can_transition(current: str, target: str) -> bool:
    return target in TRANSITIONS.get(str(current), frozenset())


async def transition(
    db: AsyncSession,
    conversation: ChatConversation,
    target: str,
    *,
    actor_id: int,
    actor_type: str = "admin",
    reason: str | None = None,
    auto: bool = False,
) -> None:
    """Move a desk ticket to ``target``. Raises 409 ``TICKET_INVALID_TRANSITION``
    for a move outside ``TRANSITIONS`` (including a no-op). Never commits."""
    if conversation.kind not in DESK_KINDS:
        raise api_error(ErrorCode.CHAT_CONVERSATION_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    current = str(conversation.status)
    if not can_transition(current, target):
        raise api_error(
            ErrorCode.TICKET_INVALID_TRANSITION, status.HTTP_409_CONFLICT, current=current, target=target,
        )
    now = datetime.now(timezone.utc)
    if target == BLOCKED:
        reason = (reason or "").strip()
        if not (BLOCK_REASON_MIN <= len(reason) <= BLOCK_REASON_MAX):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={"code": "validation", "fields": {"reason": "Nhập lý do chặn (3–300 ký tự)"}},
            )
        conversation.blocked_reason = reason
    else:
        conversation.blocked_reason = None
    if target == RESOLVED:
        conversation.resolved_at = now
        conversation.resolved_by_id = actor_id
    elif target == OPEN:
        conversation.resolved_at = None
        conversation.resolved_by_id = None
    conversation.status = target
    await log_event(
        db, "info", f"Desk ticket {conversation.id} {current} → {target}", request_id=current_request_id(),
        metadata={
            "event": "ticket_status_changed", "actor_id": actor_id, "actor_type": actor_type,
            "subject_type": "conversation", "subject_id": str(conversation.id), "outcome": "success",
            "from": current, "to": target, "reason": reason or None, "auto": auto,
        },
    )


async def on_desk_message(
    db: AsyncSession, conversation: ChatConversation, message: ChatMessage, *, sender_id: int, admin: bool,
) -> bool:
    """Ticket bookkeeping for a message just flushed. Returns True when the
    message reopened a resolved ticket (the caller publishes after commit)."""
    if admin:
        if conversation.first_response_at is None:
            conversation.first_response_at = message.created_at
        return False
    if sender_id != conversation.requester_id:
        return False
    conversation.last_requester_message_at = message.created_at
    if str(conversation.status) == RESOLVED:
        await transition(db, conversation, OPEN, actor_id=sender_id, actor_type="account", auto=True)
        return True
    return False


async def _admin_ids(db: AsyncSession) -> list[int]:
    return list((await db.execute(
        select(Account.id).where(Account.is_active.is_(True), Account.roles.any("admin"))
    )).scalars())


async def publish_ticket_change(db: AsyncSession, conversation: ChatConversation) -> None:
    """Tell open inboxes (requester, participants, every admin) to refresh."""
    recipients = set(await _admin_ids(db))
    recipients.update((await db.execute(
        select(ChatParticipant.account_id).where(ChatParticipant.conversation_id == conversation.id)
    )).scalars())
    if conversation.requester_id:
        recipients.add(conversation.requester_id)
    await publish(recipients, {"type": "conversation.updated", "conversation_id": str(conversation.id)})
