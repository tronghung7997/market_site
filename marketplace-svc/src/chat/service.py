import uuid

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.chat.enums import ContextRole, ConversationKind, ConversationStatus
from src.chat.events import publish
from src.chat.schemas import (
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
from src.models.order import Order
from src.models.product import Product, ProductStatus


async def _participant(
    db: AsyncSession, conversation_id: uuid.UUID, account_id: int
) -> ChatParticipant:
    row = await db.get(ChatParticipant, (conversation_id, account_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy cuộc trò chuyện")
    return row


def _message_dto(message: ChatMessage) -> ChatMessageResponse:
    return ChatMessageResponse.model_validate(message, from_attributes=True)


async def _summary(
    db: AsyncSession,
    conversation: ChatConversation,
    participant: ChatParticipant,
) -> ConversationSummary:
    product = await db.get(Product, conversation.product_id) if conversation.product_id else None
    counterpart_id = (
        conversation.seller_id if participant.context_role == ContextRole.BUYER else conversation.buyer_id
    )
    counterpart_role = (
        ContextRole.SELLER if participant.context_role == ContextRole.BUYER else ContextRole.BUYER
    )
    counterpart_label = f"Khách hàng #{counterpart_id or 0}"
    if counterpart_role == ContextRole.SELLER:
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
    image = None
    if product and product.images:
        values = product.images if isinstance(product.images, list) else list(product.images.values())
        image = str(values[0]) if values else None
    order = await db.get(Order, conversation.order_id) if conversation.order_id else None
    order_status = (
        str(order.status.value if hasattr(order.status, "value") else order.status)
        if order
        else None
    )
    terminal_order = order_status in {"cancelled", "refunded"}
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
        raise HTTPException(status_code=404, detail="Sản phẩm không khả dụng")
    if product.seller_id == account.id:
        raise HTTPException(status_code=400, detail="Seller không thể tự mở trao đổi sản phẩm")

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
        raise HTTPException(status_code=404, detail="Chưa có cuộc trò chuyện")
    member = await _participant(db, conversation.id, account.id)
    return await _detail(db, conversation, member)


async def list_conversations(
    account: Account, perspective: str, db: AsyncSession
) -> ConversationList:
    if perspective not in {ContextRole.BUYER, ContextRole.SELLER}:
        raise HTTPException(status_code=422, detail="Perspective không hợp lệ")
    if perspective not in (account.roles or []):
        raise HTTPException(status_code=403, detail="Tài khoản không có vai trò này")
    rows = (
        await db.execute(
            select(ChatConversation, ChatParticipant)
            .join(ChatParticipant, ChatParticipant.conversation_id == ChatConversation.id)
            .where(
                ChatParticipant.account_id == account.id,
                ChatParticipant.context_role == perspective,
                ChatParticipant.archived_at.is_(None),
            )
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
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
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
    participant = await _participant(db, conversation_id, account.id)
    conversation = await db.get(ChatConversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy cuộc trò chuyện")
    return await _detail(db, conversation, participant, mark_read=True)


async def send_message(
    account: Account,
    conversation_id: uuid.UUID,
    body: str,
    client_message_id: uuid.UUID,
    db: AsyncSession,
) -> ChatMessageResponse:
    participant = await _participant(db, conversation_id, account.id)
    conversation = await db.get(ChatConversation, conversation_id, with_for_update=True)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy cuộc trò chuyện")
    if conversation.status != ConversationStatus.OPEN:
        raise HTTPException(status_code=409, detail="Cuộc trò chuyện hiện chỉ đọc")
    if conversation.kind == ConversationKind.ORDER and conversation.order_id:
        order = await db.get(Order, conversation.order_id)
        order_status = str(order.status.value if order and hasattr(order.status, "value") else order.status if order else "")
        if order_status in {"cancelled", "refunded"}:
            conversation.status = ConversationStatus.READ_ONLY
            await db.commit()
            raise HTTPException(status_code=409, detail="Đơn hàng đã kết thúc, cuộc trò chuyện hiện chỉ đọc")
    existing = await db.scalar(
        select(ChatMessage).where(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.client_message_id == client_message_id,
        )
    )
    if existing:
        if existing.body != body or existing.sender_id != account.id:
            raise HTTPException(status_code=409, detail="Idempotency key đã được sử dụng")
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
    recipients = [value for value in (conversation.buyer_id, conversation.seller_id) if value]
    await publish(
        recipients,
        {"type": "message.created", "conversation_id": str(conversation.id), "message_id": message.id},
    )
    return _message_dto(message)
