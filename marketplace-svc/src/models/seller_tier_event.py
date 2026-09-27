"""One row per seller tier change: who moved the seller, from which tier to
which, and why. Admins read it on the account's "Hạng & uy tín" tab."""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base

_TIERS = "('new', 'verified', 'trusted', 'enterprise')"


class SellerTierEvent(Base):
    __tablename__ = "seller_tier_events"
    __table_args__ = (
        CheckConstraint(f"old_tier IN {_TIERS}", name="ck_seller_tier_events_old_tier"),
        CheckConstraint(f"new_tier IN {_TIERS}", name="ck_seller_tier_events_new_tier"),
        CheckConstraint("old_tier != new_tier", name="ck_seller_tier_events_changed"),
        Index("ix_seller_tier_events_account", "account_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    old_tier: Mapped[str] = mapped_column(String(20), nullable=False)
    new_tier: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
