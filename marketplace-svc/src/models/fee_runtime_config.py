"""Singleton admin-tunable money rules (Settings › Fees & holds).

Replaces the env-only `PLATFORM_FEE_PERCENT` (env still seeds the first row).
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class FeeRuntimeConfig(Base):
    __tablename__ = "fee_runtime_config"

    # Singleton: always id=1.
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Platform fee on every settled order, before the seller-tier discount.
    platform_fee_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    # {category_id: percent} — replaces the default for products in that category.
    category_fee_percent: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, server_default="{}")
    # Pre-filled hold (hours) for new products (sellers may still pick their own per product).
    escrow_default_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=48, server_default="48")
    # Platform hold floor (hours, 1–720): no hold — a seller's product hold, a
    # tier reduction or a lower category floor — goes under it (alembic ki…).
    escrow_floor_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=24, server_default="24")
    # Hold floor (hours) every order obeys regardless of the seller's product setting or tier.
    escrow_min_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # {category_id: hours} — a higher floor for risky categories.
    category_escrow_min_hours: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, server_default="{}")
    # Withdrawals: smallest request, and the fee taken out of each payout.
    withdraw_min_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    withdraw_fee_fixed: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    withdraw_fee_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    # Hours a seller has to react to a fresh dispute before it is decided
    # against them (full refund). 0 = no deadline.
    dispute_seller_response_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=24, server_default="24")
    # Hours after delivery a buyer may open a dispute; never past the escrow
    # release. 0 = the whole hold.
    dispute_open_window_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # A buyer must attach at least one evidence image to open a dispute.
    dispute_evidence_image_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Admin account whose wallet receives order and withdrawal fees.
    # NULL = account 1 (the historical default).
    platform_account_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
