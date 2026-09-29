import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from src.models.promotion import DiscountType

CODE_PATTERN = r"^[A-Z0-9][A-Z0-9_-]{2,31}$"
MAX_MONEY = 2_000_000_000


class PromotionInput(BaseModel):
    """Everything an admin sets on a campaign. The PATCH route merges a
    partial body into the stored values and validates the result with this
    model, so the cross-field rules hold for partial edits too."""

    code: str = Field(min_length=3, max_length=32)
    name: str = Field(min_length=1, max_length=120)
    note: str | None = Field(default=None, max_length=2000)
    discount_type: DiscountType
    discount_value: int = Field(gt=0, le=MAX_MONEY)
    max_discount_amount: int | None = Field(default=None, gt=0, le=MAX_MONEY)
    min_order_amount: int = Field(default=0, ge=0, le=MAX_MONEY)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    usage_limit: int | None = Field(default=None, gt=0, le=10_000_000)
    per_buyer_limit: int | None = Field(default=1, gt=0, le=1000)
    budget_amount: int | None = Field(default=None, gt=0, le=MAX_MONEY)
    category_ids: list[int] = Field(default_factory=list, max_length=200)
    new_buyers_only: bool = False
    is_active: bool = True

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value):
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("code")
    @classmethod
    def check_code(cls, value: str) -> str:
        if not re.match(CODE_PATTERN, value):
            raise ValueError("code: 3–32 letters, digits, '-' or '_', starting with a letter or digit")
        return value

    @field_validator("name", "note", mode="before")
    @classmethod
    def strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("category_ids")
    @classmethod
    def dedupe_categories(cls, value: list[int]) -> list[int]:
        return sorted(set(value))

    @model_validator(mode="after")
    def check_rules(self):
        if self.discount_type == DiscountType.percent:
            if self.discount_value > 100:
                raise ValueError("A percent discount is between 1 and 100")
        elif self.max_discount_amount is not None:
            raise ValueError("A cap only applies to a percent discount")
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        if self.note == "":
            self.note = None
        return self


class PromotionPatch(BaseModel):
    """Partial edit; every field optional (e.g. just `is_active` to pause)."""

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
    category_ids: list[int] | None = None
    new_buyers_only: bool | None = None
    is_active: bool | None = None


class PromotionAdmin(PromotionInput):
    id: int
    uses: int
    discount_given: int
    state: Literal["running", "scheduled", "paused", "ended", "exhausted"]
    created_at: datetime | None
    updated_at: datetime | None


class PromotionRedemptionRow(BaseModel):
    order_id: int
    order_code: str
    order_status: str
    paid_amount: int
    discount_amount: int
    buyer_email: str
    created_at: datetime | None
