"""Per-seller platform-fee override, with an expiry or open-ended (alembic kc…, ki…).

Onboarding offer for big sellers ("0 % fee for 3 months + blue tick") or a
standing negotiated fee for one seller (``ends_at`` NULL = no end date). While
it runs the fee calculation uses ``fee_percent`` instead
of the category / tier / platform rule, and ``badge_tier`` (when set) is the
badge shown next to the seller's name if it ranks above their real tier.
One row per seller; granting again replaces it, revoking deletes it. Every
change is in the audit log (event ``seller_fee_promo_changed``).
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class SellerFeePromo(Base):
    __tablename__ = "seller_fee_promos"
    __table_args__ = (
        CheckConstraint("fee_percent >= 0 AND fee_percent <= 100", name="ck_seller_fee_promos_percent"),
        CheckConstraint("badge_tier IS NULL OR badge_tier IN ('verified', 'trusted')", name="ck_seller_fee_promos_badge"),
    )

    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)
    fee_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    # NULL = open-ended: the seller's own fee until an admin changes or revokes it.
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    badge_tier: Mapped[str | None] = mapped_column(String(20), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    granted_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
