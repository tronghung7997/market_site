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
    order_code: str | None = None
    buyer_account_id: int
    rate_percent: float
    fee_base_amount: int | None = None
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
    # Whose stats these are — the admin detail page shows it in the header.
    email: str | None = None
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


class AffiliateListSummary(BaseModel):
    accounts: int
    active: int
    clicks: int
    signups: int
    orders: int
    commission: int


class PaginatedAffiliateSummary(BaseModel):
    items: list[AffiliateSummaryRow]
    total: int
    page: int
    per_page: int
    summary: AffiliateListSummary


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


class AffiliateRuntimeConfigResponse(BaseModel):
    enabled: bool
    commission_percent_of_fee: float
    attribution_days: int
    earning_days: int
    max_commissions_per_day: int
    updated_at: datetime | None = None
    updated_by_id: int | None = None


class AffiliateRuntimeConfigUpdate(BaseModel):
    enabled: bool | None = None
    commission_percent_of_fee: float | None = Field(default=None, ge=0, le=100)
    attribution_days: int | None = Field(default=None, ge=1, le=365)
    earning_days: int | None = Field(default=None, ge=0, le=3650)
    max_commissions_per_day: int | None = Field(default=None, ge=1, le=10_000)


class PublicAffiliateConfig(BaseModel):
    enabled: bool
    # Days after a referred sign-up that still earn (0 = lifetime); the fee
    # split itself stays admin-only (test_audit_phase1 pins that).
    earning_days: int = 0
    attribution_days: int
