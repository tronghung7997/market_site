from datetime import datetime

from pydantic import BaseModel


class ClickRequest(BaseModel):
    code: str
    path: str | None = None
    referrer: str | None = None


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


class AffiliateStatsResponse(BaseModel):
    code: str
    link: str
    totals: AffiliateTotals
    timeseries: list[TimeseriesPoint]
    commissions: list[CommissionRow]
