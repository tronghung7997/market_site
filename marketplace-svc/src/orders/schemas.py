from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from src.security.input_limits import bounded_mapping


class OrderCreate(BaseModel):
    variant_id: int | None = None
    quantity: int = Field(default=1, ge=1, le=100)
    product_id: int | None = None
    user_config: dict | None = None

    @field_validator("user_config")
    @classmethod
    def bound_user_config(cls, value):
        return bounded_mapping(value) if value is not None else value

    @model_validator(mode="after")
    def check_flow(self):
        if self.variant_id and self.product_id:
            raise ValueError("Provide variant_id OR (product_id + user_config), not both")
        if not self.variant_id and not self.product_id:
            raise ValueError("Provide variant_id or (product_id + user_config)")
        if self.product_id and not self.user_config:
            raise ValueError("user_config is required when using product_id")
        return self


class ManualDeliverRequest(BaseModel):
    data: str = Field(min_length=1, max_length=20000)


class OrderResponse(BaseModel):
    id: int
    buyer_id: int
    seller_id: int
    variant_id: int | None = None
    product_id: int | None = None
    quantity: int
    total_amount: int
    # Display-only FX (VND per 1 USD) at purchase. null = pre-rollout order.
    display_fx_rate_snapshot: int | None = None
    status: str
    escrow_expires_at: datetime | None
    delivered_data: str | None
    cancel_reason: str | None = None
    created_at: datetime
    product_title: str | None = None
    pricing_strategy: str | None = None
    delivery_mode: str | None = None
    sla_hours: int | None = None
    variant_name: str | None = None
    buyer_email: str | None = None
    seller_email: str | None = None
    has_review: bool = False
    has_dispute: bool = False
    dispute_status: str | None = None
    service_type: str | None = None
    fulfillment: "FulfillmentInfo | None" = None
    settlement: "SettlementInfo | None" = None
    protection: "ProtectionInfo | None" = None
    capabilities: "OrderCapabilities | None" = None
    task_progress: "TaskProgress | None" = None

    model_config = {"from_attributes": True}


class FulfillmentInfo(BaseModel):
    """Buyer-facing delivery projection; it does not replace the financial order state."""

    kind: str
    status: str


class SettlementInfo(BaseModel):
    status: str


class ProtectionInfo(BaseModel):
    status: str


class OrderCapabilities(BaseModel):
    can_confirm: bool = False
    can_dispute: bool = False
    can_review: bool = False
    can_chat: bool = False
    can_view_proxy: bool = False


class TaskProgress(BaseModel):
    total: int
    pending: int
    assigned: int
    processing: int
    completed: int
    failed: int


class TimelineEvent(BaseModel):
    event: str
    timestamp: datetime


class ResourceInfo(BaseModel):
    id: int
    status: str
    expires_at: datetime | None

    model_config = {"from_attributes": True}


class DisputeInfo(BaseModel):
    id: int
    reason: str
    status: str
    admin_note: str | None
    created_at: datetime
    resolved_at: datetime | None

    model_config = {"from_attributes": True}


class UsageRecordInfo(BaseModel):
    id: int
    endpoint: str
    units: int
    status: str
    created_at: datetime


class UsageSummaryInfo(BaseModel):
    units_total: int
    units_used: int
    units_remaining: int
    expires_at: datetime | None
    records: list[UsageRecordInfo] = []


class AdminOrderDetailResponse(OrderResponse):
    resources: list[ResourceInfo] = []
    dispute: DisputeInfo | None = None
    timeline: list[TimelineEvent] = []
    usage: UsageSummaryInfo | None = None


class PaginatedOrderResponse(BaseModel):
    items: list[OrderResponse]
    total: int
    page: int
    per_page: int


class OrderStatsResponse(BaseModel):
    total: int
    active: int
    disputed: int
    total_spend: int
