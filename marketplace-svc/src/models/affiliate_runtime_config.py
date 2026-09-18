"""Singleton admin-tunable affiliate programme knobs.

Replaces the env-only `DEFAULT_AFFILIATE_COMMISSION_PERCENT` (env remains the
seed for a fresh database). Commission is a share of the platform fee, never
of the order total, so a 0 % fee category cannot leak money to referrers.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class AffiliateRuntimeConfig(Base):
    __tablename__ = "affiliate_runtime_config"

    # Singleton: always id=1.
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # Referrer's share of the platform fee on each completed order (0–100).
    commission_percent_of_fee: Mapped[float] = mapped_column(Float, nullable=False, default=20.0, server_default="20")
    # How long the `?ref=` cookie attributes a later sign-up to the referrer.
    attribution_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30, server_default="30")
    # Days after the referred account's registration during which its orders
    # still earn commission. 0 = lifetime.
    earning_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Anti-abuse ceiling per referrer per rolling 24 h.
    max_commissions_per_day: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
