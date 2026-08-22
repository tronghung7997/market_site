"""Singleton runtime config for deposit rails (SePay + NOWPayments).

Secrets (API keys, IPN secret) stay in env only.
This table holds operational toggles and limits admin can change without redeploy.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class DepositRailConfig(Base):
    __tablename__ = "deposit_rail_config"

    # Singleton: always id=1.
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Feature flags (still require provider secrets for the rail to actually work).
    sepay_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true",
    )
    nowpayments_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false",
    )

    # SePay destination (admin-editable; secrets remain in env). The number is
    # the QR beneficiary (real account or official VA); the UUID is its parent
    # SePay bank account, never the VA UUID.
    sepay_bank_code: Mapped[str] = mapped_column(String(32), nullable=False, server_default="")
    sepay_bank_account_number: Mapped[str] = mapped_column(String(64), nullable=False, server_default="")
    sepay_bank_account_name: Mapped[str] = mapped_column(String(160), nullable=False, server_default="")
    sepay_bank_account_id: Mapped[str] = mapped_column(String(128), nullable=False, server_default="")

    # SePay VND limits / windows
    deposit_min_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    deposit_max_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    deposit_expire_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    deposit_reconcile_retention_hours: Mapped[int] = mapped_column(Integer, nullable=False)

    # NOW USDT limits / windows
    deposit_usdt_min_vnd: Mapped[int] = mapped_column(Integer, nullable=False)
    deposit_usdt_max_vnd: Mapped[int] = mapped_column(Integer, nullable=False)
    deposit_usdt_local_window_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    deposit_usdt_reconcile_retention_hours: Mapped[int] = mapped_column(Integer, nullable=False)

    # Legacy columns: hosted checkout trusts NOW coin settings; not exposed/admin-edited.
    nowpayments_default_pay_currency: Mapped[str] = mapped_column(String(32), nullable=False)
    nowpayments_allowed_pay_currencies: Mapped[str] = mapped_column(String(256), nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
