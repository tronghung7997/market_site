import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from src.media.schemas import MediaId
from src.media.service import private_images

MAX_ATTACHMENTS_PER_MESSAGE = 4


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
    body: str = Field(default="", max_length=4000)
    client_message_id: uuid.UUID
    # Upload ids (POST /media/uploads, purpose chat_attachment); a message may
    # be images only.
    attachments: list[MediaId] = Field(default_factory=list, max_length=MAX_ATTACHMENTS_PER_MESSAGE)

    @field_validator("body")
    @classmethod
    def strip_body(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def meaningful_message(self):
        if not self.body and not self.attachments:
            raise ValueError("Tin nhắn không được để trống")
        return self


class ChatMessageResponse(BaseModel):
    id: int
    client_message_id: uuid.UUID
    body: str
    sender_id: int
    sender_role: str
    # PrivateImage shapes; served by GET /chat/conversations/{id}/attachments/{media_id}.
    attachments: list[dict] = []
    created_at: datetime

    @field_validator("attachments", mode="before")
    @classmethod
    def client_images(cls, value):
        return private_images(value)


class SafeCounterpart(BaseModel):
    """The other side of a room, by public key — never the account id or
    email. ``"marketplace"`` stands in for the support desk."""
    id: str
    label: str
    role: str


class ChatProduct(BaseModel):
    id: int
    title: str
    image: str | None = None
    # Public URL ref; inbox links use /products/{slug}-{public_key}.
    slug: str | None = None
    public_key: str | None = None


class ChatOrderContext(BaseModel):
    id: int
    # Buyer/seller-facing order number for labels and links.
    code: str | None = None
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
