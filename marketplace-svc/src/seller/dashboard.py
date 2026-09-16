"""Seller overview analytics — GET /seller/dashboard.

Everything is computed in SQL for one seller over one date range (plus the
same-length range immediately before it, for deltas). Dates are bucketed in
the seller's browser timezone so "today" on the chart matches the seller's
day, not the server's.

Definitions (also documented in the frontend):
- gross:        Σ total_amount of orders CREATED in range whose payment has
                been captured for the seller: delivered/completed/disputed/
                refunded. Pending/processing (not fulfilled yet) and cancelled
                are excluded.
- refunded:     Σ refunded_amount of those orders (partial + full refunds).
- net_released: Σ purchase_release transactions credited to the seller's
                wallet in range — by RELEASE time, i.e. what actually landed.
- platform_fee: fee taken on the seller's releases in range.
- escrow_held:  snapshot (not range-bound) of delivered/disputed orders still
                waiting for buyer confirmation, minus partial refunds.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import status as http_status
from sqlalchemy import Date, String, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import ErrorCode, api_error
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant
from src.models.resource import Resource, ResourceStatus
from src.models.review import Review
from src.models.wallet import Transaction, TransactionType, Wallet, WithdrawRequest, WithdrawStatus
from src.notifications.service import seller_action_items
from src.pricing.engine import inventory_managed_sql
from src.products.service import seller_inventory_counts
from src.seller.settings import get_low_stock_threshold

PRESET_DAYS = {"7d": 7, "30d": 30, "90d": 90}
# Calendar presets run from the period start up to today (browser tz).
CALENDAR_PRESETS = ("today", "this_week", "this_month", "this_quarter", "this_year")
RANGE_KEYS = tuple(PRESET_DAYS) + CALENDAR_PRESETS + ("custom",)
RANGE_KEY_PATTERN = "^(" + "|".join(RANGE_KEYS) + ")$"
MAX_CUSTOM_DAYS = 366
# Daily buckets stay readable up to a quarter; longer ranges roll up by week.
WEEKLY_BUCKET_FROM_DAYS = 93

GROSS_STATUSES = (
    OrderStatus.delivered, OrderStatus.completed, OrderStatus.disputed, OrderStatus.refunded,
)
ESCROW_STATUSES = (OrderStatus.delivered, OrderStatus.disputed)
ALL_STATUSES = [s.value for s in OrderStatus]


class DashboardRange:
    def __init__(self, key: str, tz: str, from_date: date, to_date: date):
        self.key = key
        self.tz = tz
        self.tzinfo = ZoneInfo(tz)
        self.from_date = from_date
        self.to_date = to_date
        self.days = (to_date - from_date).days + 1
        self.compare_to_date = from_date - timedelta(days=1)
        self.compare_from_date = self.compare_to_date - timedelta(days=self.days - 1)
        self.bucket = "week" if self.days >= WEEKLY_BUCKET_FROM_DAYS else "day"

    def _bound(self, d: date) -> datetime:
        return datetime.combine(d, time.min, tzinfo=self.tzinfo)

    @property
    def start(self) -> datetime:
        return self._bound(self.from_date)

    @property
    def end(self) -> datetime:  # exclusive
        return self._bound(self.to_date + timedelta(days=1))

    @property
    def compare_start(self) -> datetime:
        return self._bound(self.compare_from_date)

    @property
    def compare_end(self) -> datetime:
        return self.start

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "tz": self.tz,
            "from_date": self.from_date.isoformat(),
            "to_date": self.to_date.isoformat(),
            "compare_from_date": self.compare_from_date.isoformat(),
            "compare_to_date": self.compare_to_date.isoformat(),
            "days": self.days,
            "bucket": self.bucket,
        }


def resolve_range(
    range_key: str | None,
    tz: str | None,
    from_date: date | None,
    to_date: date | None,
    *,
    today: date | None = None,
) -> DashboardRange:
    tz = (tz or "UTC").strip()
    try:
        tzinfo = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise api_error(ErrorCode.DASHBOARD_RANGE_INVALID, http_status.HTTP_400_BAD_REQUEST, detail="Múi giờ không hợp lệ")
    key = (range_key or "30d").strip().lower()
    local_today = today or datetime.now(tzinfo).date()
    if key in PRESET_DAYS:
        days = PRESET_DAYS[key]
        return DashboardRange(key, tz, local_today - timedelta(days=days - 1), local_today)
    if key in CALENDAR_PRESETS:
        return DashboardRange(key, tz, _calendar_start(key, local_today), local_today)
    if key != "custom":
        raise api_error(ErrorCode.DASHBOARD_RANGE_INVALID, http_status.HTTP_400_BAD_REQUEST, detail="Khoảng thời gian không hợp lệ")
    if not from_date or not to_date:
        raise api_error(ErrorCode.DASHBOARD_RANGE_INVALID, http_status.HTTP_400_BAD_REQUEST, detail="Cần cả ngày bắt đầu và kết thúc")
    if to_date < from_date:
        raise api_error(ErrorCode.DASHBOARD_RANGE_INVALID, http_status.HTTP_400_BAD_REQUEST, detail="Ngày kết thúc phải sau ngày bắt đầu")
    if to_date > local_today:
        to_date = local_today
    if (to_date - from_date).days + 1 > MAX_CUSTOM_DAYS:
        raise api_error(ErrorCode.DASHBOARD_RANGE_INVALID, http_status.HTTP_400_BAD_REQUEST, detail="Khoảng thời gian tối đa 366 ngày")
    return DashboardRange("custom", tz, from_date, to_date)


def _calendar_start(key: str, today: date) -> date:
    if key == "today":
        return today
    if key == "this_week":
        return today - timedelta(days=today.weekday())
    if key == "this_month":
        return today.replace(day=1)
    if key == "this_quarter":
        return today.replace(month=((today.month - 1) // 3) * 3 + 1, day=1)
    return today.replace(month=1, day=1)


def _local_bucket(column, rng: DashboardRange):
    """Bucket a timestamptz column into local day/week starts (as DATE)."""
    local = func.timezone(rng.tz, column)
    return cast(func.date_trunc(rng.bucket, local), Date)


def _bucket_starts(rng: DashboardRange) -> list[date]:
    if rng.bucket == "day":
        return [rng.from_date + timedelta(days=i) for i in range(rng.days)]
    # ISO week starts (Monday), matching date_trunc('week').
    first = rng.from_date - timedelta(days=rng.from_date.weekday())
    out = []
    cur = first
    while cur <= rng.to_date:
        out.append(cur)
        cur += timedelta(days=7)
    return out


def _order_release_reference():
    return func.concat("order-", cast(Order.id, String))


async def _order_totals(seller_id: int, start: datetime, end: datetime, db: AsyncSession) -> dict:
    row = (await db.execute(
        select(
            func.count(Order.id),
            func.coalesce(func.sum(case((Order.status.in_(GROSS_STATUSES), Order.total_amount), else_=0)), 0),
            func.coalesce(func.sum(case((Order.status.in_(GROSS_STATUSES), Order.refunded_amount), else_=0)), 0),
            func.coalesce(func.sum(case((Order.refunded_amount > 0, 1), else_=0)), 0),
            func.coalesce(func.sum(case((Order.status.in_(GROSS_STATUSES), 1), else_=0)), 0),
            func.coalesce(func.sum(case((Order.status == OrderStatus.completed, 1), else_=0)), 0),
        ).where(Order.seller_id == seller_id, Order.created_at >= start, Order.created_at < end)
    )).one()
    return {
        "total": int(row[0]), "gross": int(row[1]), "refunded": int(row[2]),
        "refunded_orders": int(row[3]), "gross_orders": int(row[4]), "completed": int(row[5]),
    }


async def _status_counts(seller_id: int, rng: DashboardRange, db: AsyncSession) -> dict[str, int]:
    """Orders in range by status. An open dispute is an overlay on a delivered
    order, so it is reported under `disputed` (and not under `delivered`) —
    the same way the orders console and the buyer view label it."""
    open_dispute = Order.id.in_(
        select(Dispute.order_id).where(Dispute.status == DisputeStatus.open)
    )
    effective = case((open_dispute, OrderStatus.disputed.value), else_=cast(Order.status, String)).label("effective")
    rows = (await db.execute(
        select(effective, func.count(Order.id))
        .where(Order.seller_id == seller_id, Order.created_at >= rng.start, Order.created_at < rng.end)
        .group_by(effective)
    )).all()
    counts = {s: 0 for s in ALL_STATUSES}
    for status_value, n in rows:
        counts[str(status_value)] = int(n)
    return counts


async def _release_sums(wallet_id: int, seller_id: int, start: datetime, end: datetime, db: AsyncSession) -> tuple[int, int]:
    net = await db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.wallet_id == wallet_id,
            Transaction.type == TransactionType.purchase_release,
            Transaction.created_at >= start, Transaction.created_at < end,
        )
    )
    fee = await db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0))
        .select_from(Transaction)
        .join(Order, Transaction.reference_id == _order_release_reference())
        .where(
            Order.seller_id == seller_id,
            Transaction.type == TransactionType.platform_fee,
            Transaction.created_at >= start, Transaction.created_at < end,
        )
    )
    return int(net or 0), int(fee or 0)


async def _escrow_snapshot(seller_id: int, db: AsyncSession) -> tuple[int, int]:
    row = (await db.execute(
        select(
            func.coalesce(func.sum(Order.total_amount - Order.refunded_amount), 0),
            func.count(Order.id),
        ).where(Order.seller_id == seller_id, Order.status.in_(ESCROW_STATUSES))
    )).one()
    return int(row[0]), int(row[1])


async def _timeseries(seller_id: int, wallet_id: int, rng: DashboardRange, db: AsyncSession) -> list[dict]:
    order_bucket = _local_bucket(Order.created_at, rng)
    order_rows = (await db.execute(
        select(
            order_bucket.label("bucket"),
            func.count(Order.id),
            func.coalesce(func.sum(case((Order.status.in_(GROSS_STATUSES), Order.total_amount), else_=0)), 0),
            func.coalesce(func.sum(case((Order.status.in_(GROSS_STATUSES), Order.refunded_amount), else_=0)), 0),
        )
        .where(Order.seller_id == seller_id, Order.created_at >= rng.start, Order.created_at < rng.end)
        .group_by("bucket")
    )).all()
    tx_bucket = _local_bucket(Transaction.created_at, rng)
    net_rows = (await db.execute(
        select(tx_bucket.label("bucket"), func.coalesce(func.sum(Transaction.amount), 0))
        .where(
            Transaction.wallet_id == wallet_id,
            Transaction.type == TransactionType.purchase_release,
            Transaction.created_at >= rng.start, Transaction.created_at < rng.end,
        )
        .group_by("bucket")
    )).all()
    points = {d: {"date": d.isoformat(), "orders": 0, "gross": 0, "net": 0, "refunded": 0} for d in _bucket_starts(rng)}
    for bucket, n, gross, refunded in order_rows:
        if bucket in points:
            points[bucket].update(orders=int(n), gross=int(gross), refunded=int(refunded))
    for bucket, net in net_rows:
        if bucket in points:
            points[bucket]["net"] = int(net)
    return [points[d] for d in sorted(points)]


async def _top_products(seller_id: int, rng: DashboardRange, db: AsyncSession, limit: int = 5) -> list[dict]:
    product_id = func.coalesce(Order.product_id, ProductVariant.product_id).label("product_id")
    per_product = (
        select(
            product_id,
            func.count(Order.id).label("orders"),
            func.coalesce(func.sum(case((Order.status.in_(GROSS_STATUSES), Order.total_amount), else_=0)), 0).label("gross"),
        )
        .select_from(Order)
        .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
        .where(Order.seller_id == seller_id, Order.created_at >= rng.start, Order.created_at < rng.end)
        .group_by(product_id)
        .subquery()
    )
    net_per_product = (
        select(
            func.coalesce(Order.product_id, ProductVariant.product_id).label("product_id"),
            func.coalesce(func.sum(Transaction.amount), 0).label("net"),
        )
        .select_from(Transaction)
        .join(Order, Transaction.reference_id == _order_release_reference())
        .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
        .where(
            Order.seller_id == seller_id,
            Transaction.type == TransactionType.purchase_release,
            Order.created_at >= rng.start, Order.created_at < rng.end,
        )
        .group_by(func.coalesce(Order.product_id, ProductVariant.product_id))
        .subquery()
    )
    stock = (
        select(ProductVariant.product_id.label("product_id"), func.count(Resource.id).label("stock"))
        .join(Resource, Resource.variant_id == ProductVariant.id)
        .where(
            ProductVariant.delivery_mode == DeliveryMode.instant,
            Resource.status == ResourceStatus.available,
            Resource.order_id.is_(None),
            Resource.is_archived == False,  # noqa: E712
        )
        .group_by(ProductVariant.product_id)
        .subquery()
    )
    rows = (await db.execute(
        select(
            Product.id, Product.public_key, Product.title, Product.service_type, Product.status,
            Product.rating_avg, Product.rating_count,
            per_product.c.orders, per_product.c.gross,
            func.coalesce(net_per_product.c.net, 0),
            func.coalesce(stock.c.stock, 0),
            inventory_managed_sql(),
        )
        .join(per_product, per_product.c.product_id == Product.id)
        .outerjoin(net_per_product, net_per_product.c.product_id == Product.id)
        .outerjoin(stock, stock.c.product_id == Product.id)
        .order_by(per_product.c.gross.desc(), per_product.c.orders.desc(), Product.id)
        .limit(limit)
    )).all()
    low_stock = await get_low_stock_threshold(db)
    out = []
    for pid, key, title, service_type, status_value, rating_avg, rating_count, orders, gross, net, total_stock, managed in rows:
        managed = bool(managed)
        if not managed:
            stock_state = "not_managed"
        elif total_stock == 0:
            stock_state = "out"
        elif total_stock <= low_stock:
            stock_state = "low"
        else:
            stock_state = "in_stock"
        out.append({
            "id": pid, "public_key": key, "title": title, "service_type": service_type,
            "status": status_value.value if hasattr(status_value, "value") else str(status_value),
            "orders": int(orders), "gross": int(gross), "net": int(net),
            "inventory_managed": managed, "total_stock": int(total_stock), "stock_state": stock_state,
            "rating_avg": float(rating_avg) if rating_avg is not None else None,
            "rating_count": int(rating_count or 0),
        })
    return out


async def _customers(seller_id: int, rng: DashboardRange, db: AsyncSession) -> dict:
    first_order = (
        select(Order.buyer_id, func.min(Order.created_at).label("first_at"))
        .where(Order.seller_id == seller_id)
        .group_by(Order.buyer_id)
        .subquery()
    )
    in_range_buyers = (
        select(Order.buyer_id)
        .where(Order.seller_id == seller_id, Order.created_at >= rng.start, Order.created_at < rng.end)
        .distinct()
        .subquery()
    )
    row = (await db.execute(
        select(
            func.count(in_range_buyers.c.buyer_id),
            func.coalesce(func.sum(case((first_order.c.first_at >= rng.start, 1), else_=0)), 0),
        )
        .select_from(in_range_buyers)
        .join(first_order, first_order.c.buyer_id == in_range_buyers.c.buyer_id)
    )).one()
    unique = int(row[0])
    new = int(row[1])
    return {"unique_buyers": unique, "new_buyers": new, "returning_buyers": unique - new}


async def _reviews(seller_id: int, rng: DashboardRange, db: AsyncSession) -> dict:
    row = (await db.execute(
        select(
            func.avg(Review.rating),
            func.count(Review.id),
            func.coalesce(func.sum(case(((Review.created_at >= rng.start) & (Review.created_at < rng.end), 1), else_=0)), 0),
        )
        .join(Product, Product.id == Review.product_id)
        .where(Product.seller_id == seller_id)
    )).one()
    return {
        "rating_avg": round(float(row[0]), 2) if row[0] is not None else None,
        "rating_count": int(row[1]),
        "count_in_range": int(row[2]),
    }


async def get_seller_dashboard(seller_id: int, rng: DashboardRange, db: AsyncSession) -> dict:
    wallet = await db.scalar(select(Wallet).where(Wallet.account_id == seller_id))
    wallet_id = wallet.id if wallet else -1

    current = await _order_totals(seller_id, rng.start, rng.end, db)
    previous = await _order_totals(seller_id, rng.compare_start, rng.compare_end, db)
    by_status = await _status_counts(seller_id, rng, db)
    net, fee = await _release_sums(wallet_id, seller_id, rng.start, rng.end, db)
    net_prev, _ = await _release_sums(wallet_id, seller_id, rng.compare_start, rng.compare_end, db)
    escrow_held, escrow_orders = await _escrow_snapshot(seller_id, db)
    pending_withdrawals = int(await db.scalar(
        select(func.coalesce(func.sum(WithdrawRequest.amount), 0)).where(
            WithdrawRequest.account_id == seller_id,
            WithdrawRequest.status.in_((WithdrawStatus.pending, WithdrawStatus.approved)),
        )
    ) or 0)
    dispute_count = int(await db.scalar(
        select(func.count(Dispute.id))
        .join(Order, Order.id == Dispute.order_id)
        .where(Order.seller_id == seller_id, Dispute.created_at >= rng.start, Dispute.created_at < rng.end)
    ) or 0)

    total = current["total"]
    return {
        "range": rng.as_dict(),
        "money": {
            "gross": current["gross"],
            "gross_prev": previous["gross"],
            "net_released": net,
            "net_released_prev": net_prev,
            "platform_fee": fee,
            "refunded": current["refunded"],
            "refunded_orders": current["refunded_orders"],
            "escrow_held": escrow_held,
            "escrow_orders": escrow_orders,
            "pending_withdrawals": pending_withdrawals,
            "wallet": {
                "available": wallet.available_balance if wallet else 0,
                "pending": wallet.pending_balance if wallet else 0,
                "locked": wallet.locked_balance if wallet else 0,
            },
        },
        "orders": {
            "total": total,
            "total_prev": previous["total"],
            "completed_prev": previous["completed"],
            "by_status": by_status,
            "completion_rate": (by_status["completed"] / total) if total else None,
            "dispute_count": dispute_count,
            "dispute_rate": (dispute_count / total) if total else None,
            "avg_order_value": (current["gross"] // current["gross_orders"]) if current["gross_orders"] else None,
        },
        "timeseries": await _timeseries(seller_id, wallet_id, rng, db),
        "top_products": await _top_products(seller_id, rng, db),
        "inventory": await seller_inventory_counts(seller_id, db),
        "customers": await _customers(seller_id, rng, db),
        "reviews": await _reviews(seller_id, rng, db),
        "action_items": [
            {"key": i.key, "severity": i.severity, "label": i.label, "count": i.count, "href": i.href}
            for i in await seller_action_items(seller_id, db)
        ],
    }
