import uuid

from fastapi import status
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.content_filter import screen_text
from src.exceptions import ErrorCode, api_error

from src.chat.enums import CHAT_ATTACHMENT_SUBJECT, ContextRole, ConversationKind, ConversationStatus
from src.chat import tickets
from src.chat.events import publish
from src.chat.schemas import (
    MAX_ATTACHMENTS_PER_MESSAGE,
    ChatDisputeContext,
    ChatMessageResponse,
    ChatOrderContext,
    ChatProduct,
    ConversationDetail,
    ConversationList,
    ConversationSummary,
    SafeCounterpart,
)
from src.media import service as media_service
from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.chat import ChatConversation, ChatMessage, ChatParticipant
from src.models.media import MediaObject, MediaPurpose
from src.models.order import (
    Dispute,
    DisputeClaimProxy,
    DisputeClaimResource,
    DisputeProxyAction,
    DisputeResourceAction,
    DisputeStatus,
    Order,
)
from src.models.product import Product, ProductStatus
from src.products.covers import parse_cover_id

MARKETPLACE_LABEL = "Marketplace"
MARKETPLACE_COUNTERPART_KEY = "marketplace"


# Per-proxy dispute items (claimed lines / refunds), correlated to Dispute —
# added to the stock-line counts so a proxy case reads the same in chat.
def _proxy_claim_count():
    return select(func.count(DisputeClaimProxy.id)).where(
        DisputeClaimProxy.dispute_id == Dispute.id
    ).correlate(Dispute).scalar_subquery()


def _proxy_refund_count():
    return select(func.count(DisputeProxyAction.id)).where(
        DisputeProxyAction.dispute_id == Dispute.id
    ).correlate(Dispute).scalar_subquery()


def _proxy_refund_total():
    return select(func.coalesce(func.sum(DisputeProxyAction.refund_amount), 0)).where(
        DisputeProxyAction.dispute_id == Dispute.id
    ).correlate(Dispute).scalar_subquery()
# Threads with the Marketplace desk: admins may join them, and they are exempt
# from the off-platform contact filter.
DESK_KINDS = (ConversationKind.SUPPORT, ConversationKind.HELPDESK)


def _has_role(account: Account, role: str) -> bool:
    return role in (account.roles or [])


def _chat_collapse_key(conversation_id: uuid.UUID) -> str:
    return f"chat:{conversation_id}"


async def _notify_new_message(
    db: AsyncSession, conversation: ChatConversation, sender: Account, sender_role: ContextRole,
) -> None:
    """One unread notification per thread for the other side. Admins work
    from the desk queue, so a customer's message to the desk notifies no one;
    a desk reply notifies the customer."""
    from src.notifications.history import notify_collapsed
    from src.sellers.service import approved_business_names

    if sender_role == ContextRole.ADMIN:
        recipients, source = ([conversation.requester_id] if conversation.requester_id else []), "desk"
    elif conversation.kind in DESK_KINDS:
        return
    else:
        other = conversation.seller_id if sender.id == conversation.buyer_id else conversation.buyer_id
        recipients = [other] if other else []
        source = "shop" if sender_role == ContextRole.SELLER else "buyer"
    if not recipients:
        return
    params: dict = {"from": source}
    if source == "shop":
        params["name"] = (await approved_business_names([sender.id], db)).get(sender.id)
    for account_id in recipients:
        await notify_collapsed(
            db, account_id, "chat_message", category="message", collapse_key=_chat_collapse_key(conversation.id),
            params=params, href=f"/messages/{conversation.id}",
        )


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
        or conversation.kind not in DESK_KINDS
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
    counterpart_id: int | None
    if conversation.kind in DESK_KINDS:
        if participant.context_role == ContextRole.ADMIN:
            counterpart_id = conversation.requester_id or 0
            counterpart_role = conversation.requester_role or ContextRole.BUYER
        else:
            counterpart_id = None
            counterpart_role = ContextRole.ADMIN
    else:
        counterpart_id = (
            conversation.seller_id if participant.context_role == ContextRole.BUYER else conversation.buyer_id
        )
        counterpart_role = (
            ContextRole.SELLER if participant.context_role == ContextRole.BUYER else ContextRole.BUYER
        )
    counterpart_account = await db.get(Account, counterpart_id) if counterpart_id else None
    # Public key on the wire; the sequential id never leaves the server.
    counterpart_key = counterpart_account.public_key if counterpart_account else MARKETPLACE_COUNTERPART_KEY
    if conversation.kind in DESK_KINDS:
        if participant.context_role == ContextRole.ADMIN:
            counterpart_label = (
                counterpart_account.email.split("@", 1)[0]
                if counterpart_account and counterpart_account.email
                else f"#{counterpart_key}"
            )
        else:
            counterpart_label = MARKETPLACE_LABEL
    else:
        counterpart_label = f"Khách hàng #{counterpart_key}"
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
        if not business_name and counterpart_account and counterpart_account.email:
            business_name = counterpart_account.email.split("@", 1)[0]
        counterpart_label = business_name or f"Gian hàng #{counterpart_key}"
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
    can_send = effective_status == ConversationStatus.OPEN
    if conversation.kind in DESK_KINDS:
        can_send, read_only_reason = desk_can_send(
            effective_status, admin=participant.context_role == ContextRole.ADMIN,
        )
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
            # Proxy lines count as claimed items; a proxy remedy is always a refund.
            claimed_count += int(await db.scalar(
                select(func.count(DisputeClaimProxy.id)).where(DisputeClaimProxy.dispute_id == dispute.id)
            ) or 0)
            proxy_row = (await db.execute(
                select(func.count(DisputeProxyAction.id), func.coalesce(func.sum(DisputeProxyAction.refund_amount), 0))
                .where(DisputeProxyAction.dispute_id == dispute.id)
            )).first()
            if proxy_row:
                refunded_count += int(proxy_row[0] or 0)
                refunded_amount += int(proxy_row[1] or 0)
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
        product=ChatProduct(id=product.id, title=product.title, image=image, slug=product.slug, public_key=product.public_key) if product else None,
        order=(
            ChatOrderContext(
                id=order.id,
                code=order.order_code,
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
            id=counterpart_key,
            label=counterpart_label,
            role=counterpart_role,
        ),
        viewer_role=participant.context_role,
        last_message=_message_dto(last_message) if last_message else None,
        unread_count=int(unread or 0),
        can_send=can_send,
        read_only_reason=read_only_reason,
        created_at=conversation.created_at,
    )


async def _detail(
    db: AsyncSession,
    conversation: ChatConversation,
    participant: ChatParticipant,
    *,
    mark_read: bool = False,
    before_id: int | None = None,
) -> ConversationDetail:
    query = (
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conversation.id)
        .order_by(ChatMessage.id.desc())
        .limit(51)
    )
    if before_id is not None:
        query = query.where(ChatMessage.id < before_id)
    newest_first = list(
        await db.scalars(
            query
        )
    )
    has_more = len(newest_first) > 50
    messages = list(reversed(newest_first[:50]))
    if mark_read and before_id is None and messages:
        from src.notifications.history import mark_collapsed_read

        participant.last_read_message_id = max(
            participant.last_read_message_id or 0, messages[-1].id
        )
        await mark_collapsed_read(db, participant.account_id, _chat_collapse_key(conversation.id))
        await db.commit()
    summary = await _summary(db, conversation, participant)
    return ConversationDetail(
        **summary.model_dump(),
        messages=[_message_dto(m) for m in messages],
        next_cursor=messages[0].id if has_more and messages else None,
    )


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
    body = await screen_text(db, body, actor_id=account.id, context="chat_inquiry", subject_id=str(product.id))

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
    await _notify_new_message(db, conversation, account, ContextRole.BUYER)
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
    last_message = aliased(ChatMessage)
    counterpart = aliased(Account)
    counterpart_id = case(
        (ChatConversation.kind.in_(DESK_KINDS), ChatConversation.requester_id),
        (ChatParticipant.context_role == ContextRole.BUYER, ChatConversation.seller_id),
        else_=ChatConversation.buyer_id,
    )
    latest_dispute_id = (
        select(Dispute.id).where(Dispute.order_id == ChatConversation.order_id)
        .order_by(Dispute.id.desc()).limit(1).correlate(ChatConversation).scalar_subquery()
    )
    unread = (
        select(func.count(ChatMessage.id)).where(
            ChatMessage.conversation_id == ChatConversation.id,
            ChatMessage.sender_id != account.id,
            ChatMessage.id > func.coalesce(ChatParticipant.last_read_message_id, 0),
        ).correlate(ChatConversation, ChatParticipant).scalar_subquery()
    )
    claimed = select(func.count(DisputeClaimResource.id)).where(
        DisputeClaimResource.dispute_id == Dispute.id
    ).correlate(Dispute).scalar_subquery() + _proxy_claim_count()
    replaced = select(func.count(DisputeResourceAction.id)).where(
        DisputeResourceAction.dispute_id == Dispute.id,
        DisputeResourceAction.action == "replace",
    ).correlate(Dispute).scalar_subquery()
    refunded = select(func.count(DisputeResourceAction.id)).where(
        DisputeResourceAction.dispute_id == Dispute.id,
        DisputeResourceAction.action == "refund",
    ).correlate(Dispute).scalar_subquery() + _proxy_refund_count()
    refund_total = select(func.coalesce(func.sum(DisputeResourceAction.refund_amount), 0)).where(
        DisputeResourceAction.dispute_id == Dispute.id,
        DisputeResourceAction.action == "refund",
    ).correlate(Dispute).scalar_subquery() + _proxy_refund_total()
    business_name = select(SellerApplication.business_name).where(
        SellerApplication.account_id == counterpart_id,
        SellerApplication.status == ApplicationStatus.approved,
    ).order_by(SellerApplication.id.desc()).limit(1).correlate(ChatConversation, ChatParticipant).scalar_subquery()
    rows = (
        await db.execute(
            select(
                ChatConversation, ChatParticipant, Product, Order, last_message,
                counterpart.email, counterpart.public_key, business_name.label("business_name"), Dispute,
                unread.label("unread"), claimed.label("claimed"), replaced.label("replaced"),
                refunded.label("refunded"), refund_total.label("refund_total"),
            )
            .join(ChatParticipant, ChatParticipant.conversation_id == ChatConversation.id)
            .outerjoin(Product, Product.id == ChatConversation.product_id)
            .outerjoin(Order, Order.id == ChatConversation.order_id)
            .outerjoin(last_message, last_message.id == ChatConversation.last_message_id)
            .outerjoin(counterpart, counterpart.id == counterpart_id)
            .outerjoin(Dispute, Dispute.id == latest_dispute_id)
            .where(*membership)
            .order_by(ChatConversation.last_message_at.desc().nulls_last(), ChatConversation.id.desc())
            .limit(50)
        )
    ).all()
    items = []
    for room, member, product, order, message, email, cp_key, shop_name, dispute, unread_n, claims, replacements, refunds, refund_amount in rows:
        order_status = str(order.status.value if order and hasattr(order.status, "value") else order.status or "") if order else None
        terminal = room.kind != ConversationKind.SUPPORT and order_status in {"cancelled", "refunded"}
        effective_status = ConversationStatus.READ_ONLY if terminal else room.status
        if room.kind in DESK_KINDS and member.context_role != ContextRole.ADMIN:
            cp_key, cp_role, cp_label = MARKETPLACE_COUNTERPART_KEY, ContextRole.ADMIN, MARKETPLACE_LABEL
        else:
            cp_key = cp_key or MARKETPLACE_COUNTERPART_KEY
            cp_role = room.requester_role if room.kind in DESK_KINDS else (ContextRole.SELLER if member.context_role == ContextRole.BUYER else ContextRole.BUYER)
            if cp_role == ContextRole.BUYER and room.kind != ConversationKind.SUPPORT:
                cp_label = f"Khách hàng #{cp_key}"
            else:
                cp_label = shop_name if cp_role == ContextRole.SELLER and room.kind != ConversationKind.SUPPORT else None
                cp_label = cp_label or (email.split("@", 1)[0] if email else f"#{cp_key}")
        dispute_ctx = ChatDisputeContext(
            id=dispute.id, status=dispute.status.value, reason=dispute.reason,
            review_requested_at=dispute.review_requested_at, claimed_count=int(claims or 0),
            replaced_count=int(replacements or 0),
            pending_count=max(0, int(claims or 0)-int(replacements or 0)-int(refunds or 0)),
            refunded_amount=int(refund_amount or 0),
        ) if dispute else None
        items.append(ConversationSummary(
            id=room.id, kind=room.kind, status=effective_status,
            product=ChatProduct(id=product.id, title=product.title, image=parse_cover_id(product.images), slug=product.slug, public_key=product.public_key) if product else None,
            order=ChatOrderContext(id=order.id, code=order.order_code, status=order_status or "", quantity=order.quantity, total_amount=order.total_amount, cancel_reason=order.cancel_reason) if order else None,
            dispute=dispute_ctx, counterpart=SafeCounterpart(id=cp_key, label=cp_label, role=cp_role),
            viewer_role=member.context_role,
            last_message=_message_dto(message) if message else None, unread_count=int(unread_n or 0),
            can_send=effective_status == ConversationStatus.OPEN,
            read_only_reason=(order.cancel_reason if terminal and order else None) or (None if effective_status == ConversationStatus.OPEN else "Cuộc trò chuyện hiện chỉ đọc."),
            created_at=room.created_at,
        ))
    return ConversationList(items=items)


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
    account: Account,
    conversation_id: uuid.UUID,
    db: AsyncSession,
    *,
    before_id: int | None = None,
) -> ConversationDetail:
    participant = await _participant_for_account(db, conversation_id, account)
    conversation = await db.get(ChatConversation, conversation_id)
    if conversation is None:
        raise api_error(ErrorCode.CHAT_CONVERSATION_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return await _detail(
        db, conversation, participant, mark_read=True, before_id=before_id
    )


async def send_message(
    account: Account,
    conversation_id: uuid.UUID,
    body: str,
    client_message_id: uuid.UUID,
    db: AsyncSession,
    attachment_ids: list[str] | None = None,
) -> ChatMessageResponse:
    attachment_ids = list(dict.fromkeys(attachment_ids or []))
    participant = await _participant_for_account(db, conversation_id, account)
    conversation = await db.get(ChatConversation, conversation_id, with_for_update=True)
    if conversation is None:
        raise api_error(ErrorCode.CHAT_CONVERSATION_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    is_admin_sender = participant.context_role == ContextRole.ADMIN
    reopened = False
    if conversation.kind in DESK_KINDS:
        # Desk lifecycle (chat.tickets): blocked refuses the requester only,
        # a requester message on a resolved ticket reopens it, closed is final
        # until an admin reopens it.
        if conversation.status == ConversationStatus.BLOCKED and not is_admin_sender:
            raise api_error(ErrorCode.CHAT_BLOCKED, status.HTTP_403_FORBIDDEN)
        if conversation.status not in (
            ConversationStatus.OPEN, ConversationStatus.RESOLVED, ConversationStatus.BLOCKED,
        ):
            raise api_error(ErrorCode.CHAT_READ_ONLY, status.HTTP_409_CONFLICT)
    elif conversation.status != ConversationStatus.OPEN:
        raise api_error(ErrorCode.CHAT_READ_ONLY, status.HTTP_409_CONFLICT)
    if conversation.kind == ConversationKind.ORDER and conversation.order_id:
        order = await db.get(Order, conversation.order_id)
        order_status = str(order.status.value if order and hasattr(order.status, "value") else order.status if order else "")
        if order_status in {"cancelled", "refunded"}:
            conversation.status = ConversationStatus.READ_ONLY
            await db.commit()
            raise api_error(ErrorCode.CHAT_READ_ONLY, status.HTTP_409_CONFLICT)
    # Buyer ↔ seller text must stay on the marketplace; talking to the
    # Marketplace desk (or as admin) is exempt.
    if body and conversation.kind not in DESK_KINDS and participant.context_role != ContextRole.ADMIN:
        body = await screen_text(
            db, body, actor_id=account.id, context="chat_message", subject_id=str(conversation_id),
        )
    existing = await db.scalar(
        select(ChatMessage).where(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.client_message_id == client_message_id,
        )
    )
    if existing:
        existing_ids = [item.get("id") for item in (existing.attachments or [])]
        if existing.body != body or existing.sender_id != account.id or existing_ids != attachment_ids:
            raise api_error(ErrorCode.CHAT_MESSAGE_ID_CONFLICT, status.HTTP_409_CONFLICT)
        return _message_dto(existing)
    message = ChatMessage(
        conversation_id=conversation_id,
        sender_id=account.id,
        sender_role=participant.context_role,
        client_message_id=client_message_id,
        body=body,
        # Non-null so an images-only message passes the body check before the
        # snapshots (which need the message id) are written.
        attachments=[] if attachment_ids else None,
    )
    db.add(message)
    await db.flush()
    if attachment_ids:
        message.attachments = await media_service.set_subject_media(
            db, actor_id=account.id, purpose=MediaPurpose.chat_attachment, subject_type=CHAT_ATTACHMENT_SUBJECT,
            subject_id=message.id, public_ids=attachment_ids, max_count=MAX_ATTACHMENTS_PER_MESSAGE,
        )
    conversation.last_message_id = message.id
    conversation.last_message_at = message.created_at
    participant.last_read_message_id = max(participant.last_read_message_id or 0, message.id)
    if conversation.kind in DESK_KINDS:
        reopened = await tickets.on_desk_message(db, conversation, message, sender_id=account.id, admin=is_admin_sender)
    await _notify_new_message(db, conversation, account, participant.context_role)
    await db.commit()
    await db.refresh(message)
    if reopened:
        await tickets.publish_ticket_change(db, conversation)
    if conversation.kind in DESK_KINDS:
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
        # A new question to the desk reaches every admin, not only those who
        # already opened the thread.
        if conversation.kind == ConversationKind.HELPDESK and participant.context_role != ContextRole.ADMIN:
            recipients.extend(await _active_admin_ids(db))
    else:
        recipients = [value for value in (conversation.buyer_id, conversation.seller_id) if value]
    await publish(
        recipients,
        {"type": "message.created", "conversation_id": str(conversation.id), "message_id": message.id},
    )
    return _message_dto(message)


async def attachment_for(
    account: Account, conversation_id: uuid.UUID, media_id: str, db: AsyncSession,
) -> MediaObject:
    """An image sent in this conversation, for a participant (or any admin,
    read-only — dispute review looks at buyer↔seller chats). 404 otherwise,
    without telling whether the image exists."""
    if not _has_role(account, "admin"):
        await _participant(db, conversation_id, account.id)
    message_id = await db.scalar(
        select(ChatMessage.id).where(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.attachments.contains([{"id": media_id}]),
        ).limit(1)
    )
    obj = None
    if message_id is not None:
        obj = await media_service.find_on_subject(
            db, media_id, subject_type=CHAT_ATTACHMENT_SUBJECT, subject_ids=[message_id],
        )
    if obj is None:
        raise api_error(ErrorCode.MEDIA_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return obj


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
        subject=f"Dispute · Order {order.order_code}",
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
    conversation.last_requester_message_at = message.created_at
    member.last_read_message_id = message.id
    return conversation.id, True


async def _active_admin_ids(db: AsyncSession) -> list[int]:
    return list(
        (
            await db.execute(
                select(Account.id).where(
                    Account.is_active.is_(True),
                    Account.roles.any("admin"),
                )
            )
        ).scalars()
    )


async def notify_support_opened(
    account_id: int,
    conversation_id: uuid.UUID,
    created: bool,
    db: AsyncSession,
) -> None:
    if created:
        admin_ids = await _active_admin_ids(db)
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
    await tickets.on_desk_message(
        db, conversation, message, sender_id=account.id, admin=participant.context_role == ContextRole.ADMIN,
    )


async def list_support_conversations(account: Account, db: AsyncSession) -> ConversationList:
    """The admin desk inbox: dispute-review threads and helpdesk threads."""
    if not _has_role(account, "admin"):
        raise api_error(ErrorCode.ADMIN_ONLY, status.HTTP_403_FORBIDDEN)
    rows = await desk_summaries(account, db)
    return ConversationList(items=[row.summary for row in rows])


class DeskRow:
    """One desk thread as the admin inbox shows it: the stored row, its
    ConversationSummary, and the raw bits `chat.support` adds to a ticket."""
    __slots__ = ("room", "summary", "requester_email", "shop_name", "last_message")

    def __init__(self, room, summary, requester_email, shop_name, last_message):
        self.room = room
        self.summary = summary
        self.requester_email = requester_email
        self.shop_name = shop_name
        self.last_message = last_message


def desk_shop_name_subquery():
    """Approved shop name of the thread's requester (correlated)."""
    return (
        select(SellerApplication.business_name)
        .where(
            SellerApplication.account_id == ChatConversation.requester_id,
            SellerApplication.status == ApplicationStatus.approved,
        )
        .order_by(SellerApplication.id.desc())
        .limit(1)
        .correlate(ChatConversation)
        .scalar_subquery()
    )


def desk_can_send(status_value: str, *, admin: bool) -> tuple[bool, str | None]:
    """Who may still write in a desk thread (see chat.tickets): the requester
    writes while it is open or resolved (a message reopens it); an admin
    writes unless it is closed. Blocked refuses only the requester."""
    if status_value == ConversationStatus.OPEN:
        return True, None
    if status_value == ConversationStatus.RESOLVED:
        return True, None
    if status_value == ConversationStatus.BLOCKED:
        if admin:
            return True, None
        return False, "Marketplace đã khoá cuộc trò chuyện này, bạn không thể gửi thêm tin nhắn."
    return False, "Cuộc trò chuyện hiện chỉ đọc."


async def desk_summaries(
    account: Account,
    db: AsyncSession,
    *,
    filters: list | None = None,
    order_by: list | None = None,
    limit: int = 100,
) -> list["DeskRow"]:
    """Desk threads (support + helpdesk) for an admin, one query. `filters`
    and `order_by` are extra SQLAlchemy clauses over ChatConversation."""
    last_message = aliased(ChatMessage)
    shop_name = desk_shop_name_subquery()
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
    ) + _proxy_claim_count()
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
    ) + _proxy_refund_count()
    refunded_amount = (
        select(func.coalesce(func.sum(DisputeResourceAction.refund_amount), 0))
        .where(
            DisputeResourceAction.dispute_id == Dispute.id,
            DisputeResourceAction.action == "refund",
        )
        .correlate(Dispute)
        .scalar_subquery()
    ) + _proxy_refund_total()
    rows = (
        await db.execute(
            select(
                ChatConversation,
                Account.email,
                Account.public_key,
                Product,
                last_message,
                Order,
                Dispute,
                unread_count.label("unread_count"),
                claimed_count.label("claimed_count"),
                replaced_count.label("replaced_count"),
                refunded_count.label("refunded_count"),
                refunded_amount.label("refunded_amount"),
                shop_name.label("shop_name"),
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
            .where(ChatConversation.kind.in_(DESK_KINDS), *(filters or []))
            .order_by(
                *(order_by or [
                    ChatConversation.last_message_at.desc().nulls_last(),
                    ChatConversation.id.desc(),
                ])
            )
            .limit(limit)
        )
    ).all()
    items: list[DeskRow] = []
    for (
        room,
        requester_email,
        requester_key,
        product,
        message,
        order,
        dispute,
        unread,
        claims,
        replacements,
        refunds,
        refund_total,
        requester_shop,
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
        can_send, read_only_reason = desk_can_send(room.status, admin=True)
        items.append(DeskRow(
            room,
            ConversationSummary(
                id=room.id,
                kind=room.kind,
                status=room.status,
                product=(
                    ChatProduct(
                        id=product.id,
                        title=product.title,
                        image=parse_cover_id(product.images),
                        slug=product.slug,
                        public_key=product.public_key,
                    )
                    if product
                    else None
                ),
                order=(
                    ChatOrderContext(
                        id=order.id,
                        code=order.order_code,
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
                    id=requester_key or MARKETPLACE_COUNTERPART_KEY,
                    label=(
                        (
                            requester_shop
                            if room.kind == ConversationKind.HELPDESK and room.requester_role == ContextRole.SELLER
                            else None
                        )
                        or (requester_email.split("@", 1)[0] if requester_email else None)
                        or f"#{requester_key or MARKETPLACE_COUNTERPART_KEY}"
                    ),
                    role=room.requester_role or ContextRole.BUYER,
                ),
                viewer_role=ContextRole.ADMIN,
                last_message=_message_dto(message) if message else None,
                unread_count=int(unread or 0),
                can_send=can_send,
                read_only_reason=read_only_reason,
                created_at=room.created_at,
            ),
            requester_email, requester_shop, message,
        ))
    return items


def _helpdesk_role(account: Account, role: str) -> ContextRole:
    """The side of the desk the account writes from. Admins answer the desk;
    only sellers have the shop thread."""
    if _has_role(account, "admin"):
        raise api_error(ErrorCode.CHAT_HELPDESK_UNAVAILABLE, status.HTTP_403_FORBIDDEN)
    if role == ContextRole.SELLER:
        if not _has_role(account, "seller"):
            raise api_error(ErrorCode.CHAT_HELPDESK_SELLER_ONLY, status.HTTP_403_FORBIDDEN)
        return ContextRole.SELLER
    return ContextRole.BUYER


async def _find_helpdesk(account_id: int, role: ContextRole, db: AsyncSession) -> ChatConversation | None:
    return await db.scalar(
        select(ChatConversation).where(
            ChatConversation.kind == ConversationKind.HELPDESK,
            ChatConversation.requester_id == account_id,
            ChatConversation.requester_role == role,
        )
    )


async def get_helpdesk_conversation(account: Account, role: str, db: AsyncSession) -> ConversationDetail | None:
    """The account's standing thread with the Marketplace desk for one role
    (buyer, or seller for a shop), or None before the first message. Opening
    it marks it read."""
    conversation = await _find_helpdesk(account.id, _helpdesk_role(account, role), db)
    if conversation is None:
        return None
    member = await _participant(db, conversation.id, account.id)
    if member.archived_at is not None:
        member.archived_at = None
        await db.commit()
    return await _detail(db, conversation, member, mark_read=True)


async def _ensure_helpdesk_conversation(
    account: Account, role: ContextRole, db: AsyncSession
) -> tuple[ChatConversation, bool]:
    existing = await _find_helpdesk(account.id, role, db)
    if existing:
        return existing, False
    conversation = ChatConversation(
        kind=ConversationKind.HELPDESK,
        status=ConversationStatus.OPEN,
        requester_id=account.id,
        requester_role=role,
        subject="Marketplace chat",
        created_by_id=account.id,
    )
    try:
        async with db.begin_nested():
            db.add(conversation)
            await db.flush()
            db.add(ChatParticipant(conversation_id=conversation.id, account_id=account.id, context_role=role))
            await db.flush()
    except IntegrityError:
        # A concurrent first message created it (uq_chat_helpdesk_requester).
        return await _find_helpdesk(account.id, role, db), False
    await db.commit()
    return conversation, True


async def post_helpdesk_message(
    account: Account,
    role: str,
    body: str,
    client_message_id: uuid.UUID,
    db: AsyncSession,
    attachment_ids: list[str] | None = None,
) -> tuple[ConversationDetail, bool]:
    """Send to the Marketplace desk, creating the account's thread for that
    role on the first message. Admins answer the desk; they cannot open a
    thread with it."""
    conversation, created = await _ensure_helpdesk_conversation(account, _helpdesk_role(account, role), db)
    member = await _participant(db, conversation.id, account.id)
    if member.archived_at is not None:
        member.archived_at = None
        await db.commit()
    await send_message(account, conversation.id, body, client_message_id, db, attachment_ids=attachment_ids)
    await notify_support_opened(account.id, conversation.id, created, db)
    await db.refresh(conversation)
    member = await _participant(db, conversation.id, account.id)
    return await _detail(db, conversation, member), created


async def helpdesk_waiting_count(db: AsyncSession) -> int:
    """Helpdesk threads whose newest message is the customer's: the desk owes a reply."""
    last = aliased(ChatMessage)
    count = await db.scalar(
        select(func.count(ChatConversation.id))
        .join(last, last.id == ChatConversation.last_message_id)
        .where(ChatConversation.kind == ConversationKind.HELPDESK, last.sender_role != ContextRole.ADMIN)
    )
    return int(count or 0)


async def seller_reply_threads(seller_id: int, since, db: AsyncSession) -> list[tuple]:
    """(first buyer message, first seller reply after it) for each product
    inquiry or order chat of this seller whose buyer wrote first since ``since``."""
    first_ask = (
        select(func.min(ChatMessage.created_at))
        .where(ChatMessage.conversation_id == ChatConversation.id, ChatMessage.sender_id == ChatConversation.buyer_id)
        .correlate(ChatConversation)
        .scalar_subquery()
    )
    first_seller = (
        select(func.min(ChatMessage.created_at))
        .where(ChatMessage.conversation_id == ChatConversation.id, ChatMessage.sender_id == ChatConversation.seller_id)
        .correlate(ChatConversation)
        .scalar_subquery()
    )
    rows = (await db.execute(
        select(first_ask.label("asked"), first_seller.label("seller_first"))
        .where(
            ChatConversation.seller_id == seller_id,
            ChatConversation.kind.in_((ConversationKind.PRODUCT_INQUIRY, ConversationKind.ORDER)),
            ChatConversation.last_message_at >= since,
        )
    )).all()
    threads = []
    for asked, seller_first in rows:
        # Seller-initiated chats (or the seller spoke before the buyer) say nothing about reply speed.
        if asked is None or (seller_first is not None and seller_first <= asked):
            continue
        threads.append((asked, seller_first))
    return threads
