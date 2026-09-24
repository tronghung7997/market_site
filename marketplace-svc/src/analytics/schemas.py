import re

from pydantic import BaseModel, field_validator

# Clarity ids are short lowercase alphanumerics (e.g. "abcd1efgh2").
CLARITY_ID_RE = re.compile(r"^[a-z0-9]{6,20}$")


class AnalyticsConfigPublic(BaseModel):
    clarity_project_id: str | None


class AnalyticsConfigAdmin(AnalyticsConfigPublic):
    updated_at: str | None = None
    updated_by_id: int | None = None


class AnalyticsConfigUpdate(BaseModel):
    """Blank / null clears the id (tag off)."""
    clarity_project_id: str | None = None

    @field_validator("clarity_project_id", mode="before")
    @classmethod
    def normalize(cls, value):
        if value is None:
            return None
        value = str(value).strip().lower()
        if not value:
            return None
        if not CLARITY_ID_RE.fullmatch(value):
            raise ValueError("clarity_project_id must be 6–20 letters or digits")
        return value


# ── Business analytics (GET /admin/analytics/business) ──────────────────────

class BusinessRange(BaseModel):
    key: str
    tz: str
    granularity: str
    compare: str
    from_date: str
    to_date: str
    days: int
    compare_from_date: str | None
    compare_to_date: str | None


class BusinessFilters(BaseModel):
    segment: str
    seller_id: int | None
    category_id: int | None
    service_type: str | None


class _Money(BaseModel):
    orders: int
    gmv: int
    refunded: int
    net_gmv: int
    paid_orders: int
    completed: int
    cancelled: int
    open_orders: int
    disputed_orders: int
    refunded_orders: int
    buyers: int
    sellers: int
    new_buyers: int
    new_buyer_gmv: int
    internal_gmv: int
    platform_fee: int
    internal_sales: int
    affiliate_cost: int
    platform_revenue: int
    deposits: int
    withdrawals_paid: int
    signups: int


class BusinessTotals(_Money):
    withdraw_fees: int


class BusinessPoint(_Money):
    date: str
    end_date: str
    partial: bool


class _Breakdown(BaseModel):
    gmv: int
    gmv_prev: int
    paid_orders: int
    paid_orders_prev: int
    refunded: int
    refunded_prev: int
    disputed_orders: int
    orders: int
    cancelled: int
    buyers: int


class SegmentRow(_Breakdown):
    segment: str
    platform_take: int


class TierRow(_Breakdown):
    tier: str
    sellers: int


class CategoryRow(_Breakdown):
    id: int | None
    name: str
    parent_id: int | None
    platform_take: int


class CategoryNode(BaseModel):
    id: int
    name: str
    parent_id: int | None


class ServiceTypeRow(_Breakdown):
    service_type: str
    platform_take: int


class SellerRow(_Breakdown):
    id: int
    name: str
    email: str | None
    is_internal: bool
    tier: str
    platform_take: int


class ProductRow(_Breakdown):
    id: int | None
    title: str
    service_type: str
    seller_id: int | None


class HeatCell(BaseModel):
    dow: int
    hour: int
    orders: int
    gmv: int


class Concentration(BaseModel):
    sellers: int
    top1: float
    top5: float
    top10: float
    hhi: float


class BusinessAnalytics(BaseModel):
    range: BusinessRange
    filters: BusinessFilters
    totals: BusinessTotals
    compare_totals: BusinessTotals | None
    series: list[BusinessPoint]
    compare_series: list[BusinessPoint]
    status: dict[str, int]
    compare_status: dict[str, int] | None
    segments: list[SegmentRow]
    tiers: list[TierRow]
    categories: list[CategoryRow]
    category_tree: list[CategoryNode]
    service_types: list[ServiceTypeRow]
    top_sellers: list[SellerRow]
    declining_sellers: list[SellerRow]
    top_products: list[ProductRow]
    heatmap: list[HeatCell]
    concentration: Concentration
    compare_concentration: Concentration | None
    new_sellers: int


class FilterSeller(BaseModel):
    id: int
    name: str
    email: str
    is_internal: bool
    tier: str


class BusinessFilterOptions(BaseModel):
    sellers: list[FilterSeller]
    categories: list[CategoryNode]
    service_types: list[str]
