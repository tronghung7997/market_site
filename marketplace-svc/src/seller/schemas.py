from datetime import datetime

from pydantic import BaseModel, Field


class SellerApplyRequest(BaseModel):
    business_name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    contact: str | None = Field(default=None, max_length=255)


class SellerApplicationResponse(BaseModel):
    id: int
    account_id: int
    business_name: str
    description: str | None
    contact: str | None
    status: str
    reject_reason: str | None
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


class SellerProfileUpdate(BaseModel):
    business_name: str | None = Field(default=None, min_length=2, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    contact: str | None = Field(default=None, max_length=255)


class RejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


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
