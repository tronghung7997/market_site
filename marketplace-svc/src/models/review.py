from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True, nullable=False)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # One public reply from the seller who fulfilled the order (editable).
    seller_reply: Mapped[str | None] = mapped_column(Text, nullable=True)
    seller_replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Written by the auto-review job (5★, no comment) when the buyer never
    # rated within the configured number of days after purchase.
    is_auto: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    # Admin moderation: a hidden review leaves the storefront and the
    # product's rating, but the row (and the buyer's "reviewed" state) stays.
    is_hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    hidden_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    hidden_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    hidden_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
