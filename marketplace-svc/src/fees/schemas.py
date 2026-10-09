from datetime import datetime

from pydantic import BaseModel, Field


class PlatformAccountCandidate(BaseModel):
    id: int
    email: str


class FeeRuntimeConfigResponse(BaseModel):
    platform_fee_percent: float
    category_fee_percent: dict[str, float]
    escrow_default_hours: int
    # Platform hold floor: no order is held for less (product hold, tier
    # reduction and category floors included).
    escrow_floor_hours: int = 24
    escrow_min_hours: int
    category_escrow_min_hours: dict[str, int]
    withdraw_min_amount: int
    withdraw_fee_fixed: int
    withdraw_fee_percent: float
    dispute_seller_response_hours: int
    dispute_open_window_hours: int = 0
    dispute_evidence_image_required: bool = False
    platform_account_id: int = 1
    platform_account_candidates: list[PlatformAccountCandidate] = []
    updated_at: datetime | None = None
    updated_by_id: int | None = None


class FeeRuntimeConfigUpdate(BaseModel):
    platform_fee_percent: float | None = Field(default=None, ge=0, le=100)
    category_fee_percent: dict[str, float] | None = None
    # Escrow holds are in hours (≤ 90 days).
    escrow_default_hours: int | None = Field(default=None, ge=1, le=2160)
    escrow_floor_hours: int | None = Field(default=None, ge=1, le=720)
    escrow_min_hours: int | None = Field(default=None, ge=0, le=2160)
    category_escrow_min_hours: dict[str, int] | None = None
    withdraw_min_amount: int | None = Field(default=None, ge=0)
    withdraw_fee_fixed: int | None = Field(default=None, ge=0)
    withdraw_fee_percent: float | None = Field(default=None, ge=0, le=100)
    dispute_seller_response_hours: int | None = Field(default=None, ge=0, le=720)
    # Hours after delivery a buyer may open a dispute (0 = until escrow release).
    dispute_open_window_hours: int | None = Field(default=None, ge=0, le=720)
    dispute_evidence_image_required: bool | None = None
    platform_account_id: int | None = Field(default=None, ge=1)


class PublicFeeConfig(BaseModel):
    """What sellers/buyers see before they act: no admin bookkeeping fields."""
    platform_fee_percent: float
    category_fee_percent: dict[str, float]
    escrow_default_hours: int
    # Platform hold floor: no order is held for less (product hold, tier
    # reduction and category floors included).
    escrow_floor_hours: int = 24
    escrow_min_hours: int
    category_escrow_min_hours: dict[str, int]
    withdraw_min_amount: int
    withdraw_fee_fixed: int
    withdraw_fee_percent: float
    dispute_seller_response_hours: int
    dispute_open_window_hours: int = 0
    dispute_evidence_image_required: bool = False


class WithdrawQuote(BaseModel):
    amount: int
    fee_amount: int
    net_amount: int
    min_amount: int
    fee_fixed: int
    fee_percent: float
