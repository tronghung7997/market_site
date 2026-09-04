import uuid

from fastapi import status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.exceptions import ErrorCode, api_error

from src.chat.enums import ContextRole, ConversationKind, ConversationStatus
from src.chat.events import publish
from src.chat.schemas import (
    ChatDisputeContext,
    ChatMessageResponse,
    ChatOrderContext,
    ChatProduct,
    ConversationDetail,
    ConversationList,
    ConversationSummary,
    SafeCounterpart,
)
from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.chat import ChatConversation, ChatMessage, ChatParticipant
from src.models.order import (
    Dispute,
    DisputeClaimResource,
    DisputeResourceAction,
    DisputeStatus,
    Order,
)
from src.models.product import Product, ProductStatus
from src.products.covers import parse_cover_id

MARKETPLACE_LABEL = "Marketplace"
MARKETPLACE_COUNTERPART_ID = 0


def _has_role(account: Account, role: str) -> bool:
    return role in (account.roles or [])


async def _participant(
    db: AsyncSession, conversation_id: uuid.UUID, account_id: int
) -> ChatParticipant:
    row = await db.get(ChatParticipant, (conversation_id, account_id))
    if row is None:
        raise api_error(ErrorCode.CHAT_CONVERSATION_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return row


async def _participant_for_account(
    db: AsyncSession, conversation_id: uuid.UUID, account: Account
) -> ChatParticipant:
    row = await db.get(ChatParticipant, (conversation_id, account.id))
    if row is not None:
        return row
    conversation = await db.get(ChatConversation, conversation_id)
    if (
        conversation is None
        or conversation.kind != ConversationKind.SUPPORT
        or not _has_role(account, "admin")
    ):
        raise api_error(ErrorCode.CHAT_CONVERSATION_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    row = ChatParticipant(
        conversation_id=conversation.id,
        account_id=account.id,
        context_role=ContextRole.ADMIN,
    )
    db.add(row)
    await db.flush()
    return row


def _message_dto(message: ChatMessage) -> ChatMessageResponse:
    return ChatMessageResponse.model_validate(message, from_attributes=True)


async def _summary(
    db: AsyncSession,
    conversation: ChatConversation,
    participant: ChatParticipant,
) -> ConversationSummary:
    product = await db.get(Product, conversation.product_id) if conversation.product_id else None
    if conversation.kind == ConversationKind.SUPPORT:
        if participant.context_role == ContextRole.ADMIN:
            counterpart_id = conversation.requester_id or 0
            counterpart_role = conversation.requester_role or ContextRole.BUYER
            requester = await db.get(Account, counterpart_id) if counterpart_id else None
            counterpart_label = (
                requester.email.split("@", 1)[0]
                if requester and requester.email
                else f"#{counterpart_id}"
            )
        else:
            counterpart_id = MARKETPLACE_COUNTERPART_ID
            counterpart_role = ContextRole.ADMIN
            counterpart_label = MARKETPLACE_LABEL
    else:
        counterpart_id = (
            conversation.seller_id if participant.context_role == ContextRole.BUYER else conversation.buyer_id
        )
        counterpart_role = (
            ContextRole.SELLER if participant.context_role == ContextRole.BUYER else ContextRole.BUYER
        )
        counterpart_label = f"Khách hàng #{counterpart_id or 0}"
    if counterpart_role == ContextRole.SELLER and conversation.kind != ConversationKind.SUPPORT:
        business_name = await db.scalar(
            select(SellerApplication.business_name)
            .where(
                SellerApplication.account_id == counterpart_id,
                SellerApplication.status == ApplicationStatus.approved,
            )
            .order_by(SellerApplication.id.desc())
            .limit(1)
        )
        if not business_name:
            seller_account = await db.get(Account, counterpart_id) if counterpart_id else None
            if seller_account and seller_account.email:
                business_name = seller_account.email.split("@", 1)[0]
        counterpart_label = business_name or f"Gian hàng #{counterpart_id or 0}"
    last_message = (
        await db.get(ChatMessage, conversation.last_message_id)
        if conversation.last_message_id
        else None
    )
    unread = await db.scalar(
        select(func.count(ChatMessage.id)).where(
            ChatMessage.conversation_id == conversation.id,
            ChatMessage.sender_id != participant.account_id,
            ChatMessage.id > (participant.last_read_message_id or 0),
        )
    )
    image = parse_cover_id(product.images) if product else None
    order = await db.get(Order, conversation.order_id) if conversation.order_id else None
    order_status = (
        str(order.status.value if hasattr(order.status, "value") else order.status)
        if order
        else None
    )
    terminal_order = (
        conversation.kind != ConversationKind.SUPPORT
        and order_status in {"cancelled", "refunded"}
    )
    effective_status = (
        ConversationStatus.READ_ONLY if terminal_order else conversation.status
    )
    read_only_reason = None
    if terminal_order:
        read_only_reason = order.cancel_reason or (
            "Đơn hàng đã hoàn tiền. Cuộc trò chuyện hiện chỉ đọc."
            if order_status == "refunded"
            else "Đơn hàng đã huỷ. Cuộc trò chuyện hiện chỉ đọc."
        )
    elif effective_status != ConversationStatus.OPEN:
        read_only_reason = "Cuộc trò chuyện hiện chỉ đọc."
    dispute_ctx = None
    if order:
        dispute = await db.scalar(
            select(Dispute)
            .where(Dispute.order_id == order.id)
            .order_by(Dispute.id.desc())
            .limit(1)
        )
        if dispute:
            claimed_count = int(
                await db.scalar(
                    select(func.count(DisputeClaimResource.id)).where(
                        DisputeClaimResource.dispute_id == dispute.id
                    )
                )
                or 0
            )
            replaced_count = int(
                await db.scalar(
                    select(func.count(DisputeResourceAction.id)).where(
                        DisputeResourceAction.dispute_id == dispute.id,
                        DisputeResourceAction.action == "replace",
                    )
                )
                or 0
            )
            refund_row = (
                await db.execute(
                    select(
                        func.count(DisputeResourceAction.id),
                        func.coalesce(func.sum(DisputeResourceAction.refund_amount), 0),
                    ).where(
                        DisputeResourceAction.dispute_id == dispute.id,
                        DisputeResourceAction.action == "refund",
                    )
                )
            ).first()
            refunded_count = int(refund_row[0] or 0) if refund_row else 0
            refunded_amount = int(refund_row[1] or 0) if refund_row else 0
            pending_count = max(0, claimed_count - replaced_count - refunded_count)
            dispute_status = (
                str(dispute.status.value if hasattr(dispute.status, "value") else dispute.status)
            )
            dispute_ctx = ChatDisputeContext(
                id=dispute.id,
                status=dispute_status,
                reason=dispute.reason,
                review_requested_at=dispute.review_requested_at,
                claimed_count=claimed_count,
                replaced_count=replaced_count,
                pending_count=pending_count,
                refunded_amount=refunded_amount,
            )

    return ConversationSummary(
        id=conversation.id,
        kind=conversation.kind,
        status=effective_status,
        product=ChatProduct(id=product.id, title=product.title, image=image) if product else None,
        order=(
            ChatOrderContext(
                id=order.id,
                status=order_status or "",
                quantity=order.quantity,
                total_amount=order.total_amount,
                cancel_reason=order.cancel_reason,
            )
            if order
            else None
        ),
        dispute=dispute_ctx,
        counterpart=SafeCounterpart(
            id=counterpart_id or 0,
            label=counterpart_label,
            role=counterpart_role,
        ),
        last_message=_message_dto(last_message) if last_message else None,
        unread_count=int(unread or 0),
        can_send=effective_status == ConversationStatus.OPEN,
        read_only_reason=read_only_reason,
        created_at=conversation.created_at,
    )


async def _detail(
    db: AsyncSession,
    conversation: ChatConversation,
    participant: ChatParticipant,
    *,
    mark_read: bool = False,
) -> ConversationDetail:
    messages = (
        await db.scalars(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation.id)
            .order_by(ChatMessage.id)
            .limit(100)
        )
    ).all()
    if mark_read and messages:
        participant.last_read_message_id = max(
            participant.last_read_message_id or 0, messages[-1].id
        )
        await db.commit()
    summary = await _summary(db, conversation, participant)
    return ConversationDetail(**summary.model_dump(), messages=[_message_dto(m) for m in messages])


async def create_inquiry(
    account: Account,
    product_id: int,
    body: str,
    client_message_id: uuid.UUID,
    db: AsyncSession,
) -> tuple[ConversationDetail, bool]:
    product = await db.get(Product, product_id)
    if product is None or product.status != ProductStatus.active:
        raise api_error(ErrorCode.CHAT_PRODUCT_UNAVAILABLE, status.HTTP_404_NOT_FOUND)
    if product.seller_id == account.id:
        raise api_error(ErrorCode.CHAT_SELF_INQUIRY, status.HTTP_400_BAD_REQUEST)

    # Serialise get-or-create on the product row. The unique index is the final
    # guard; this lock lets the losing request observe and reuse the committed room.
    await db.execute(select(Product.id).where(Product.id == product.id).with_for_update())

    existing = await db.scalar(
        select(ChatConversation).where(
            ChatConversation.kind == ConversationKind.PRODUCT_INQUIRY,
            ChatConversation.product_id == product.id,
            ChatConversation.buyer_id == account.id,
            ChatConversation.seller_id == product.seller_id,
        )
    )
    if existing:
        participant = await _participant(db, existing.id, account.id)
        participant.archived_at = None
        return await _detail(db, existing, participant), False

    conversation = ChatConversation(
        kind=ConversationKind.PRODUCT_INQUIRY,
        status=ConversationStatus.OPEN,
        product_id=product.id,
        buyer_id=account.id,
        seller_id=product.seller_id,
        created_by_id=account.id,
    )
    db.add(conversation)
    await db.flush()
    buyer = ChatParticipant(
        conversation_id=conversation.id, account_id=account.id, context_role=ContextRole.BUYER
    )
    seller = ChatParticipant(
        conversation_id=conversation.id,
        account_id=product.seller_id,
        context_role=ContextRole.SELLER,
    )
    db.add_all([buyer, seller])
    message = ChatMessage(
        conversation_id=conversation.id,
        sender_id=account.id,
        sender_role=ContextRole.BUYER,
        client_message_id=client_message_id,
        body=body,
    )
    db.add(message)
    await db.flush()
    conversation.last_message_id = message.id
    conversation.last_message_at = message.created_at
    buyer.last_read_message_id = message.id
    await db.commit()
    await db.refresh(conversation)
    await publish(
        [account.id, product.seller_id],
        {"type": "conversation.created", "conversation_id": str(conversation.id)},
    )
    return await _detail(db, conversation, buyer), True


async def find_product_inquiry(
    account: Account, product_id: int, db: AsyncSession
) -> ConversationDetail:
    conversation = await db.scalar(
        select(ChatConversation).where(
            ChatConversation.kind == ConversationKind.PRODUCT_INQUIRY,
            ChatConversation.product_id == product_id,
            ChatConversation.buyer_id == account.id,
        )
    )
    if conversation is None:
        raise api_error(ErrorCode.CHAT_INQUIRY_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    member = await _participant(db, conversation.id, account.id)
    return await _detail(db, conversation, member)


_LIST_PERSPECTIVES = {ContextRole.BUYER, ContextRole.SELLER, "all"}


async def unread_message_count(
    account_id: int, perspective: str | None, db: AsyncSession
) -> int:
    filters = [
        ChatParticipant.account_id == account_id,
        ChatParticipant.archived_at.is_(None),
        ChatMessage.sender_id != account_id,
        ChatMessage.id > func.coalesce(ChatParticipant.last_read_message_id, 0),
    ]
    if perspective in {ContextRole.BUYER, ContextRole.SELLER}:
        filters.append(ChatParticipant.context_role == perspective)
    elif perspective not in {None, "all"}:
        return 0
    count = await db.scalar(
        select(func.count(ChatMessage.id))
        .select_from(ChatMessage)
        .join(
            ChatParticipant,
            ChatParticipant.conversation_id == ChatMessage.conversation_id,
        )
        .where(*filters)
    )
    return int(count or 0)


async def list_conversations(
    account: Account, perspective: str, db: AsyncSession
) -> ConversationList:
    if perspective not in _LIST_PERSPECTIVES:
        raise api_error(ErrorCode.CHAT_INVALID_PERSPECTIVE, status.HTTP_422_UNPROCESSABLE_CONTENT)
    if perspective != "all" and perspective not in (account.roles or []):
        raise api_error(ErrorCode.CHAT_ROLE_UNAVAILABLE, status.HTTP_403_FORBIDDEN)
    membership = [
        ChatParticipant.account_id == account.id,
        ChatParticipant.archived_at.is_(None),
    ]
    if perspective != "all":
        membership.append(ChatParticipant.context_role == perspective)
    rows = (
        await db.execute(
            select(ChatConversation, ChatParticipant)
            .join(ChatParticipant, ChatParticipant.conversation_id == ChatConversation.id)
            .where(*membership)
            .order_by(ChatConversation.last_message_at.desc().nulls_last(), ChatConversation.id.desc())
            .limit(50)
        )
    ).all()
    return ConversationList(items=[await _summary(db, room, member) for room, member in rows])


async def get_or_create_order_conversation(
    account: Account, order_id: int, db: AsyncSession
) -> tuple[ConversationDetail, bool]:
    order = await db.get(Order, order_id, with_for_update=True)
    if order is None or account.id not in {order.buyer_id, order.seller_id}:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    existing = await db.scalar(
        select(ChatConversation).where(
            ChatConversation.kind == ConversationKind.ORDER,
            ChatConversation.order_id == order.id,
        )
    )
    if existing:
        member = await _participant(db, existing.id, account.id)
        return await _detail(db, existing, member), False

    conversation = ChatConversation(
        kind=ConversationKind.ORDER,
        status=(
            ConversationStatus.READ_ONLY
            if str(order.status.value if hasattr(order.status, "value") else order.status) in {"cancelled", "refunded"}
            else ConversationStatus.OPEN
        ),
        order_id=order.id,
        product_id=order.product_id,
        buyer_id=order.buyer_id,
        seller_id=order.seller_id,
        created_by_id=account.id,
    )
    db.add(conversation)
    await db.flush()
    buyer = ChatParticipant(conversation_id=conversation.id, account_id=order.buyer_id, context_role=ContextRole.BUYER)
    seller = ChatParticipant(conversation_id=conversation.id, account_id=order.seller_id, context_role=ContextRole.SELLER)
    db.add_all([buyer, seller])
    await db.commit()
    await db.refresh(conversation)
    await publish(
        [order.buyer_id, order.seller_id],
        {"type": "conversation.created", "conversation_id": str(conversation.id)},
    )
    member = buyer if account.id == order.buyer_id else seller
    return await _detail(db, conversation, member), True


async def get_conversation(
    account: Account, conversation_id: uuid.UUID, db: AsyncSession
) -> ConversationDetail:
    participant = await _participant_for_account(db, conversation_id, account)
    conversation = await db.get(ChatConversation, conversation_id)
    if conversation is None:
        raise api_error(ErrorCode.CHAT_CONVERSATION_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return await _detail(db, conversation, participant, mark_read=True)


async def send_message(
    account: Account,
    conversation_id: uuid.UUID,
    body: str,
    client_message_id: uuid.UUID,
    db: AsyncSession,
) -> ChatMessageResponse:
    participant = await _participant_for_account(db, conversation_id, account)
    conversation = await db.get(ChatConversation, conversation_id, with_for_update=True)
    if conversation is None:
        raise api_error(ErrorCode.CHAT_CONVERSATION_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if conversation.status != ConversationStatus.OPEN:
        raise api_error(ErrorCode.CHAT_READ_ONLY, status.HTTP_409_CONFLICT)
    if conversation.kind == ConversationKind.ORDER and conversation.order_id:
        order = await db.get(Order, conversation.order_id)
        order_status = str(order.status.value if order and hasattr(order.status, "value") else order.status if order else "")
        if order_status in {"cancelled", "refunded"}:
            conversation.status = ConversationStatus.READ_ONLY
            await db.commit()
            raise api_error(ErrorCode.CHAT_READ_ONLY, status.HTTP_409_CONFLICT)
    existing = await db.scalar(
        select(ChatMessage).where(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.client_message_id == client_message_id,
        )
    )
    if existing:
        if existing.body != body or existing.sender_id != account.id:
            raise api_error(ErrorCode.CHAT_MESSAGE_ID_CONFLICT, status.HTTP_409_CONFLICT)
        return _message_dto(existing)
    message = ChatMessage(
        conversation_id=conversation_id,
        sender_id=account.id,
        sender_role=participant.context_role,
        client_message_id=client_message_id,
        body=body,
    )
    db.add(message)
    await db.flush()
    conversation.last_message_id = message.id
    conversation.last_message_at = message.created_at
    participant.last_read_message_id = max(participant.last_read_message_id or 0, message.id)
    await db.commit()
    await db.refresh(message)
    if conversation.kind == ConversationKind.SUPPORT:
        recipients = list(
            (
                await db.execute(
                    select(ChatParticipant.account_id).where(
                        ChatParticipant.conversation_id == conversation.id
                    )
                )
            ).scalars()
        )
        if conversation.requester_id:
            recipients.append(conversation.requester_id)
    else:
        recipients = [value for value in (conversation.buyer_id, conversation.seller_id) if value]
    await publish(
        recipients,
        {"type": "message.created", "conversation_id": str(conversation.id), "message_id": message.id},
    )
    return _message_dto(message)


async def ensure_support_conversation(
    account: Account,
    order: Order,
    dispute: Dispute,
    db: AsyncSession,
    *,
    initial_message: str,
    client_message_id: uuid.UUID,
) -> tuple[uuid.UUID, bool]:
    """Create or reuse the requester's Marketplace thread. Flush only; caller commits."""
    trimmed = initial_message.strip()
    requester_role = ContextRole.SELLER if account.id == order.seller_id else ContextRole.BUYER
    existing = await db.scalar(
        select(ChatConversation).where(
            ChatConversation.kind == ConversationKind.SUPPORT,
            ChatConversation.order_id == order.id,
            ChatConversation.requester_id == account.id,
        )
    )
    if existing:
        member = await _participant(db, existing.id, account.id)
        member.archived_at = None
        if trimmed:
            await _append_support_message(
                existing, member, account, trimmed, client_message_id, db
            )
        return existing.id, False

    conversation = ChatConversation(
        kind=ConversationKind.SUPPORT,
        status=ConversationStatus.OPEN,
        order_id=order.id,
        product_id=order.product_id,
        requester_id=account.id,
        requester_role=requester_role,
        subject=f"Dispute #{dispute.id} · Order #{order.id}",
        created_by_id=account.id,
    )
    db.add(conversation)
    await db.flush()
    member = ChatParticipant(
        conversation_id=conversation.id,
        account_id=account.id,
        context_role=requester_role,
    )
    db.add(member)
    message = ChatMessage(
        conversation_id=conversation.id,
        sender_id=account.id,
        sender_role=requester_role,
        client_message_id=client_message_id,
        body=trimmed,
    )
    db.add(message)
    await db.flush()
    conversation.last_message_id = message.id
    conversation.last_message_at = message.created_at
    member.last_read_message_id = message.id
    return conversation.id, True


async def notify_support_opened(
    account_id: int,
    conversation_id: uuid.UUID,
    created: bool,
    db: AsyncSession,
) -> None:
    if created:
        admin_ids = list(
            (
                await db.execute(
                    select(Account.id).where(
                        Account.is_active.is_(True),
                        Account.roles.any("admin"),
                    )
                )
            ).scalars()
        )
        await publish(
            [account_id, *admin_ids],
            {"type": "conversation.created", "conversation_id": str(conversation_id)},
        )


async def open_support_conversation(
    account: Account,
    order_id: int,
    db: AsyncSession,
) -> tuple[ConversationDetail, bool]:
    """Reopen an existing Marketplace thread. Creating one requires dispute escalate."""
    order = await db.get(Order, order_id, with_for_update=True)
    if order is None or account.id not in {order.buyer_id, order.seller_id}:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    existing = await db.scalar(
        select(ChatConversation).where(
            ChatConversation.kind == ConversationKind.SUPPORT,
            ChatConversation.order_id == order.id,
            ChatConversation.requester_id == account.id,
        )
    )
    if existing:
        member = await _participant(db, existing.id, account.id)
        if member.archived_at is not None:
            member.archived_at = None
            await db.commit()
        return await _detail(db, existing, member), False
    dispute = await db.scalar(
        select(Dispute)
        .where(Dispute.order_id == order.id, Dispute.status == DisputeStatus.open)
        .limit(1)
    )
    if not dispute:
        raise api_error(ErrorCode.CHAT_SUPPORT_REQUIRES_DISPUTE, status.HTTP_400_BAD_REQUEST)
    raise api_error(ErrorCode.CHAT_SUPPORT_REQUIRES_REVIEW, status.HTTP_400_BAD_REQUEST)


async def _append_support_message(
    conversation: ChatConversation,
    participant: ChatParticipant,
    account: Account,
    body: str,
    client_message_id: uuid.UUID,
    db: AsyncSession,
) -> None:
    existing = await db.scalar(
        select(ChatMessage).where(
            ChatMessage.conversation_id == conversation.id,
            ChatMessage.client_message_id == client_message_id,
        )
    )
    trimmed = body.strip()
    if existing:
        if existing.body != trimmed or existing.sender_id != account.id:
            raise api_error(ErrorCode.CHAT_MESSAGE_ID_CONFLICT, status.HTTP_409_CONFLICT)
        return
    if not trimmed:
        return
    message = ChatMessage(
        conversation_id=conversation.id,
        sender_id=account.id,
        sender_role=participant.context_role,
        client_message_id=client_message_id,
        body=trimmed,
    )
    db.add(message)
    await db.flush()
    conversation.last_message_id = message.id
    conversation.last_message_at = message.created_at
    participant.last_read_message_id = max(participant.last_read_message_id or 0, message.id)


async def list_support_conversations(account: Account, db: AsyncSession) -> ConversationList:
    if not _has_role(account, "admin"):
        raise api_error(ErrorCode.ADMIN_ONLY, status.HTTP_403_FORBIDDEN)
    last_message = aliased(ChatMessage)
    latest_dispute_id = (
        select(Dispute.id)
        .where(Dispute.order_id == ChatConversation.order_id)
        .order_by(Dispute.id.desc())
        .limit(1)
        .correlate(ChatConversation)
        .scalar_subquery()
    )
    unread_count = (
        select(func.count(ChatMessage.id))
        .where(
            ChatMessage.conversation_id == ChatConversation.id,
            ChatMessage.sender_id != account.id,
            ChatMessage.id > func.coalesce(ChatParticipant.last_read_message_id, 0),
        )
        .correlate(ChatConversation, ChatParticipant)
        .scalar_subquery()
    )
    claimed_count = (
        select(func.count(DisputeClaimResource.id))
        .where(DisputeClaimResource.dispute_id == Dispute.id)
        .correlate(Dispute)
        .scalar_subquery()
    )
    replaced_count = (
        select(func.count(DisputeResourceAction.id))
        .where(
            DisputeResourceAction.dispute_id == Dispute.id,
            DisputeResourceAction.action == "replace",
        )
        .correlate(Dispute)
        .scalar_subquery()
    )
    refunded_count = (
        select(func.count(DisputeResourceAction.id))
        .where(
            DisputeResourceAction.dispute_id == Dispute.id,
            DisputeResourceAction.action == "refund",
        )
        .correlate(Dispute)
        .scalar_subquery()
    )
    refunded_amount = (
        select(func.coalesce(func.sum(DisputeResourceAction.refund_amount), 0))
        .where(
            DisputeResourceAction.dispute_id == Dispute.id,
            DisputeResourceAction.action == "refund",
        )
        .correlate(Dispute)
        .scalar_subquery()
    )
    rows = (
        await db.execute(
            select(
                ChatConversation,
                Account.email,
                Product,
                last_message,
                Order,
                Dispute,
                unread_count.label("unread_count"),
                claimed_count.label("claimed_count"),
                replaced_count.label("replaced_count"),
                refunded_count.label("refunded_count"),
                refunded_amount.label("refunded_amount"),
            )
            .outerjoin(
                ChatParticipant,
                and_(
                    ChatParticipant.conversation_id == ChatConversation.id,
                    ChatParticipant.account_id == account.id,
                ),
            )
            .outerjoin(Account, Account.id == ChatConversation.requester_id)
            .outerjoin(Product, Product.id == ChatConversation.product_id)
            .outerjoin(last_message, last_message.id == ChatConversation.last_message_id)
            .outerjoin(Order, Order.id == ChatConversation.order_id)
            .outerjoin(Dispute, Dispute.id == latest_dispute_id)
            .where(ChatConversation.kind == ConversationKind.SUPPORT)
            .order_by(
                ChatConversation.last_message_at.desc().nulls_last(),
                ChatConversation.id.desc(),
            )
            .limit(100)
        )
    ).all()
    items: list[ConversationSummary] = []
    for (
        room,
        requester_email,
        product,
        message,
        order,
        dispute,
        unread,
        claims,
        replacements,
        refunds,
        refund_total,
    ) in rows:
        dispute_ctx = None
        if dispute:
            dispute_ctx = ChatDisputeContext(
                id=dispute.id,
                status=str(dispute.status.value if hasattr(dispute.status, "value") else dispute.status),
                reason=dispute.reason,
                review_requested_at=dispute.review_requested_at,
                claimed_count=int(claims or 0),
                replaced_count=int(replacements or 0),
                pending_count=max(0, int(claims or 0) - int(replacements or 0) - int(refunds or 0)),
                refunded_amount=int(refund_total or 0),
            )
        order_status = (
            str(order.status.value if hasattr(order.status, "value") else order.status)
            if order
            else None
        )
        items.append(
            ConversationSummary(
                id=room.id,
                kind=room.kind,
                status=room.status,
                product=(
                    ChatProduct(
                        id=product.id,
                        title=product.title,
                        image=parse_cover_id(product.images),
                    )
                    if product
                    else None
                ),
                order=(
                    ChatOrderContext(
                        id=order.id,
                        status=order_status or "",
                        quantity=order.quantity,
                        total_amount=order.total_amount,
                        cancel_reason=order.cancel_reason,
                    )
                    if order
                    else None
                ),
                dispute=dispute_ctx,
                counterpart=SafeCounterpart(
                    id=room.requester_id or 0,
                    label=(
                        requester_email.split("@", 1)[0]
                        if requester_email
                        else f"#{room.requester_id or 0}"
                    ),
                    role=room.requester_role or ContextRole.BUYER,
                ),
                last_message=_message_dto(message) if message else None,
                unread_count=int(unread or 0),
                can_send=room.status == ConversationStatus.OPEN,
                read_only_reason=(
                    None
                    if room.status == ConversationStatus.OPEN
                    else "Cuộc trò chuyện hiện chỉ đọc."
                ),
                created_at=room.created_at,
            )
        )
    return ConversationList(items=items)
