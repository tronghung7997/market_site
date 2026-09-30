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
    # The caller's side of the room: buyer, seller or admin. Tells a seller's
    # two helpdesk threads apart.
    viewer_role: str | None = None
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


# ── Admin support desk ───────────────────────────────────────────────────────

class TicketPerson(BaseModel):
    id: int
    email: str


class TicketRequester(TicketPerson):
    role: str


class AdminTicket(ConversationSummary):
    """A desk thread in the admin console (GET /admin/support)."""
    subject: str | None = None
    assignee: TicketPerson | None = None
    tags: list[str] = []
    requester: TicketRequester
    order_code: str | None = None
    waiting_since: datetime | None = None
    first_response_at: datetime | None = None
    resolved_at: datetime | None = None
    blocked_reason: str | None = None
    last_message_at: datetime | None = None
    last_message_preview: str | None = None


class TicketCounts(BaseModel):
    waiting: int
    mine: int
    open: int
    resolved: int


class AdminTicketPage(BaseModel):
    items: list[AdminTicket]
    next_cursor: str | None = None
    counts: TicketCounts


class SupportStats(BaseModel):
    avg_first_response_minutes_7d: float | None
    waiting: int
    oldest_waiting_at: datetime | None


class TicketContextRequester(BaseModel):
    id: int
    email: str
    role: str
    created_at: datetime
    orders_bought: int
    spent: int
    email_verified: bool


class TicketContextOrder(BaseModel):
    id: int
    order_code: str
    total: int
    status: str
    product_title: str | None
    shop_name: str | None


class PreviousTicket(BaseModel):
    id: uuid.UUID
    subject: str | None
    status: str
    created_at: datetime


class TicketContext(BaseModel):
    requester: TicketContextRequester
    order: TicketContextOrder | None
    previous_tickets: list[PreviousTicket]
    tags: list[str]
    assignee: TicketPerson | None
    status: str
    blocked_reason: str | None


class TicketStatusChange(BaseModel):
    status: str = Field(pattern=r"^(open|resolved|closed|blocked)$")
    reason: str | None = Field(default=None, max_length=300)
    notify_requester: bool = False

    @model_validator(mode="after")
    def reason_for_block(self):
        if self.reason is not None:
            self.reason = self.reason.strip() or None
        if self.status == "blocked" and (self.reason is None or len(self.reason) < 3):
            raise ValueError("Nhập lý do chặn (3–300 ký tự)")
        return self


class TicketAssign(BaseModel):
    assignee_id: int | None = None


class TicketTags(BaseModel):
    tags: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("tags")
    @classmethod
    def normalise(cls, value: list[str]) -> list[str]:
        out: list[str] = []
        for raw in value:
            tag = " ".join((raw or "").split()).lower()
            if not (1 <= len(tag) <= 40):
                raise ValueError("Mỗi nhãn dài 1–40 ký tự")
            if tag not in out:
                out.append(tag)
        return out


class TagCount(BaseModel):
    tag: str
    count: int


class NoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)

    @field_validator("body")
    @classmethod
    def strip_body(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Ghi chú không được để trống")
        return value


class AdminNoteOut(BaseModel):
    id: int
    body: str
    author_email: str | None
    created_at: datetime


class CannedReplyInput(BaseModel):
    shortcut: str = Field(min_length=1, max_length=32)
    title: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=1, max_length=2000)

    @field_validator("shortcut", mode="before")
    @classmethod
    def lower_shortcut(cls, value):
        return value.strip().lower().lstrip("/") if isinstance(value, str) else value

    @field_validator("shortcut")
    @classmethod
    def check_shortcut(cls, value: str) -> str:
        import re

        if not re.fullmatch(r"[a-z0-9_-]{1,32}", value):
            raise ValueError("Phím tắt gồm chữ thường, số, '-' hoặc '_' (tối đa 32)")
        return value

    @field_validator("title", "body", mode="before")
    @classmethod
    def strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class CannedReplyPatch(BaseModel):
    shortcut: str | None = None
    title: str | None = None
    body: str | None = None


class CannedReplyOut(BaseModel):
    id: int
    owner_type: str
    owner_id: int | None
    shortcut: str
    title: str
    body: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
