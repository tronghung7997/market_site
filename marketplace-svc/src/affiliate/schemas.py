from datetime import datetime

from pydantic import BaseModel, Field


class ClickRequest(BaseModel):
    code: str = Field(min_length=4, max_length=16)
    path: str | None = Field(default=None, max_length=500)
    referrer: str | None = Field(default=None, max_length=500)
    visitor_id: str | None = Field(None, max_length=64)


class CommissionRow(BaseModel):
    id: int
    order_id: int
    buyer_account_id: int
    rate_percent: float
    amount: int
    created_at: datetime
    product_title: str | None = None
    order_total: int | None = None


class TimeseriesPoint(BaseModel):
    date: str
    clicks: int
    signups: int
    orders: int
    revenue: int
    commission: int


class AffiliateTotals(BaseModel):
    clicks: int
    signups: int
    orders: int
    revenue: int
    commission: int


class ReferredUserRow(BaseModel):
    id: int
    email: str
    created_at: datetime
    order_count: int
    total_spent: int | None = None  # None on the self-service view — only admins see other users' spend


class AffiliateStatsResponse(BaseModel):
    code: str
    link: str
    totals: AffiliateTotals
    timeseries: list[TimeseriesPoint]
    commissions: list[CommissionRow]
    referred_users: list[ReferredUserRow]


class AffiliateSummaryRow(BaseModel):
    id: int
    email: str
    affiliate_code: str
    clicks: int
    signups: int
    orders: int
    commission: int

    model_config = {"from_attributes": True}


class PaginatedAffiliateSummary(BaseModel):
    items: list[AffiliateSummaryRow]
    total: int
    page: int
    per_page: int


class FundEntryRow(BaseModel):
    id: int
    amount: int
    kind: str
    reference_id: str | None = None
    note: str | None = None
    created_at: datetime


class FundOverview(BaseModel):
    balance: int
    total_topped_up: int
    total_paid_out: int
    entries: list[FundEntryRow]


class FundTopupRequest(BaseModel):
    amount: int = Field(ge=1)
    note: str | None = Field(default=None, max_length=500)


class UpdateCodeRequest(BaseModel):
    code: str = Field(min_length=4, max_length=8)


class AffiliateCodeResponse(BaseModel):
    id: int
    affiliate_code: str

    model_config = {"from_attributes": True}
