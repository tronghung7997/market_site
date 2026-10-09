"""Admin-tunable levers per seller tier (Settings › Sellers › Tiers).

One row per tier (new / verified / trusted / enterprise). NULL on a limit
column means "no limit". Replaces the constants that used to live in
src/sellers/tiers.py; those remain only as the seed for a fresh database.
"""
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class SellerTierConfig(Base):
    __tablename__ = "seller_tier_config"

    tier: Mapped[str] = mapped_column(String(20), primary_key=True)
    # Products a seller of this tier may have on sale (status = active) at once.
    max_active_products: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Largest single withdrawal request, VND.
    withdraw_limit_per_request: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Absolute platform fee % for sellers of this tier (alembic kc…, replaced
    # the old fee_discount_pp). NULL = the platform default from Settings ›
    # Fees & holds. A per-category fee, when set, still wins (fees.service).
    fee_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Hours shaved off the product's escrow hold (never below 24 h — or the
    # product's own shorter hold — nor the admin floor).
    escrow_reduction_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Badge icon (media snapshot) shown next to the names of sellers in this tier.
    badge: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
