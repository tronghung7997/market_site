from datetime import datetime

from pydantic import BaseModel


class ChargeUsageRequest(BaseModel):
    endpoint: str
    units: int = 1
    request_id: str | None = None


class InternalChargeUsageRequest(ChargeUsageRequest):
    order_id: int


class ChargeUsageResponse(BaseModel):
    units_total: int
    units_used: int
    units_remaining: int


class UsageRecordItem(BaseModel):
    id: int
    endpoint: str
    units: int
    status: str
    created_at: datetime


class UsageSummaryResponse(BaseModel):
    units_total: int
    units_used: int
    units_remaining: int
    expires_at: datetime | None
    records: list[UsageRecordItem]
