from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.chat.enums import ConversationKind
from src.models.chat import ChatConversation, ChatMessage
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus

CHAT_RETENTION_DAYS = 30
SUPPORT_RETENTION_DAYS = 90
CHAT_RETENTION_BATCH_SIZE = 2_000


async def purge_expired_messages(
    db: AsyncSession,
    *,
    now: datetime | None = None,
    batch_size: int = CHAT_RETENTION_BATCH_SIZE,
) -> int:
    """Delete one bounded batch of cold chat rows while retaining list previews."""
    now = now or datetime.now(timezone.utc)
    chat_cutoff = now - timedelta(days=CHAT_RETENTION_DAYS)
    support_cutoff = now - timedelta(days=SUPPORT_RETENTION_DAYS)
    activity_at = func.coalesce(
        ChatConversation.last_message_at, ChatConversation.created_at
    )
    open_dispute = select(Dispute.id).where(
        Dispute.order_id == ChatConversation.order_id,
        Dispute.status == DisputeStatus.open,
    ).exists()
    latest_resolved_at = (
        select(func.max(Dispute.resolved_at))
        .where(
            Dispute.order_id == ChatConversation.order_id,
            Dispute.status != DisputeStatus.open,
            Dispute.resolved_at.is_not(None),
        )
        .correlate(ChatConversation)
        .scalar_subquery()
    )
    eligible_conversation = or_(
        (
            (ChatConversation.kind == ConversationKind.PRODUCT_INQUIRY)
            & (activity_at < chat_cutoff)
        ),
        (
            (ChatConversation.kind == ConversationKind.ORDER)
            & (activity_at < chat_cutoff)
            & Order.status.in_(
                [OrderStatus.completed, OrderStatus.cancelled, OrderStatus.refunded]
            )
            & ~open_dispute
        ),
        (
            (ChatConversation.kind == ConversationKind.SUPPORT)
            & ~open_dispute
            & latest_resolved_at.is_not(None)
            & (latest_resolved_at < support_cutoff)
        ),
    )
    ids = (
        select(ChatMessage.id)
        .join(
            ChatConversation,
            ChatConversation.id == ChatMessage.conversation_id,
        )
        .outerjoin(Order, Order.id == ChatConversation.order_id)
        .where(
            eligible_conversation,
            ChatMessage.created_at < chat_cutoff,
            ChatMessage.id != func.coalesce(ChatConversation.last_message_id, 0),
        )
        .order_by(ChatMessage.id)
        .limit(batch_size)
        .with_for_update(skip_locked=True, of=ChatMessage)
    )
    result = await db.execute(
        delete(ChatMessage)
        .where(ChatMessage.id.in_(ids))
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return int(result.rowcount or 0)
