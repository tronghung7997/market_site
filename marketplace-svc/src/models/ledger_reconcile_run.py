from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class LedgerReconcileRun(Base):
    """One execution of the ledger reconciliation (nightly job or admin
    "run now"). `findings` holds the first few hundred mismatches verbatim so
    the report can be read after the fact without re-running it."""
    __tablename__ = "ledger_reconcile_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    ran_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    trigger: Mapped[str] = mapped_column(String(20), nullable=False, default="schedule")  # schedule | manual
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    wallets_checked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    orders_checked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    mismatch_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    totals: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    findings: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
