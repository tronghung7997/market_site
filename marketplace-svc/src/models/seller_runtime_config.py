"""Singleton admin-tunable knobs for the seller workspace.

Holds the numbers that used to be hard-coded per module (SELLER_LOW_STOCK in
products, INVENTORY_LOW_STOCK in resources) so the Products page, the
Inventory page, the overview action strip and notifications all agree on
what "low stock" means.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class SellerRuntimeConfig(Base):
    __tablename__ = "seller_runtime_config"

    # Singleton: always id=1.
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # A package with 0 < available <= threshold is "low stock".
    low_stock_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=20, server_default="20")
    # Hard cap on rows per inventory export / report download.
    inventory_export_row_limit: Mapped[int] = mapped_column(
        Integer, nullable=False, default=50_000, server_default="50000",
    )
    # Buyers may leave a review for this many days after the protection window ends.
    review_window_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30, server_default="30")
    # Orders with no review this many days after purchase get an automatic 5★.
    auto_review_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7, server_default="7")
    auto_review_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
