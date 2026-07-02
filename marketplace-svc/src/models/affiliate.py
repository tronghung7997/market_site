from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class AffiliateClick(Base):
    __tablename__ = "affiliate_clicks"

    id: Mapped[int] = mapped_column(primary_key=True)
    affiliate_account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    referrer: Mapped[str | None] = mapped_column(String(500), nullable=True)
    visitor_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AffiliateCommission(Base):
    __tablename__ = "affiliate_commissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True, nullable=False)
    affiliate_account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    buyer_account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    rate_percent: Mapped[float] = mapped_column(Float, nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AffiliateFundEntry(Base):
    """Ledger for the single global affiliate budget.

    Positive amounts are admin top-ups; negative amounts are commission
    draw-downs. The fund balance is SUM(amount) and is allowed to go
    negative (commissions are always paid; a negative balance signals the
    admin must top up).
    """

    __tablename__ = "affiliate_fund_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)  # signed
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # 'topup' | 'commission'
    reference_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
