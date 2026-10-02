from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from src.orders.constants import MAX_ORDER_QUANTITY
from src.security.input_limits import bounded_mapping


class OrderCreate(BaseModel):
    variant_id: int | None = None
    quantity: int = Field(default=1, ge=1, le=MAX_ORDER_QUANTITY)
    # The package price the buyer confirmed. When sent and the price has
    # changed since, the order is refused (ORDER_PRICE_CHANGED) before any
    # money moves. Optional for older clients.
    expected_unit_price: int | None = Field(default=None, ge=0)
    product_id: int | None = None
    user_config: dict | None = None
    # Promo code the buyer typed at checkout (optional). Checked again, under
    # a row lock, when the order is created.
    promo_code: str | None = Field(default=None, max_length=64)

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


class OrderQuoteRequest(OrderCreate):
    """Same body as `POST /orders`; nothing is written."""


class OrderQuoteResponse(BaseModel):
    subtotal_amount: int
    discount_amount: int
    total_amount: int
    promo_code: str | None = None


class ManualDeliverRequest(BaseModel):
    # Length is checked in the service (coded DELIVERY_TOO_LONG, see
    # MANUAL_DELIVERY_MAX_LENGTH) instead of a validation 422 that echoes the text.
    data: str = Field(min_length=1)


class GatewayAccessInfo(BaseModel):
    key: str
    url: str


class OrderResponse(BaseModel):
    id: int
    # Buyer/seller-facing order number; the only reference the UI shows or links.
    order_code: str
    buyer_id: int
    seller_id: int
    variant_id: int | None = None
    product_id: int | None = None
    quantity: int
    # What the buyer paid (after any promo discount) — the escrowed amount.
    total_amount: int
    # Promo code used at checkout and the discount it gave (paid by the
    # platform to the seller at settlement). 0 / null when none.
    promo_code: str | None = None
    discount_amount: int = 0
    # Refunded to the buyer so far (short delivery at fulfilment, disputes).
    refunded_amount: int = 0
    # Display-only FX (VND per 1 USD) at purchase. null = pre-rollout order.
    display_fx_rate_snapshot: int | None = None
    status: str
    escrow_expires_at: datetime | None
    # Delivered text for orders that deliver text (proxies, gateway keys, manual
    # deliveries), on single-order responses only. Orders filled from stock never
    # carry their lines here: `delivery_count` says how many are delivered and
    # they are read from GET /orders/{ref}/resources (paged) or /delivery.txt.
    delivered_data: str | None
    has_delivery: bool = False
    delivery_count: int | None = None
    # Proxies actually delivered (bound lines), which can be fewer than
    # `quantity` after a short delivery. None for non-proxy orders.
    proxy_count: int | None = None
    gateway_access: GatewayAccessInfo | None = None
    cancel_reason: str | None = None
    created_at: datetime
    # Last time the order reached delivered / completed (NULL on older orders).
    delivered_at: datetime | None = None
    completed_at: datetime | None = None
    product_title: str | None = None
    # Public product ref for links: /products/{product_slug}-{product_key}.
    product_slug: str | None = None
    product_key: str | None = None
    # Seller inventory link for the sold package: /seller/inventory/{variant_key}.
    variant_key: str | None = None
    pricing_strategy: str | None = None
    delivery_mode: str | None = None
    sla_hours: int | None = None
    variant_name: str | None = None
    # Counterparty exposure depends on the viewer (see _enrich_orders):
    # buyers get seller_name/seller_path and no seller_email; sellers get a
    # masked buyer_email plus buyer_key; admins get both emails in full.
    buyer_email: str | None = None
    seller_email: str | None = None
    seller_name: str | None = None
    seller_path: str | None = None
    buyer_key: str | None = None
    has_review: bool = False
    has_dispute: bool = False
    dispute_status: str | None = None
    # Open dispute with no seller reply yet — the seller console's "handle now" signal.
    dispute_awaiting_seller: bool = False
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
    can_append_claims: bool = False
    can_request_review: bool = False
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


class SellerOrderCounts(BaseModel):
    all: int
    disputed: int
    action_required: int
    escrow: int
    completed: int
    cancelled: int
    disputes_awaiting_seller: int


class SellerOrderProductFacet(BaseModel):
    id: int
    public_key: str | None = None
    title: str


class PaginatedSellerOrderResponse(PaginatedOrderResponse):
    counts: SellerOrderCounts
    products: list[SellerOrderProductFacet]


class OrderStatsResponse(BaseModel):
    total: int
    active: int
    awaiting_confirm: int
    # Paid and waiting for the seller to deliver (pending + processing).
    awaiting_seller: int = 0
    disputed: int
    cancelled_or_refunded: int
    # Net of refunds: cancelled/refunded orders and partial refunds excluded.
    total_spend: int
    # Earliest protection deadline among orders waiting for confirmation,
    # and that order's public code.
    confirm_deadline: datetime | None = None
    confirm_order_code: str | None = None


# ── Admin order page (GET /admin/orders/{id}/case) ──────────────────────────

class AdminOrderCase(OrderResponse):
    order_status: str
    updated_at: datetime | None = None
    refunded_amount: int = 0
    user_config: dict | None = None
    product_href: str | None = None
    provider: dict | None = None
    buyer: dict | None = None
    seller: dict | None = None
    buyer_record: dict
    seller_record: dict
    money: dict
    ledger: list[dict]
    lines: list[dict]
    disputes: list[dict]
    tasks: list[dict]
    usage: dict | None = None
    events: list[dict]
    notes: list[dict]
    actions: list[dict]


class AdminOrderNote(BaseModel):
    note: str = Field(min_length=3, max_length=2000)

    @field_validator("note")
    @classmethod
    def meaningful(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("note is required")
        return value


class AdminOrderRefund(AdminOrderNote):
    # White-label reason the buyer reads on the order; defaults to a generic one.
    buyer_message: str | None = Field(default=None, max_length=500)


class AdminOrderExtendEscrow(AdminOrderNote):
    days: int = Field(ge=1, le=30)


class AdminOrderRetry(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class AdminOrderFacet(BaseModel):
    id: int
    email: str | None = None
    count: int


class AdminOrderPage(BaseModel):
    items: list[OrderResponse]
    total: int
    page: int
    per_page: int
    # Orders per status over the search + buyer/seller scope (tab badges), and
    # the total amount of that scope.
    status_counts: dict[str, int]
    scope_value: int
    sellers: list[AdminOrderFacet]
    buyers: list[AdminOrderFacet]


class AdminOrdersDay(BaseModel):
    date: str
    done: int
    active: int
    failed: int
    value: int
    done_value: int


class AdminOrdersOverview(BaseModel):
    today_count: int
    today_value: int
    done_7d_count: int
    done_7d_value: int
    all_count: int
    done_count: int
    done_value: int
    daily: list[AdminOrdersDay]
    attention: list[OrderResponse]


class AdminOrderBurst(BaseModel):
    buyer_id: int
    buyer_email: str | None
    seller_id: int
    seller_email: str | None
    count: int
    amount: int
    first_at: datetime
    last_at: datetime
    new_buyer: bool


class AdminOrdersPulse(BaseModel):
    today_count: int
    today_value: int
    # Yesterday up to the same time of day.
    yesterday_count: int
    yesterday_value: int
    spark: list[int]  # orders per day, last 7 days, oldest first
    escrow_count: int
    escrow_amount: int
    next_release_at: datetime | None
    orders_7d: int
    disputes_7d: int
    disputed: list[OrderResponse]
    stuck: list[OrderResponse]
    bursts: list[AdminOrderBurst]
