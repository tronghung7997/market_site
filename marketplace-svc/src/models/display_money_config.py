"""Singleton runtime config for display FX + UI money/locale prefs.

Ledger amounts stay integer VND. This table stores:
- site-wide FX rate for ≈USD rendering
- default display currency for first-time visitors
- whether buyers may toggle currency / language in the chrome
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class DisplayMoneyConfig(Base):
    __tablename__ = "display_money_config"

    # Singleton: always id=1. No multi-row semantics.
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # VND per 1 USD (e.g. 25500). Integer only — no fractional dong/USD.
    display_fx_rate: Mapped[int] = mapped_column(Integer, nullable=False)
    # First-visit preference when no cookie: "USD" | "VND"
    display_currency_default: Mapped[str] = mapped_column(
        String(3), nullable=False, default="USD", server_default="USD",
    )
    # Show VND|USD switcher in TopNav
    allow_user_toggle: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true",
    )
    # Show EN|VI language switcher in TopNav
    allow_locale_toggle: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false",
    )
    # Buyer-facing FX / VND conversion hints (≈ rate, ledger notes). Off = pure USD chrome.
    show_fx_hints: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
