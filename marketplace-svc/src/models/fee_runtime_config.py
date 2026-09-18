"""Singleton admin-tunable money rules (Settings › Fees & holds).

Replaces the env-only `PLATFORM_FEE_PERCENT` (env still seeds the first row).
"""
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, func
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
    # Pre-filled hold for new products (sellers may still pick their own per product).
    escrow_default_days: Mapped[int] = mapped_column(Integer, nullable=False, default=2, server_default="2")
    # Hold floor every order obeys regardless of the seller's product setting or tier.
    escrow_min_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # {category_id: days} — a higher floor for risky categories.
    category_escrow_min_days: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, server_default="{}")
    # Withdrawals: smallest request, and the fee taken out of each payout.
    withdraw_min_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    withdraw_fee_fixed: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    withdraw_fee_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
