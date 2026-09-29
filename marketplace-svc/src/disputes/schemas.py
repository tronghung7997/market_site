from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from src.media.schemas import MediaId
from src.security.input_limits import bounded_mapping

# Images per dispute post (opening the case or one case message) and per case.
MAX_IMAGES_PER_POST = 6
MAX_IMAGES_PER_CASE = 20
# Proxy lines named in one claim batch or one remedy (an order holds ≤ 50).
MAX_PROXY_LINES = 200

# A proxy line of the order as the buyer sees it (`#NN` → NN).
ProxyLineNo = Annotated[int, Field(ge=1)]


def _unique_lines(value: list[int] | None) -> list[int] | None:
    if value is not None and (not value or len(set(value)) != len(value)):
        raise ValueError("proxy_line_nos must be non-empty and unique")
    return value


class DisputeCreate(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    evidence_type: str | None = Field(default=None, max_length=50)
    evidence: dict[str, str] | None = None
    # Upload ids (POST /media/uploads, purpose dispute_evidence).
    evidence_images: list[MediaId] = Field(default_factory=list, max_length=MAX_IMAGES_PER_POST)
    resource_ids: list[int] | None = Field(default=None, max_length=2000)
    # Proxy lines (`#NN`) of a multi-proxy order the case is about.
    proxy_line_nos: list[ProxyLineNo] | None = Field(default=None, max_length=MAX_PROXY_LINES)
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=128)

    @field_validator("resource_ids")
    @classmethod
    def unique_resource_ids(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and (not value or len(set(value)) != len(value)):
            raise ValueError("resource_ids must be non-empty and unique")
        return value

    @field_validator("proxy_line_nos")
    @classmethod
    def unique_proxy_lines(cls, value: list[int] | None) -> list[int] | None:
        return _unique_lines(value)

    @field_validator("evidence")
    @classmethod
    def bound_evidence(cls, value):
        return bounded_mapping(value, max_keys=20, max_bytes=8192) if value is not None else value


class AdminDisputeAction(BaseModel):
    admin_note: str = Field(default="", max_length=2000)

    @field_validator("admin_note")
    @classmethod
    def strip_admin_note(cls, value: str) -> str:
        return value.strip()


class AdminDisputePartialRefund(BaseModel):
    admin_note: str = Field(default="", max_length=2000)
    refund_amount: int = Field(ge=1)

    @field_validator("admin_note")
    @classmethod
    def strip_admin_note(cls, value: str) -> str:
        return value.strip()


class AdminDisputeExtendWarranty(BaseModel):
    admin_note: str = Field(default="", max_length=2000)
    extra_days: int = Field(ge=1, le=365)

    @field_validator("admin_note")
    @classmethod
    def strip_admin_note(cls, value: str) -> str:
        return value.strip()


class SellerDisputeRespond(BaseModel):
    seller_note: str = Field(min_length=1, max_length=2000)
    attachments: list[MediaId] = Field(default_factory=list, max_length=MAX_IMAGES_PER_POST)


class DisputeClaimAppend(BaseModel):
    resource_ids: list[int] = Field(default_factory=list, max_length=2000)
    proxy_line_nos: list[ProxyLineNo] | None = Field(default=None, max_length=MAX_PROXY_LINES)
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=128)

    @field_validator("resource_ids")
    @classmethod
    def unique_claim_resources(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise ValueError("resource_ids must be unique")
        return value

    @field_validator("proxy_line_nos")
    @classmethod
    def unique_proxy_lines(cls, value: list[int] | None) -> list[int] | None:
        return _unique_lines(value)

    @model_validator(mode="after")
    def names_something(self) -> "DisputeClaimAppend":
        if not self.resource_ids and not self.proxy_line_nos:
            raise ValueError("a claim batch names at least one account or proxy line")
        return self


class DisputeMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    attachments: list[MediaId] = Field(default_factory=list, max_length=MAX_IMAGES_PER_POST)
    idempotency_key: str = Field(min_length=8, max_length=128)


class SellerResourceAction(BaseModel):
    resource_ids: list[int] = Field(min_length=1, max_length=2000)
    action: str = Field(pattern="^(replace|refund)$")
    replacement_resource_ids: list[int] | None = Field(default=None, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=128)
    seller_note: str | None = Field(default=None, max_length=2000)

    @field_validator("resource_ids", "replacement_resource_ids")
    @classmethod
    def unique_resources(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and len(set(value)) != len(value):
            raise ValueError("resource IDs must be unique")
        return value


class ProxyLineAction(BaseModel):
    """Seller (`/seller/disputes/{id}/proxies/action`) and Marketplace
    (`/admin/disputes/{id}/proxies/refund`) per-proxy remedy."""

    line_nos: list[ProxyLineNo] = Field(min_length=1, max_length=MAX_PROXY_LINES)
    action: str = Field(pattern="^refund$")
    idempotency_key: str = Field(min_length=8, max_length=128)
    seller_note: str | None = Field(default=None, max_length=2000)

    @field_validator("line_nos")
    @classmethod
    def unique_lines(cls, value: list[int]) -> list[int]:
        return _unique_lines(value)


class SellerDisputeEscalate(BaseModel):
    seller_note: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=128)

    @field_validator("seller_note")
    @classmethod
    def meaningful_seller_note(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("seller_note must not be empty")
        return value


class DisputeEscalate(BaseModel):
    note: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=128)

    @field_validator("note")
    @classmethod
    def meaningful_note(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("note must not be empty")
        return value


class DisputeResponse(BaseModel):
    id: int
    order_id: int
    order_code: str | None = None
    buyer_id: int
    reason: str
    evidence_type: str | None = None
    evidence: dict[str, str] | None = None
    # PrivateImage shapes; served by GET /orders/{ref}/dispute/evidence/{media_id}.
    evidence_images: list[dict] = []
    status: str
    admin_note: str | None
    seller_note: str | None = None
    created_at: datetime
    resolution_offered_at: datetime | None = None
    resolution_deadline_at: datetime | None = None
    escrow_expires_at: datetime | None = None
    abandon_after_at: datetime | None = None
    review_requested_at: datetime | None = None
    seller_deadline_at: datetime | None = None
    seller_responded_at: datetime | None = None
    resolved_at: datetime | None
    product_title: str | None = None
    variant_name: str | None = None
    buyer_email: str | None = None
    order_amount: int | None = None
    # Cả đơn đã hoàn bao nhiêu (gồm cả hoàn trước khiếu nại, vd giao thiếu proxy).
    refunded_amount: int = 0
    # Phần hoàn kể từ khi mở khiếu nại này — con số hiển thị trong hồ sơ khiếu nại.
    dispute_refunded_amount: int = 0
    claimed_resource_ids: list[int] = Field(default_factory=list)
    warranty_claimable_ids: list[int] = Field(default_factory=list)
    resource_actions: list[dict] = Field(default_factory=list)
    # Proxy lines (`#NN`) named by the buyer, and the per-line remedies.
    claimed_proxy_lines: list[int] = Field(default_factory=list)
    proxy_actions: list[dict] = Field(default_factory=list)
    timeline: list[dict] = Field(default_factory=list)
    marketplace_conversation_id: UUID | None = None

    model_config = {"from_attributes": True}


class DisputeListResponse(BaseModel):
    items: list[DisputeResponse]
    total: int
    page: int
    per_page: int


class DisputeResourceInfo(BaseModel):
    id: int
    status: str
    expires_at: datetime | None


class DisputeOrderInfo(BaseModel):
    id: int
    order_code: str | None = None
    buyer_id: int
    seller_id: int
    variant_id: int | None
    quantity: int
    total_amount: int
    status: str
    escrow_expires_at: datetime | None
    delivered_data: str | None
    created_at: datetime
    product_title: str | None
    variant_name: str | None
    buyer_email: str | None
    seller_email: str | None


class DisputeTimelineEvent(BaseModel):
    event: str
    timestamp: datetime


class DisputeResponseFull(BaseModel):
    id: int
    order_id: int
    order_code: str | None = None
    buyer_id: int
    reason: str
    evidence_type: str | None = None
    evidence: dict[str, str] | None = None
    # PrivateImage shapes; served by GET /orders/{ref}/dispute/evidence/{media_id}.
    evidence_images: list[dict] = []
    status: str
    admin_note: str | None
    seller_note: str | None = None
    created_at: datetime
    resolution_offered_at: datetime | None = None
    resolution_deadline_at: datetime | None = None
    abandon_after_at: datetime | None = None
    review_requested_at: datetime | None = None
    seller_deadline_at: datetime | None = None
    seller_responded_at: datetime | None = None
    resolved_at: datetime | None
    order: DisputeOrderInfo
    resources: list[DisputeResourceInfo]
    timeline: list[DisputeTimelineEvent]

    model_config = {"from_attributes": True}


# ── Admin case file (GET /admin/disputes/{id}/case) ─────────────────────────

class AdminCaseParty(BaseModel):
    id: int
    name: str
    email: str
    is_internal: bool
    is_active: bool
    tier: str
    created_at: datetime
    href: str


class AdminCaseLine(BaseModel):
    # Stock lines carry the resource id; proxy lines are addressed by `line` only.
    id: int | None = None
    kind: str = "resource"  # resource | proxy
    line: str
    # Proxy rows only: the line number (`#NN` → NN) and that line's refund cap.
    line_no: int | None = None
    refund_amount_cap: int | None = None
    status: str
    expires_at: datetime | None = None
    state: str  # claimed | replaced | refunded | replacement | ok
    claimed: bool
    warranty_claimable: bool
    replacement_resource_id: int | None = None
    refunded: bool = False
    refund_amount: int = 0


class AdminCaseSignal(BaseModel):
    code: str
    tone: str  # good | info | warn | bad
    text: str


class AdminCaseRecommendation(BaseModel):
    action: str  # refund | partial_refund | reject | review | wait | none
    text: str
    amount: int | None = None


class AdminDisputeCase(DisputeResponse):
    order: dict
    buyer: AdminCaseParty | None
    seller: AdminCaseParty | None
    buyer_record: dict
    seller_record: dict
    money: dict
    lines: list[AdminCaseLine]
    conversations: list[dict]
    # Buyer↔seller order chat (last 200 messages) for the admin's review.
    order_chat: dict | None = None
    signals: list[AdminCaseSignal]
    recommendation: AdminCaseRecommendation
