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
    # Sign-ups through the ref link within the range (KOL-code buyers are
    # counted on their code in ``promo_codes``).
    signups: int
    # Orders that paid commission within the range.
    orders: int
    # Every real order owed to this referrer placed within the range, settled
    # or still held (cancelled and refunded excluded).
    referred_orders: int = 0
    revenue: int
    # Paid into the wallet within the range.
    commission: int
    # Expected from referred orders still held, right now (not range-bound).
    pending_commission: int = 0
    pending_orders: int = 0
    # All commission credited to the main wallet and not clawed back (all time).
    available_commission: int = 0
    # The referrer's spendable main-wallet balance right now.
    wallet_available: int = 0
    # What an account that is not a seller may withdraw to a bank right now:
    # earned commission less withdrawals already requested, capped by the
    # balance (``affiliate.service.withdrawable_commission``). Sellers
    # withdraw their whole balance under their tier rules instead.
    withdrawable_commission: int = 0


class ReferredUserRow(BaseModel):
    id: int
    email: str
    created_at: datetime
    # Promo code that attached this buyer (None = signed up through the link).
    via_code: str | None = None
    order_count: int
    total_spent: int | None = None  # None on the self-service view — only admins see other users' spend


class CustomTerms(BaseModel):
    """The referrer's own deal; a None field follows the programme default."""
    commission_percent_of_fee: float | None = None
    earning_days: int | None = None


class AffiliatePromoCode(BaseModel):
    code: str
    name: str
    discount_type: str
    discount_value: int
    max_discount_amount: int | None = None
    ends_at: datetime | None = None
    active: bool
    orders: int
    buyers: int
    commission: int


class AffiliateStatsResponse(BaseModel):
    code: str
    link: str
    # Whose stats these are — the admin detail page shows it in the header.
    email: str | None = None
    totals: AffiliateTotals
    timeseries: list[TimeseriesPoint]
    commissions: list[CommissionRow]
    referred_users: list[ReferredUserRow]
    # Only when an admin gave this account its own terms (KOL).
    custom_terms: CustomTerms | None = None
    # ``POST /wallet/withdraw``: a seller withdraws its balance
    # (``seller_balance``), anyone else only its earned commission
    # (``affiliate_commission``, at most ``totals.withdrawable_commission``).
    can_withdraw: bool = False
    withdraw_source: str = "affiliate_commission"
    promo_codes: list[AffiliatePromoCode] = []


class AffiliateSummaryRow(BaseModel):
    id: int
    email: str
    affiliate_code: str
    clicks: int
    signups: int
    orders: int
    commission: int
    custom_percent: float | None = None
    custom_earning_days: int | None = None
    promo_codes: int = 0

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


class AffiliateTermsResponse(BaseModel):
    account_id: int
    commission_percent_of_fee: float | None = None
    earning_days: int | None = None
    note: str | None = None
    updated_at: datetime | None = None
    updated_by_id: int | None = None
    default_commission_percent_of_fee: float
    default_earning_days: int
    effective_commission_percent_of_fee: float
    effective_earning_days: int


class AffiliateTermsUpdate(BaseModel):
    """Both None clears the account's own terms."""
    commission_percent_of_fee: float | None = Field(default=None, ge=0, le=100)
    earning_days: int | None = Field(default=None, ge=0, le=3650)
    note: str | None = Field(default=None, max_length=500)
