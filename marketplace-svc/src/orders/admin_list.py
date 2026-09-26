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
    search = _search_conditions(q)
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
