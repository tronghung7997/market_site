from datetime import datetime

from pydantic import BaseModel


class DisputeCreate(BaseModel):
    reason: str
    evidence_type: str | None = None
    evidence: dict[str, str] | None = None


class AdminDisputeAction(BaseModel):
    admin_note: str


class AdminDisputePartialRefund(BaseModel):
    admin_note: str
    refund_amount: int


class AdminDisputeExtendWarranty(BaseModel):
    admin_note: str
    extra_days: int


class SellerDisputeRespond(BaseModel):
    seller_note: str


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
    resolved_at: datetime | None
    product_title: str | None = None
    variant_name: str | None = None
    buyer_email: str | None = None
    order_amount: int | None = None

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
    resolved_at: datetime | None
    order: DisputeOrderInfo
    resources: list[DisputeResourceInfo]
    timeline: list[DisputeTimelineEvent]

    model_config = {"from_attributes": True}
