"""Buyer tiers (alembic kc…): admin settings, tier history and cashback.

The tier itself is ``accounts.buyer_tier`` (l1 / l2 / l3). The settings
document (criterion, thresholds, cashback %, API limits, names) is validated
by src/buyer_tiers/config.py, which also holds the defaults.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base

BUYER_TIERS = ("l1", "l2", "l3")
_TIERS = "('l1', 'l2', 'l3')"


class BuyerTierConfig(Base):
    __tablename__ = "buyer_tier_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    settings: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class BuyerTierEvent(Base):
    __tablename__ = "buyer_tier_events"
    __table_args__ = (
        CheckConstraint(f"old_tier IN {_TIERS}", name="ck_buyer_tier_events_old_tier"),
        CheckConstraint(f"new_tier IN {_TIERS}", name="ck_buyer_tier_events_new_tier"),
        CheckConstraint("old_tier != new_tier", name="ck_buyer_tier_events_changed"),
        Index("ix_buyer_tier_events_account", "account_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    old_tier: Mapped[str] = mapped_column(String(10), nullable=False)
    new_tier: Mapped[str] = mapped_column(String(10), nullable=False)
    # total_deposit | total_spent, and its value (VND) when the tier changed.
    criterion: Mapped[str | None] = mapped_column(String(20), nullable=True)
    metric_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class BuyerCashback(Base):
    """One row per settled order that paid the buyer cashback. The wallet
    side is a ``cashback`` transaction referenced ``order-<id>``; a later full
    refund books ``cashback_clawback`` and sets ``clawed_back_at``."""

    __tablename__ = "buyer_cashbacks"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_buyer_cashbacks_amount"),
        CheckConstraint("rate_percent > 0 AND rate_percent <= 100", name="ck_buyer_cashbacks_rate"),
        Index("ix_buyer_cashbacks_buyer", "buyer_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), unique=True, nullable=False)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    tier: Mapped[str] = mapped_column(String(10), nullable=False)
    rate_percent: Mapped[float] = mapped_column(Float, nullable=False)
    base_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    clawed_back_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # What the clawback actually recovered from the wallet (may be less).
    clawback_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
