import uuid

from fastapi import APIRouter, Depends, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service
from .events import stream

router = APIRouter(prefix="/chat", tags=["chat"])


@router.get("/events")
async def chat_events(account: Account = Depends(get_current_account)):
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


@router.post("/orders/{order_id}", response_model=schemas.ConversationDetail)
async def get_or_create_order_conversation(
    order_id: int,
    response: Response,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    result, created = await service.get_or_create_order_conversation(account, order_id, db)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return result


@router.post("/orders/{order_id}/support", response_model=schemas.ConversationDetail)
async def open_support_conversation(
    order_id: int,
    response: Response,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    result, created = await service.open_support_conversation(account, order_id, db)
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
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.get_conversation(account, conversation_id, db)


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
        account, conversation_id, payload.body, payload.client_message_id, db
    )
