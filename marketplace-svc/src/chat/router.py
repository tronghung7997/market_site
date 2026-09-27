import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, get_stream_account, require_role
from src.database import get_session
from src.media.http import image_response
from src.models.account import Account

from . import schemas, service
from .events import stream
from src.orders.refs import OrderRef

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/events")
async def chat_events(account: Account = Depends(get_stream_account)):
    return StreamingResponse(
        stream(account.id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.post("/inquiries", response_model=schemas.ConversationDetail)
async def create_inquiry(
    payload: schemas.InquiryCreate,
    response: Response,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    result, created = await service.create_inquiry(
        account,
        payload.product_id,
        payload.initial_message,
        payload.client_message_id,
        db,
    )
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return result


@router.get("/inquiries/by-product/{product_id}", response_model=schemas.ConversationDetail)
async def find_product_inquiry(
    product_id: int,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.find_product_inquiry(account, product_id, db)


@router.post("/orders/{order_ref}", response_model=schemas.ConversationDetail)
async def get_or_create_order_conversation(
    order_id: OrderRef,
    response: Response,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    result, created = await service.get_or_create_order_conversation(account, order_id, db)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return result


@router.post("/orders/{order_ref}/support", response_model=schemas.ConversationDetail)
async def open_support_conversation(
    order_id: OrderRef,
    response: Response,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    result, created = await service.open_support_conversation(account, order_id, db)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return result


HelpdeskRole = Literal["buyer", "seller"]


@router.get("/helpdesk", response_model=schemas.ConversationDetail | None)
async def get_helpdesk_conversation(
    role: HelpdeskRole = Query("buyer"),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    """The caller's thread with the Marketplace desk as a buyer, or for their
    shop (``role=seller``); null before the first message."""
    return await service.get_helpdesk_conversation(account, role, db)


@router.post("/helpdesk/messages", response_model=schemas.ConversationDetail)
async def post_helpdesk_message(
    payload: schemas.MessageCreate,
    response: Response,
    role: HelpdeskRole = Query("buyer"),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    result, created = await service.post_helpdesk_message(
        account, role, payload.body, payload.client_message_id, db, attachment_ids=payload.attachments,
    )
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return result


@router.get("/admin/support", response_model=schemas.ConversationList)
async def list_support_conversations(
    account: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_support_conversations(account, db)


@router.get("/conversations", response_model=schemas.ConversationList)
async def list_conversations(
    perspective: str = "buyer",
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_conversations(account, perspective, db)


@router.get("/conversations/{conversation_id}", response_model=schemas.ConversationDetail)
async def get_conversation(
    conversation_id: uuid.UUID,
    before_id: int | None = None,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.get_conversation(account, conversation_id, db, before_id=before_id)


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=schemas.ChatMessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def send_message(
    conversation_id: uuid.UUID,
    payload: schemas.MessageCreate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.send_message(
        account, conversation_id, payload.body, payload.client_message_id, db,
        attachment_ids=payload.attachments,
    )


@router.get("/conversations/{conversation_id}/attachments/{media_id}", include_in_schema=False)
async def chat_attachment(
    conversation_id: uuid.UUID,
    media_id: str,
    request: Request,
    v: str = "full",
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
) -> Response:
    """Private image of a message; participants (and admins) only."""
    obj = await service.attachment_for(account, conversation_id, media_id, db)
    return await image_response(db, request, obj, v)
