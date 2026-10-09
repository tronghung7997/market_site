"""Automatic-tier bookkeeping per seller (alembic kc…).

``locked``: the tier was set by an admin by hand; the daily tier job never
changes it until an admin unlocks it. ``at_risk_since``: first job run that
found the seller below a "keep" criterion of their tier (other than the
dispute rate, which demotes at once); the seller is demoted one step once the
grace period has passed since then. A missing row means unlocked, not at risk.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class SellerTierState(Base):
    __tablename__ = "seller_tier_state"

    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)
    locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    locked_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    at_risk_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Criterion keys that put the seller at risk on the last run.
    at_risk_keys: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
