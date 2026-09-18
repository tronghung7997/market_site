from datetime import datetime

from pydantic import BaseModel, Field


class FeeRuntimeConfigResponse(BaseModel):
    platform_fee_percent: float
    category_fee_percent: dict[str, float]
    escrow_default_days: int
    escrow_min_days: int
    category_escrow_min_days: dict[str, int]
    withdraw_min_amount: int
    withdraw_fee_fixed: int
    withdraw_fee_percent: float
    updated_at: datetime | None = None
    updated_by_id: int | None = None


class FeeRuntimeConfigUpdate(BaseModel):
    platform_fee_percent: float | None = Field(default=None, ge=0, le=100)
    category_fee_percent: dict[str, float] | None = None
    escrow_default_days: int | None = Field(default=None, ge=0, le=90)
    escrow_min_days: int | None = Field(default=None, ge=0, le=90)
    category_escrow_min_days: dict[str, int] | None = None
    withdraw_min_amount: int | None = Field(default=None, ge=0)
    withdraw_fee_fixed: int | None = Field(default=None, ge=0)
    withdraw_fee_percent: float | None = Field(default=None, ge=0, le=100)


class PublicFeeConfig(BaseModel):
    """What sellers/buyers see before they act: no admin bookkeeping fields."""
    platform_fee_percent: float
    category_fee_percent: dict[str, float]
    escrow_default_days: int
    escrow_min_days: int
    category_escrow_min_days: dict[str, int]
    withdraw_min_amount: int
    withdraw_fee_fixed: int
    withdraw_fee_percent: float


class WithdrawQuote(BaseModel):
    amount: int
    fee_amount: int
    net_amount: int
    min_amount: int
    fee_fixed: int
    fee_percent: float
