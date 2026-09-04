import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class InquiryCreate(BaseModel):
    product_id: int
    initial_message: str = Field(min_length=1, max_length=4000)
    client_message_id: uuid.UUID

    @field_validator("initial_message")
    @classmethod
    def meaningful_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Tin nhắn không được để trống")
        return value


class SupportConversationCreate(BaseModel):
    initial_message: str | None = Field(default=None, max_length=4000)
    client_message_id: uuid.UUID | None = None

    @field_validator("initial_message")
    @classmethod
    def optional_message(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    client_message_id: uuid.UUID

    @field_validator("body")
    @classmethod
    def meaningful_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Tin nhắn không được để trống")
        return value


class ChatMessageResponse(BaseModel):
    id: int
    client_message_id: uuid.UUID
    body: str
    sender_id: int
    sender_role: str
    created_at: datetime


class SafeCounterpart(BaseModel):
    id: int
    label: str
    role: str


class ChatProduct(BaseModel):
    id: int
    title: str
    image: str | None = None


class ChatOrderContext(BaseModel):
    id: int
    status: str
    quantity: int
    total_amount: int
    cancel_reason: str | None = None


class ChatDisputeContext(BaseModel):
    id: int
    status: str
    reason: str
    review_requested_at: datetime | None = None
    claimed_count: int = 0
    replaced_count: int = 0
    pending_count: int = 0
    refunded_amount: int = 0


class ConversationSummary(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    product: ChatProduct | None
    order: ChatOrderContext | None = None
    dispute: ChatDisputeContext | None = None
    counterpart: SafeCounterpart
    last_message: ChatMessageResponse | None
    unread_count: int
    can_send: bool
    read_only_reason: str | None = None
    created_at: datetime


class ConversationDetail(ConversationSummary):
    messages: list[ChatMessageResponse]
    next_cursor: int | None = None


class ConversationList(BaseModel):
    items: list[ConversationSummary]
    next_cursor: str | None = None
