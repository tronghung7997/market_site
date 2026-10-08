from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from src.media.schemas import MediaId


class SellerApplyRequest(BaseModel):
    business_name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    contact: str | None = Field(default=None, max_length=255)
    # Onboarding answers (all optional; older clients send none of them).
    seller_type: Literal["individual", "business"] | None = None
    category_ids: list[int] | None = Field(default=None, max_length=12)
    experience: Literal["none", "under_1y", "1_3y", "over_3y"] | None = None
    phone: str | None = Field(default=None, max_length=32, pattern=r"^\+?[0-9 .()-]{6,32}$")
    warranty_policy: str | None = Field(default=None, max_length=1000)
    referral_source: Literal["search", "social", "friend", "community", "ads", "other"] | None = None
    accept_rules: bool = False


class SellerApplicationResponse(BaseModel):
    id: int
    account_id: int
    business_name: str
    description: str | None
    contact: str | None
    seller_type: str | None = None
    category_ids: list[int] | None = None
    experience: str | None = None
    phone: str | None = None
    warranty_policy: str | None = None
    referral_source: str | None = None
    rules_accepted_at: datetime | None = None
    status: str
    reject_reason: str | None
    info_request: str | None = None
    info_requested_at: datetime | None = None
    info_responded_at: datetime | None = None
    # Fields the admin asked to fix (wizard highlights them) and the date a
    # rejected applicant may apply again.
    info_fields: list[str] | None = None
    resubmit_after: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class SellerProfileResponse(BaseModel):
    """The seller's own shop identity (approved application + public ref)."""

    business_name: str
    description: str | None
    contact: str | None
    handle: str | None
    canonical_path: str
    seller_tier: str
    # Shop images (PublicImage) or None.
    logo: dict | None = None
    banner: dict | None = None


class SellerProfileUpdate(BaseModel):
    business_name: str | None = Field(default=None, min_length=2, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    contact: str | None = Field(default=None, max_length=255)
    # Upload ids (POST /media/uploads, purposes seller_logo / seller_banner);
    # null removes the image, omitted keeps it.
    logo_id: MediaId | None = None
    banner_id: MediaId | None = None


class RejectRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    # 0 = may apply again right away.
    resubmit_after_days: int = Field(default=0, ge=0, le=90)

    @field_validator("reason")
    @classmethod
    def trimmed_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Cần ghi lý do từ chối")
        return value


InfoField = Literal["description", "warranty_policy", "contact", "categories", "logo_banner"]


class InfoRequest(BaseModel):
    """What the applicant must add; shown to them and mailed."""
    note: str = Field(min_length=1, max_length=1000)
    fields: list[InfoField] = Field(default_factory=list, max_length=5)

    @field_validator("note")
    @classmethod
    def trimmed(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Ghi chú không được để trống")
        return value


class AdminNoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)

    @field_validator("body")
    @classmethod
    def trimmed_body(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Ghi chú không được để trống")
        return value


class AdminNote(BaseModel):
    id: int
    body: str
    author_email: str | None
    created_at: datetime


class ApplicantInfo(BaseModel):
    id: int
    email: str
    email_verified: bool
    created_at: datetime


class AdminSellerApplicationRow(SellerApplicationResponse):
    applicant: ApplicantInfo | None = None
    logo: dict | None = None
    banner: dict | None = None
    reviewed_at: datetime | None = None
    reviewed_by_email: str | None = None
    resubmitted: bool = False
    prior_rejections: int = 0
    risk_count: int = 0


class ApplicationCounts(BaseModel):
    pending: int = 0
    needs_info: int = 0
    approved: int = 0
    rejected: int = 0


class AdminSellerApplicationPage(BaseModel):
    items: list[AdminSellerApplicationRow]
    total: int
    counts: ApplicationCounts
    avg_review_hours: float | None = None


class LinkedAccount(BaseModel):
    id: int
    email: str
    is_active: bool = True


class ApplicationRisk(BaseModel):
    email_verified: bool
    totp_enabled: bool
    account_age_days: int
    orders_bought: int
    spent: int
    disputes_opened: int
    same_phone_accounts: list[LinkedAccount]
    shared_ip_locked_accounts: list[LinkedAccount]


class PriorApplication(BaseModel):
    id: int
    status: str
    reject_reason: str | None
    created_at: datetime


class ApplicationHistoryEntry(BaseModel):
    at: datetime
    kind: Literal["submitted", "info_requested", "resubmitted", "approved", "rejected"]
    actor_email: str | None = None
    text: str | None = None


class AdminSellerApplicationDetail(AdminSellerApplicationRow):
    risk: ApplicationRisk
    prior_applications: list[PriorApplication]
    previous_snapshot: dict | None = None
    history: list[ApplicationHistoryEntry]
    notes: list[AdminNote]


# ---------------------------------------------------------------------------
# GET /seller/dashboard
# Money values are ledger integers (VND); the frontend formats them.
# ---------------------------------------------------------------------------

class DashboardRange(BaseModel):
    key: str  # "7d" | "30d" | "90d" | "custom"
    tz: str
    from_date: str  # YYYY-MM-DD, inclusive, in `tz`
    to_date: str
    compare_from_date: str
    compare_to_date: str
    days: int
    bucket: str  # "day" | "week"


class DashboardWallet(BaseModel):
    available: int
    pending: int
    locked: int


class DashboardMoney(BaseModel):
    gross: int
    gross_prev: int
    net_released: int
    net_released_prev: int
    platform_fee: int
    refunded: int
    refunded_orders: int
    escrow_held: int
    escrow_orders: int
    pending_withdrawals: int
    wallet: DashboardWallet


class DashboardOrders(BaseModel):
    total: int
    total_prev: int
    completed_prev: int
    by_status: dict[str, int]
    completion_rate: float | None
    dispute_count: int
    dispute_rate: float | None
    avg_order_value: int | None


class DashboardPoint(BaseModel):
    date: str  # bucket start, YYYY-MM-DD in `tz`
    orders: int
    gross: int
    net: int
    refunded: int


class DashboardTopProduct(BaseModel):
    id: int
    public_key: str | None = None
    title: str
    service_type: str | None
    status: str
    orders: int
    gross: int
    net: int
    inventory_managed: bool
    total_stock: int
    stock_state: str  # "in_stock" | "low" | "out" | "not_managed"
    rating_avg: float | None
    rating_count: int


class DashboardInventory(BaseModel):
    product_count: int
    active_count: int
    managed_products: int
    total_stock: int
    low_stock: int
    out_of_stock: int


class DashboardCustomers(BaseModel):
    unique_buyers: int
    new_buyers: int
    returning_buyers: int


class DashboardReviews(BaseModel):
    rating_avg: float | None
    rating_count: int
    count_in_range: int


class DashboardActionItem(BaseModel):
    key: str
    severity: str
    label: str
    count: int
    href: str


class SellerDashboardResponse(BaseModel):
    range: DashboardRange
    money: DashboardMoney
    orders: DashboardOrders
    timeseries: list[DashboardPoint]
    top_products: list[DashboardTopProduct]
    inventory: DashboardInventory
    customers: DashboardCustomers
    reviews: DashboardReviews
    action_items: list[DashboardActionItem]


class SellerRuntimeConfigResponse(BaseModel):
    low_stock_threshold: int
    inventory_export_row_limit: int
    review_window_days: int
    auto_review_days: int
    auto_review_enabled: bool
    updated_at: str | None = None
    updated_by_id: int | None = None


class SellerRuntimeConfigUpdate(BaseModel):
    low_stock_threshold: int | None = Field(default=None, ge=1, le=1_000)
    inventory_export_row_limit: int | None = Field(default=None, ge=100, le=500_000)
    review_window_days: int | None = Field(default=None, ge=1, le=365)
    auto_review_days: int | None = Field(default=None, ge=1, le=90)
    auto_review_enabled: bool | None = None


class EscrowBucket(BaseModel):
    """Orders and money in one slice of the escrow schedule. ``gross`` is what
    is still held (total minus refunds); ``fee``/``net`` are the estimate at
    today's fee rules."""
    order_count: int
    gross: int
    fee: int
    net: int


class EscrowScheduleDay(EscrowBucket):
    date: str  # local calendar day (YYYY-MM-DD) in the requested tz


class EscrowScheduleResponse(BaseModel):
    tz: str
    days: list[EscrowScheduleDay]
    in_escrow: EscrowBucket
    held_by_dispute: EscrowBucket
    awaiting_delivery: EscrowBucket
    no_deadline: EscrowBucket
    # in_escrow + held_by_dispute + awaiting_delivery: the wallet's escrow_incoming.
    total: EscrowBucket
