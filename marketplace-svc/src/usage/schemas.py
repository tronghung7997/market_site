from datetime import datetime

from pydantic import BaseModel, Field


class ChargeUsageRequest(BaseModel):
    endpoint: str = Field(min_length=1, max_length=200)
    units: int = Field(default=1, ge=1, le=10000)
    request_id: str | None = Field(default=None, max_length=64)


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
