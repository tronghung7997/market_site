"""Admin-tunable levers per seller tier (Settings › Sellers › Tiers).

One row per tier (new / verified / trusted / enterprise). NULL on a limit
column means "no limit". Replaces the constants that used to live in
src/sellers/tiers.py; those remain only as the seed for a fresh database.
"""
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class SellerTierConfig(Base):
    __tablename__ = "seller_tier_config"

    tier: Mapped[str] = mapped_column(String(20), primary_key=True)
    # Products a seller of this tier may have on sale (status = active) at once.
    max_active_products: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Largest single withdrawal request, VND.
    withdraw_limit_per_request: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Percentage points shaved off the platform fee.
    fee_discount_pp: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Days shaved off the product's escrow hold (never below 1 day or the admin floor).
    escrow_reduction_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
