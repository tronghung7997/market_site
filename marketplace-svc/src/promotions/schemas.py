from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from src.models.promotion import DiscountType

# What an admin may type as a campaign code (after trim + upper-case).
CODE_PATTERN = r"^[A-Z0-9_-]{3,32}$"
MAX_MONEY = 2_000_000_000

ListState = Literal["running", "scheduled", "paused", "ended", "exhausted", "attention", "done", "archived"]
ListSort = Literal["updated", "uses", "ends_soon"]


class PromotionPatch(BaseModel):
    """Body of POST (create) and PATCH (partial edit). Types only: the
    business rules live in ``promotions.validation`` so every refusal comes
    back as one field-keyed 422 (``{code: "validation", fields: {...}}``)."""

    code: str | None = None
    name: str | None = None
    note: str | None = None
    discount_type: DiscountType | None = None
    discount_value: int | None = None
    max_discount_amount: int | None = None
    min_order_amount: int | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    usage_limit: int | None = None
    per_buyer_limit: int | None = None
    budget_amount: int | None = None
    category_ids: list[int] | None = Field(default=None, max_length=200)
    new_buyers_only: bool | None = None
    is_active: bool | None = None


class PromotionAdmin(BaseModel):
    id: int
    code: str
    name: str
    note: str | None
    discount_type: DiscountType
    discount_value: int
    max_discount_amount: int | None
    min_order_amount: int
    starts_at: datetime | None
    ends_at: datetime | None
    usage_limit: int | None
    per_buyer_limit: int | None
    budget_amount: int | None
    category_ids: list[int]
    new_buyers_only: bool
    is_active: bool
    uses: int
    discount_given: int
    state: Literal["running", "scheduled", "paused", "ended", "exhausted", "archived"]
    archived_at: datetime | None = None
    code_count: int = 0
    codes_redeemed: int = 0
    gmv: int = 0
    attention_reason: Literal["budget", "uses", "ending", "expired_active"] | None = None
    budget_eta_days: float | None = None
    created_at: datetime | None
    updated_at: datetime | None


class PromotionCounts(BaseModel):
    all: int
    running: int
    scheduled: int
    paused: int
    attention: int
    done: int
    archived: int


class PromotionTotals(BaseModel):
    uses: int
    discount: int
    gmv: int


class PromotionPage(BaseModel):
    items: list[PromotionAdmin]
    total: int
    page: int
    per_page: int
    counts: PromotionCounts
    totals_30d: PromotionTotals


class PromotionRedemptionRow(BaseModel):
    id: int
    order_id: int
    order_code: str
    order_status: str
    buyer_id: int
    buyer_email: str
    code: str | None
    discount_amount: int
    order_total: int
    created_at: datetime


class PromotionRedemptionPage(BaseModel):
    items: list[PromotionRedemptionRow]
    total: int
    page: int
    per_page: int


class PromotionStatsPoint(BaseModel):
    date: str
    uses: int
    discount: int
    gmv: int


class PromotionStats(BaseModel):
    series: list[PromotionStatsPoint]
    uses: int
    discount: int
    gmv: int
    new_buyers: int


class PromotionCodesCreate(BaseModel):
    count: int = Field(ge=1, le=5000)
    prefix: str = Field(default="", max_length=12, pattern=r"^[A-Za-z0-9-]*$")
    length: int = Field(default=8, ge=6, le=12)


class PromotionCodesCreated(BaseModel):
    created: int


class PromotionCodeRow(BaseModel):
    code: str
    redeemed_at: datetime | None
    order_code: str | None
    created_at: datetime


class PromotionCodePage(BaseModel):
    items: list[PromotionCodeRow]
    total: int
    page: int
    per_page: int
