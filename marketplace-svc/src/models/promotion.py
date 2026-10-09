"""Promo codes: admin-run campaigns a buyer applies at checkout.

A campaign is data, not code: every rule the checkout checks is a column an
admin sets in /admin/promotions (discount kind and size, cap, minimum order,
time window, usage and budget ceilings, category scope, new buyers only).
The platform funds the discount — see ``wallet.service.release_escrow``.
"""
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, Enum, ForeignKey, Index, Integer, String, Text, func, text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class DiscountType(str, PyEnum):
    percent = "percent"
    fixed = "fixed"


class Promotion(Base):
    __tablename__ = "promotions"
    __table_args__ = (
        CheckConstraint(
            "(discount_type = 'percent' AND discount_value BETWEEN 1 AND 100)"
            " OR (discount_type = 'fixed' AND discount_value > 0)",
            name="ck_promotions_discount_value",
        ),
        CheckConstraint("max_discount_amount IS NULL OR max_discount_amount > 0", name="ck_promotions_max_discount"),
        CheckConstraint("min_order_amount >= 0", name="ck_promotions_min_order"),
        CheckConstraint("usage_limit IS NULL OR usage_limit > 0", name="ck_promotions_usage_limit"),
        CheckConstraint("per_buyer_limit IS NULL OR per_buyer_limit > 0", name="ck_promotions_per_buyer_limit"),
        CheckConstraint("budget_amount IS NULL OR budget_amount > 0", name="ck_promotions_budget"),
        CheckConstraint("ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at", name="ck_promotions_window"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # What the buyer types. Stored upper-case; immutable once redeemed.
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    # Campaign name for the admin console ("Sale 10.10", "Khách mới tháng 9").
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Internal note (who asked, which channel the code went out on).
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    discount_type: Mapped[DiscountType] = mapped_column(Enum(DiscountType, name="promotion_discount_type"), nullable=False)
    # percent: 1–100; fixed: VND off the order.
    discount_value: Mapped[int] = mapped_column(Integer, nullable=False)
    # Ceiling for a percent discount (VND); NULL = no ceiling.
    max_discount_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Order subtotal (before discount) must reach this.
    min_order_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Ceilings over redemptions whose order was not cancelled; NULL = none.
    usage_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    per_buyer_limit: Mapped[int | None] = mapped_column(Integer, nullable=True, default=1, server_default="1")
    budget_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Empty = every category; otherwise the product's category or one of its
    # ancestors must be listed.
    category_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), nullable=False, default=list, server_default="{}")
    # Only buyers with no earlier (non-cancelled) order.
    new_buyers_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Pause switch; a paused code answers like an unknown one.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # Archived campaigns leave the default console list (always paused).
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # KOL campaign: the referrer who earns the commission of every order that
    # uses this code, and who a buyer without a referrer is attributed to on
    # the first such order (``affiliate.service``, alembic kb…).
    affiliate_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", name="fk_promotions_affiliate_account"), nullable=True, index=True,
    )
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PromotionRedemption(Base):
    """One order that used a code. The order row keeps its own snapshot
    (``orders.promo_code`` / ``discount_amount``); this row is what the
    campaign counts. A redemption whose order ends ``cancelled`` gives its
    use back — the buyer never received anything."""
    __tablename__ = "promotion_redemptions"
    __table_args__ = (
        CheckConstraint("discount_amount > 0", name="ck_promotion_redemptions_discount_positive"),
        Index("ix_promotion_redemptions_promotion_buyer", "promotion_id", "buyer_id"),
        Index(
            "ix_promotion_redemptions_affiliate_account_id", "affiliate_account_id",
            postgresql_where=text("affiliate_account_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    promotion_id: Mapped[int] = mapped_column(ForeignKey("promotions.id"), nullable=False)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True, nullable=False)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    discount_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    # The code the buyer typed: the campaign code or one of its child codes.
    code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # The campaign's KOL when the order was placed: this order's commission
    # goes to them, whatever the campaign says later.
    affiliate_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", name="fk_promotion_redemptions_affiliate_account"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PromotionCode(Base):
    """A single-use child code of a multi-code campaign: same offer and
    limits as its parent, usable once. ``redeemed_order_id`` is set in the
    order's transaction under a row lock, so a code can never pay twice; a
    cancelled order does not free it (the code went out once)."""
    __tablename__ = "promotion_codes"
    __table_args__ = (
        Index("ix_promotion_codes_promotion", "promotion_id", "redeemed_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    promotion_id: Mapped[int] = mapped_column(ForeignKey("promotions.id", ondelete="CASCADE"), nullable=False)
    # Upper-case; unique here and never equal to any promotions.code (checked in service).
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    redeemed_order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
