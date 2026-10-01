from datetime import datetime

from sqlalchemy import CheckConstraint, Index, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class FinancePeriodClose(Base):
    """A closed accounting period (Tài chính › Báo cáo › Chốt kỳ).

    ``snapshot`` freezes the period report as it read when the admin closed
    it; the live report is compared against it later so any change to that
    period's books after the close shows up as a post-close adjustment.
    Periods never overlap (exclusion enforced in ledger.report.close_period
    under an advisory lock; the unique pair stops exact duplicates)."""
    __tablename__ = "finance_period_closes"
    __table_args__ = (
        CheckConstraint("period_end > period_start", name="ck_finance_period_closes_range"),
        Index("ix_finance_period_closes_period", "period_start", "period_end", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    label: Mapped[str] = mapped_column(String(40), nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    closed_by_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Highest transactions.id at close time: rows above it dated inside the
    # period were booked after the close.
    last_transaction_id: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
