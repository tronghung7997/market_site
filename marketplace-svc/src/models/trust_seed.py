"""Seeded-liquidity batches: admin-authored demo reviews on a real product.

Every generated review belongs to a batch so the whole thing stays reversible
with one click. The rows it writes (accounts, orders, reviews) all carry
``is_seeded = true``; financial reporting filters on that flag so seeded
volume can never leak into GMV, dispute rate, seller tiering, commission or
wallet reconciliation.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class TrustSeedBatch(Base):
    __tablename__ = "trust_seed_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)

    # applied | purged. Drafts are never persisted: preview returns them to the
    # admin, who edits and posts them back to apply.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="applied")

    review_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # ai | manual — how the accepted copy was produced, for the audit trail.
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="ai")
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    locale: Mapped[str] = mapped_column(String(8), nullable=False, default="vi")
    # Exact prompt used, so a batch can be explained months later.
    prompt_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Requested star distribution / date window / options as submitted.
    options_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    created_by_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    purged_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
