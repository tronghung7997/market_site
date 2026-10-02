"""Admin order console: server-side list, facets and overview figures.

The console used to download every order and filter, count and chart them in
the browser; at marketplace scale that is every order in one response. The
list is paged here, and the overview/report figures are SQL aggregates.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import id_in
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.models.account import Account
from src.models.order import Order, OrderStatus
from src.models.product import Product

ADMIN_ORDERS_PAGE_MAX = 100
FACET_LIMIT = 50
ATTENTION_LIMIT = 8

DONE_STATUSES = (OrderStatus.delivered, OrderStatus.completed)
ACTIVE_STATUSES = (OrderStatus.pending, OrderStatus.processing)
FAILED_STATUSES = (OrderStatus.cancelled, OrderStatus.refunded, OrderStatus.disputed)

_SORTS = {
    "newest": (Order.created_at.desc(), Order.id.desc()),
    "oldest": (Order.created_at.asc(), Order.id.asc()),
    "amount_desc": (Order.total_amount.desc(), Order.id.desc()),
    "amount_asc": (Order.total_amount.asc(), Order.id.asc()),
    "quantity_desc": (Order.quantity.desc(), Order.id.desc()),
    "quantity_asc": (Order.quantity.asc(), Order.id.asc()),
}


def _search_conditions(q: str | None) -> list:
    term = (q or "").strip()
    if not term:
        return []
    like = f"%{term}%"
    matching_accounts = select(Account.id).where(Account.email.ilike(like))
    options = [
        Order.order_code.ilike(like),
        Order.buyer_id.in_(matching_accounts),
        Order.seller_id.in_(matching_accounts),
        Order.product_id.in_(select(Product.id).where(Product.title.ilike(like))),
    ]
    if term.isdigit():
        options.append(Order.id == int(term))
    return [or_(*options)]


async def _facet(db: AsyncSession, column, conditions: list, selected: int | None) -> list[dict]:
    rows = list((await db.execute(
        select(column, func.count(Order.id))
        .where(*conditions)
        .group_by(column)
        .order_by(func.count(Order.id).desc(), column)
        .limit(FACET_LIMIT)
    )).all())
    # The active filter always has its chip, even outside the top entries.
    if selected is not None and selected not in {account_id for account_id, _ in rows}:
        count = await db.scalar(select(func.count(Order.id)).where(*conditions, column == selected)) or 0
        rows.append((selected, count))
    emails = dict((await db.execute(
        select(Account.id, Account.email).where(id_in(Account.id, [account_id for account_id, _ in rows]))
    )).all()) if rows else {}
    return [{"id": account_id, "email": emails.get(account_id), "count": count} for account_id, count in rows]


async def list_admin_orders(
    db: AsyncSession,
    *,
    q: str | None = None,
    statuses: list[str] | None = None,
    buyer_id: int | None = None,
    seller_id: int | None = None,
    sort: str = "newest",
    page: int = 1,
    per_page: int = 20,
) -> dict:
    """One page of orders plus the console's counts: status counts over the
    search/party scope (so tabs show what switching would give), and seller /
    buyer facets that each ignore their own filter."""
    from src.orders.service import _enrich_orders

    per_page = max(1, min(per_page, ADMIN_ORDERS_PAGE_MAX))
    # Seeded rows (demo liquidity, staff test orders) stay out of the console.
    search = [*_search_conditions(q), Order.is_seeded.is_(False)]
    by_buyer = [Order.buyer_id == buyer_id] if buyer_id is not None else []
    by_seller = [Order.seller_id == seller_id] if seller_id is not None else []
    wanted = [OrderStatus(s) for s in statuses or [] if s in OrderStatus.__members__]
    by_status = [Order.status.in_(wanted)] if wanted else []
    scope = [*search, *by_buyer, *by_seller]

    total = await db.scalar(select(func.count(Order.id)).where(*scope, *by_status)) or 0
    by_state = (await db.execute(
        select(Order.status, func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
        .where(*scope).group_by(Order.status)
    )).all()
    status_counts = {state.value: count for state, count, _ in by_state}
    page_ids = list((await db.scalars(
        select(Order.id)
        .where(*scope, *by_status)
        .order_by(*_SORTS.get(sort, _SORTS["newest"]))
        .offset((page - 1) * per_page)
        .limit(per_page)
    )).all())
    orders = []
    if page_ids:
        by_id = {o.id: o for o in (await db.scalars(select(Order).where(id_in(Order.id, page_ids)))).all()}
        orders = [by_id[i] for i in page_ids if i in by_id]
    return {
        "items": await _enrich_orders(orders, db, include_delivery=False),
        "total": total,
        "page": page,
        "per_page": per_page,
        "status_counts": status_counts,
        "scope_value": int(sum(value for _, _, value in by_state)),
        "sellers": await _facet(db, Order.seller_id, [*search, *by_buyer], seller_id),
        "buyers": await _facet(db, Order.buyer_id, [*search, *by_seller], buyer_id),
    }


def _zone(tz: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise api_error(ErrorCode.DASHBOARD_RANGE_INVALID, status.HTTP_400_BAD_REQUEST, detail="Múi giờ không hợp lệ") from None


async def admin_orders_overview(db: AsyncSession, *, tz: str = "Asia/Ho_Chi_Minh", days: int = 14) -> dict:
    """Figures for the admin overview and report pages, in the viewer's time zone."""
    from src.orders.service import _enrich_orders

    zone = _zone(tz)
    now = datetime.now(zone)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    since = today_start - timedelta(days=days - 1)
    done = Order.status.in_(DONE_STATUSES)

    local_day = func.date(func.timezone(tz, Order.created_at))
    daily_rows = {
        day: row for day, *row in (await db.execute(
            select(
                local_day,
                func.count(Order.id).filter(done),
                func.count(Order.id).filter(Order.status.in_(ACTIVE_STATUSES)),
                func.count(Order.id).filter(Order.status.in_(FAILED_STATUSES)),
                func.coalesce(func.sum(Order.total_amount), 0),
                func.coalesce(func.sum(Order.total_amount).filter(done), 0),
            )
            .where(Order.created_at >= since)
            .group_by(local_day)
        )).all()
    }
    daily = []
    for offset in range(days):
        day = (since + timedelta(days=offset)).date()
        done_n, active_n, failed_n, value, done_value = daily_rows.get(day, (0, 0, 0, 0, 0))
        daily.append({
            "date": day.isoformat(), "done": done_n, "active": active_n, "failed": failed_n,
            "value": int(value), "done_value": int(done_value),
        })

    today_count, today_value = (await db.execute(
        select(func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
        .where(Order.created_at >= today_start)
    )).one()
    done_7d_count, done_7d_value = (await db.execute(
        select(func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
        .where(done, Order.created_at >= now - timedelta(days=7))
    )).one()
    all_count, done_count, done_value = (await db.execute(
        select(
            func.count(Order.id),
            func.count(Order.id).filter(done),
            func.coalesce(func.sum(Order.total_amount).filter(done), 0),
        )
    )).one()

    # Needs attention: open disputes first, then the orders in flight longest.
    disputed = list((await db.scalars(
        select(Order).where(Order.status == OrderStatus.disputed)
        .order_by(Order.created_at.asc()).limit(ATTENTION_LIMIT)
    )).all())
    stuck = list((await db.scalars(
        select(Order).where(Order.status.in_(ACTIVE_STATUSES))
        .order_by(Order.created_at.asc()).limit(ATTENTION_LIMIT - len(disputed))
    )).all()) if len(disputed) < ATTENTION_LIMIT else []

    return {
        "today_count": today_count, "today_value": int(today_value),
        "done_7d_count": done_7d_count, "done_7d_value": int(done_7d_value),
        "all_count": all_count, "done_count": done_count, "done_value": int(done_value),
        "daily": daily,
        "attention": await _enrich_orders([*disputed, *stuck], db, include_delivery=False),
    }


STUCK_AFTER = timedelta(minutes=15)
BURST_WINDOW = timedelta(hours=24)
BURST_MIN_ORDERS = 10
BURST_MAX_SPAN = timedelta(minutes=30)
NEW_ACCOUNT_AGE = timedelta(days=7)


async def admin_orders_pulse(db: AsyncSession, *, tz: str = "Asia/Ho_Chi_Minh") -> dict:
    """The order console's header: today vs yesterday, money held in escrow,
    the 7-day dispute rate, and what needs a human now — open disputes, orders
    stuck in flight, and bursts of orders one buyer placed at one shop."""
    from src.models.order import Dispute, DisputeStatus
    from src.orders.service import _enrich_orders

    zone = _zone(tz)
    now = datetime.now(zone)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    real = Order.is_seeded.is_(False)

    async def window(start: datetime, end: datetime) -> tuple[int, int]:
        count, value = (await db.execute(
            select(func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
            .where(real, Order.created_at >= start, Order.created_at < end)
        )).one()
        return count, int(value)

    today = await window(today_start, now + timedelta(seconds=1))
    # Yesterday up to the same clock time, so the morning is not compared to a full day.
    yesterday = await window(today_start - timedelta(days=1), now - timedelta(days=1))

    local_day = func.date(func.timezone(tz, Order.created_at))
    week_start = today_start - timedelta(days=6)
    per_day = dict((await db.execute(
        select(local_day, func.count(Order.id)).where(real, Order.created_at >= week_start).group_by(local_day)
    )).all())
    spark = [per_day.get((week_start + timedelta(days=i)).date(), 0) for i in range(7)]

    escrow_count, escrow_amount, next_release = (await db.execute(
        select(
            func.count(Order.id),
            func.coalesce(func.sum(Order.total_amount - Order.refunded_amount), 0),
            func.min(Order.escrow_expires_at),
        ).where(real, Order.status == OrderStatus.delivered, Order.escrow_expires_at > now)
    )).one()

    week_ago = now - timedelta(days=7)
    orders_7d = await db.scalar(select(func.count(Order.id)).where(real, Order.created_at >= week_ago)) or 0
    disputes_7d = await db.scalar(
        select(func.count(Dispute.id)).join(Order, Order.id == Dispute.order_id)
        .where(real, Dispute.created_at >= week_ago)
    ) or 0

    disputed = list((await db.scalars(
        select(Order).join(Dispute, Dispute.order_id == Order.id)
        .where(real, Dispute.status == DisputeStatus.open)
        .order_by(Dispute.created_at.asc()).limit(ATTENTION_LIMIT)
    )).unique().all())
    stuck = list((await db.scalars(
        select(Order).where(real, Order.status.in_(ACTIVE_STATUSES), Order.created_at < now - STUCK_AFTER)
        .order_by(Order.created_at.asc()).limit(ATTENTION_LIMIT)
    )).all())

    # Bursts: many orders, one buyer, one shop, inside a short span — a bot,
    # a self-dealing shop or a reseller worth knowing about.
    since = now - BURST_WINDOW
    burst_rows = (await db.execute(
        select(
            Order.buyer_id, Order.seller_id, func.count(Order.id),
            func.coalesce(func.sum(Order.total_amount), 0),
            func.min(Order.created_at), func.max(Order.created_at),
        )
        .where(real, Order.created_at >= since)
        .group_by(Order.buyer_id, Order.seller_id)
        .having(func.count(Order.id) >= BURST_MIN_ORDERS)
        .having(func.max(Order.created_at) - func.min(Order.created_at) <= BURST_MAX_SPAN)
        .order_by(func.count(Order.id).desc())
        .limit(ATTENTION_LIMIT)
    )).all()
    party_ids = {pid for row in burst_rows for pid in row[:2]}
    parties = {
        a.id: a for a in (await db.scalars(select(Account).where(id_in(Account.id, list(party_ids))))).all()
    } if party_ids else {}
    bursts = []
    for buyer_id, seller_id, count, amount, first_at, last_at in burst_rows:
        buyer = parties.get(buyer_id)
        seller = parties.get(seller_id)
        buyer_created = buyer.created_at if buyer else None
        bursts.append({
            "buyer_id": buyer_id, "buyer_email": buyer.email if buyer else None,
            "seller_id": seller_id, "seller_email": seller.email if seller else None,
            "count": count, "amount": int(amount), "first_at": first_at, "last_at": last_at,
            "new_buyer": bool(buyer_created and buyer_created > now - NEW_ACCOUNT_AGE),
        })

    return {
        "today_count": today[0], "today_value": today[1],
        "yesterday_count": yesterday[0], "yesterday_value": yesterday[1],
        "spark": spark,
        "escrow_count": escrow_count, "escrow_amount": int(escrow_amount), "next_release_at": next_release,
        "orders_7d": orders_7d, "disputes_7d": disputes_7d,
        "disputed": await _enrich_orders(disputed, db, include_delivery=False),
        "stuck": await _enrich_orders(stuck, db, include_delivery=False),
        "bursts": bursts,
    }
