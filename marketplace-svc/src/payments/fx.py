"""Deposit FX helpers: target VND → USD quote for NOWPayments (price_currency=usd)."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP, ROUND_DOWN


def vnd_to_usd_quote(amount_vnd: int, vnd_per_usd: int) -> Decimal:
    """Convert ledger VND integer to USD amount sent as NOW price_amount.

    Uses Decimal with 6 decimal places (matches quoted_usd_amount column).
    """
    if amount_vnd <= 0:
        raise ValueError("amount_vnd must be positive")
    if vnd_per_usd <= 0:
        raise ValueError("vnd_per_usd must be positive")
    usd = Decimal(amount_vnd) / Decimal(vnd_per_usd)
    return usd.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def quote_drift_pct(snapshot_rate: int, live_rate: int) -> Decimal:
    """Absolute percent change of live rate vs snapshot. 2.0 means 2%."""
    if snapshot_rate <= 0:
        return Decimal("0")
    snap = Decimal(snapshot_rate)
    live = Decimal(live_rate)
    return (abs(live - snap) / snap * Decimal(100)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP,
    )


def underpay(actually_paid: Decimal, pay_amount: Decimal) -> bool:
    """True if received crypto is strictly less than required pay_amount."""
    return actually_paid < pay_amount


def floor_crypto_display(amount: Decimal, places: int = 8) -> Decimal:
    q = Decimal(10) ** -places
    return amount.quantize(q, rounding=ROUND_DOWN)
