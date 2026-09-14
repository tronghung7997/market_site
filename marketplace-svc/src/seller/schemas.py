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
