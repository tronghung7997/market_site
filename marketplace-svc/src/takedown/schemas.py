from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Service = Literal["article_copyright", "profile_impersonation", "profile_copyright", "group_copyright"]


class TakedownCreate(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    note: str | None = Field(default=None, max_length=1900)
    service: Service
    warranty_hours: Literal[24, 72]


class TakedownWarranty(BaseModel):
    note: str = Field(min_length=1, max_length=2000)


class TakedownPrice(BaseModel):
    price: int = Field(gt=0, le=1_000_000_000)


class TakedownRequestOut(BaseModel):
    code: str
    url: str
    note: str | None
    service: str
    platform: str
    warranty_hours: int
    status: str
    price: int | None
    warranty_until: datetime | None
    # Which partner screenshots exist ("live", "dead"); bytes come from .../evidence/{kind}.
    evidence: list[str]
    created_at: datetime
    quoted_at: datetime | None
    accepted_at: datetime | None
    processing_at: datetime | None
    completed_at: datetime | None
    finished_at: datetime | None
    refunded: bool


class TakedownEventOut(BaseModel):
    source: str
    action: str
    from_status: str | None
    to_status: str | None
    note: str | None
    applied: bool
    created_at: datetime


class TakedownAdminOut(TakedownRequestOut):
    evidence_live_url: str | None
    evidence_dead_url: str | None
    buyer_email: str | None
    partner_order_id: int | None
    partner_status: str | None
    partner_price: int | None
    order_code: str | None
    needs_sync: bool
    sync_error: str | None
    last_synced_at: datetime | None
    updated_at: datetime
    partner_refunded_at: datetime | None


class TakedownAdminDetailOut(TakedownAdminOut):
    events: list[TakedownEventOut]


class TakedownStatusOut(BaseModel):
    configured: bool
    webhook_secret_set: bool
    seller_set: bool
    partner_reachable: bool
