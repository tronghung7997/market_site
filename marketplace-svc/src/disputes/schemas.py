from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from src.security.input_limits import bounded_mapping


class DisputeCreate(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)
    evidence_type: str | None = Field(default=None, max_length=50)
    evidence: dict[str, str] | None = None
    resource_ids: list[int] | None = Field(default=None, max_length=2000)
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=128)

    @field_validator("resource_ids")
    @classmethod
    def unique_resource_ids(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and (not value or len(set(value)) != len(value)):
            raise ValueError("resource_ids must be non-empty and unique")
        return value

    @field_validator("evidence")
    @classmethod
    def bound_evidence(cls, value):
        return bounded_mapping(value, max_keys=20, max_bytes=8192) if value is not None else value


class AdminDisputeAction(BaseModel):
    admin_note: str = Field(min_length=1, max_length=2000)


class AdminDisputePartialRefund(BaseModel):
    admin_note: str = Field(min_length=1, max_length=2000)
    refund_amount: int = Field(ge=1)


class AdminDisputeExtendWarranty(BaseModel):
    admin_note: str = Field(min_length=1, max_length=2000)
    extra_days: int = Field(ge=1, le=365)


class SellerDisputeRespond(BaseModel):
    seller_note: str = Field(min_length=1, max_length=2000)


class DisputeClaimAppend(BaseModel):
    resource_ids: list[int] = Field(min_length=1, max_length=2000)
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=128)

    @field_validator("resource_ids")
    @classmethod
    def unique_claim_resources(cls, value: list[int]) -> list[int]:
        if len(set(value)) != len(value):
            raise ValueError("resource_ids must be unique")
        return value


class DisputeMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
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


class SellerDisputeEscalate(BaseModel):
    seller_note: str = Field(min_length=1, max_length=2000)


class DisputeResponse(BaseModel):
    id: int
    order_id: int
    buyer_id: int
    reason: str
    evidence_type: str | None = None
    evidence: dict[str, str] | None = None
    status: str
    admin_note: str | None
    seller_note: str | None = None
    created_at: datetime
    resolution_offered_at: datetime | None = None
    resolution_deadline_at: datetime | None = None
    escrow_expires_at: datetime | None = None
    resolved_at: datetime | None
    product_title: str | None = None
    variant_name: str | None = None
    buyer_email: str | None = None
    order_amount: int | None = None
    refunded_amount: int = 0
    claimed_resource_ids: list[int] = Field(default_factory=list)
    resource_actions: list[dict] = Field(default_factory=list)
    timeline: list[dict] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class DisputeResourceInfo(BaseModel):
    id: int
    status: str
    expires_at: datetime | None


class DisputeOrderInfo(BaseModel):
    id: int
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
    buyer_id: int
    reason: str
    evidence_type: str | None = None
    evidence: dict[str, str] | None = None
    status: str
    admin_note: str | None
    seller_note: str | None = None
    created_at: datetime
    resolution_offered_at: datetime | None = None
    resolution_deadline_at: datetime | None = None
    resolved_at: datetime | None
    order: DisputeOrderInfo
    resources: list[DisputeResourceInfo]
    timeline: list[DisputeTimelineEvent]

    model_config = {"from_attributes": True}
