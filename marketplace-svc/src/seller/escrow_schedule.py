"""When a seller's escrowed money is due to reach their wallet.

Delivered orders release at ``escrow_expires_at`` unless the buyer opens a
dispute first (``scheduler.escrow_release_job``). This module groups those
orders by the seller's local calendar day and estimates the payout with the
same fee rule the release job applies (``fees.service`` category rule minus the
tier discount; 0 % for internal sellers). The estimate can still move: a
dispute, a partial refund or a fee change before the release date all change
what is actually credited.

Seeded (trust-seed) orders never touch a wallet and are left out. The
per-order estimate is ``wallet.service.seller_escrow_estimates``, the same one
behind the wallet's "money from sales on its way" figure, so both agree.
"""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import ErrorCode, api_error
from src.models.order import OrderStatus
from src.wallet.service import seller_escrow_estimates

AWAITING_DELIVERY_STATUSES = (OrderStatus.pending, OrderStatus.processing)
IN_ESCROW_STATUSES = (OrderStatus.delivered, OrderStatus.disputed)


def _zone(tz: str | None) -> ZoneInfo:
    try:
        return ZoneInfo((tz or "UTC").strip())
    except (ZoneInfoNotFoundError, ValueError):
        raise api_error(ErrorCode.DASHBOARD_RANGE_INVALID, http_status.HTTP_400_BAD_REQUEST, detail="Múi giờ không hợp lệ")


def _bucket() -> dict:
    return {"order_count": 0, "gross": 0, "fee": 0, "net": 0}


def _sum(*buckets: dict) -> dict:
    out = _bucket()
    for b in buckets:
        for k in out:
            out[k] += b[k]
    return out


def _add(bucket: dict, gross: int, fee: int) -> None:
    bucket["order_count"] += 1
    bucket["gross"] += gross
    bucket["fee"] += fee
    bucket["net"] += gross - fee


async def get_escrow_schedule(seller_id: int, tz: str | None, db: AsyncSession, *, now: datetime | None = None) -> dict:
    zone = _zone(tz)
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(zone).date()
    days: dict[str, dict] = {}
    held = _bucket()
    awaiting = _bucket()
    no_deadline = _bucket()
    in_escrow = _bucket()
    for e in await seller_escrow_estimates(seller_id, db):
        if e.status in AWAITING_DELIVERY_STATUSES:
            _add(awaiting, e.gross, e.fee)
            continue
        if e.disputed or e.status == OrderStatus.disputed:
            _add(held, e.gross, e.fee)
            continue
        _add(in_escrow, e.gross, e.fee)
        if e.expires_at is None:
            # Legacy delivered orders without a deadline settle only when the buyer confirms.
            _add(no_deadline, e.gross, e.fee)
            continue
        # Past-due rows are waiting for the next run of the release job.
        day = max(e.expires_at.astimezone(zone).date(), today).isoformat()
        _add(days.setdefault(day, _bucket()), e.gross, e.fee)

    return {
        "tz": str(zone.key),
        "days": [{"date": day, **days[day]} for day in sorted(days)],
        "in_escrow": in_escrow,
        "held_by_dispute": held,
        "awaiting_delivery": awaiting,
        "no_deadline": no_deadline,
        # Every unsettled sale: equals the wallet's `escrow_incoming`.
        "total": _sum(in_escrow, held, awaiting),
    }
