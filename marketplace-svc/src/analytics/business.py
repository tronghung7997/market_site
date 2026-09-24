"""Admin business analytics — GET /admin/analytics/business.

One period (preset or custom), one comparison period, one bucket size, and
optional dimension filters (seller segment, seller, category branch, service
type). Everything is aggregated in SQL; buckets are local calendar units in
the admin's browser timezone so "Tháng 9" means September in Vietnam, not UTC.

Definitions (the frontend glossary repeats them):
- gmv:              Σ total_amount of orders CREATED in the period whose
                    payment was captured: delivered/completed/disputed/refunded.
                    Pending/processing (not fulfilled yet) and cancelled are out.
- refunded:         Σ refunded_amount of those orders (partial + full).
- net_gmv:          gmv − refunded.
- platform_fee:     platform_fee ledger rows for orders, by SETTLEMENT time
                    (escrow release) — what the platform actually earned.
                    Withdrawal fees are reported separately (withdraw_fees).
- internal_sales:   seller payout released to INTERNAL (platform-run) sellers.
                    They settle at 0% fee, so the whole sale is platform money.
- affiliate_cost:   affiliate commission paid minus clawbacks.
- platform_revenue: platform_fee + internal_sales − affiliate_cost.
- dispute_rate:     paid orders that ever had a dispute ÷ paid orders.
- new buyers:       buyers whose first-ever paid order falls in the period.

Seeded (demo-review) orders never count anywhere.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import status as http_status
from sqlalchemy import Date, Integer, String, and_, case, cast, distinct, extract, func, literal, or_, select, text, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import ErrorCode, api_error
from src.models.account import Account
from src.models.category import Category
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.product import Product, ProductVariant
from src.models.wallet import Transaction, TransactionType, WithdrawRequest, WithdrawStatus

ROLLING_DAYS = {"7d": 7, "30d": 30, "90d": 90}
CALENDAR_KEYS = (
    "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
    "this_quarter", "last_quarter", "this_year", "last_year", "12m",
)
RANGE_KEYS = tuple(ROLLING_DAYS) + CALENDAR_KEYS + ("custom",)
RANGE_KEY_PATTERN = "^(" + "|".join(RANGE_KEYS) + ")$"
GRANULARITIES = ("day", "week", "month", "quarter", "year")
GRANULARITY_PATTERN = "^(auto|" + "|".join(GRANULARITIES) + ")$"
COMPARE_PATTERN = "^(previous|yoy|custom|none)$"
SEGMENT_PATTERN = "^(all|internal|external)$"
MAX_DAYS = 1830          # five years of history in one view
MAX_BUCKETS = 400        # a readable chart; also caps the day view at ~13 months
TOP_SELLERS = 25
TOP_PRODUCTS = 15

GROSS_STATUSES = (OrderStatus.delivered, OrderStatus.completed, OrderStatus.disputed, OrderStatus.refunded)
OPEN_STATUSES = (OrderStatus.pending, OrderStatus.processing)
ALL_STATUSES = [s.value for s in OrderStatus]


def _invalid(detail: str):
    return api_error(ErrorCode.DASHBOARD_RANGE_INVALID, http_status.HTTP_400_BAD_REQUEST, detail=detail)


# ── calendar helpers ─────────────────────────────────────────────────────────

def _month_end(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def _shift_months(d: date, months: int, *, keep_month_end: bool = False) -> date:
    idx = d.year * 12 + (d.month - 1) + months
    year, month = divmod(idx, 12)
    last = calendar.monthrange(year, month + 1)[1]
    day = last if keep_month_end else min(d.day, last)
    return date(year, month + 1, day)


def _quarter_start(d: date) -> date:
    return d.replace(month=((d.month - 1) // 3) * 3 + 1, day=1)


def trunc(d: date, unit: str) -> date:
    if unit == "day":
        return d
    if unit == "week":
        return d - timedelta(days=d.weekday())
    if unit == "month":
        return d.replace(day=1)
    if unit == "quarter":
        return _quarter_start(d)
    return d.replace(month=1, day=1)


def step(d: date, unit: str) -> date:
    if unit == "day":
        return d + timedelta(days=1)
    if unit == "week":
        return d + timedelta(days=7)
    if unit == "month":
        return _shift_months(d, 1)
    if unit == "quarter":
        return _shift_months(d, 3)
    return d.replace(year=d.year + 1)


def bucket_starts(from_date: date, to_date: date, unit: str) -> list[date]:
    out, cur = [], trunc(from_date, unit)
    while cur <= to_date:
        out.append(cur)
        cur = step(cur, unit)
    return out


def _period(key: str, today: date) -> tuple[date, date]:
    if key in ROLLING_DAYS:
        return today - timedelta(days=ROLLING_DAYS[key] - 1), today
    if key == "today":
        return today, today
    if key == "yesterday":
        y = today - timedelta(days=1)
        return y, y
    if key == "this_week":
        return trunc(today, "week"), today
    if key == "last_week":
        start = trunc(today, "week") - timedelta(days=7)
        return start, start + timedelta(days=6)
    if key == "this_month":
        return today.replace(day=1), today
    if key == "last_month":
        start = _shift_months(today.replace(day=1), -1)
        return start, _month_end(start)
    if key == "this_quarter":
        return _quarter_start(today), today
    if key == "last_quarter":
        start = _shift_months(_quarter_start(today), -3)
        return start, _month_end(_shift_months(start, 2))
    if key == "this_year":
        return today.replace(month=1, day=1), today
    if key == "last_year":
        return date(today.year - 1, 1, 1), date(today.year - 1, 12, 31)
    # 12m: the current month plus the eleven full months before it.
    return _shift_months(today.replace(day=1), -11), today


# Calendar periods compare against the same span of the previous calendar
# unit (Sep 1–24 vs Aug 1–24), not the N days right before.
_CALENDAR_SHIFT_MONTHS = {
    "this_month": 1, "last_month": 1, "this_quarter": 3, "last_quarter": 3,
    "this_year": 12, "last_year": 12, "12m": 12,
}
_CALENDAR_SHIFT_DAYS = {"today": 1, "yesterday": 1, "this_week": 7, "last_week": 7}


def _shift_period(from_date: date, to_date: date, months: int) -> tuple[date, date]:
    return (
        _shift_months(from_date, -months),
        _shift_months(to_date, -months, keep_month_end=to_date == _month_end(to_date)),
    )


def auto_granularity(days: int) -> str:
    if days <= 45:
        return "day"
    if days <= 120:
        return "week"
    if days <= 800:
        return "month"
    return "quarter"


@dataclass
class Window:
    from_date: date
    to_date: date
    tzinfo: ZoneInfo

    @property
    def days(self) -> int:
        return (self.to_date - self.from_date).days + 1

    @property
    def start(self) -> datetime:
        return datetime.combine(self.from_date, time.min, tzinfo=self.tzinfo)

    @property
    def end(self) -> datetime:  # exclusive
        return datetime.combine(self.to_date + timedelta(days=1), time.min, tzinfo=self.tzinfo)


@dataclass
class AnalyticsRange:
    key: str
    tz: str
    granularity: str
    compare_mode: str
    current: Window
    compare: Window | None

    def buckets(self, window: Window) -> list[date]:
        return bucket_starts(window.from_date, window.to_date, self.granularity)

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "tz": self.tz,
            "granularity": self.granularity,
            "compare": self.compare_mode,
            "from_date": self.current.from_date.isoformat(),
            "to_date": self.current.to_date.isoformat(),
            "days": self.current.days,
            "compare_from_date": self.compare.from_date.isoformat() if self.compare else None,
            "compare_to_date": self.compare.to_date.isoformat() if self.compare else None,
        }


def resolve_range(
    range_key: str | None,
    tz: str | None,
    from_date: date | None,
    to_date: date | None,
    *,
    granularity: str | None = "auto",
    compare: str | None = "previous",
    compare_from: date | None = None,
    compare_to: date | None = None,
    today: date | None = None,
) -> AnalyticsRange:
    tz = (tz or "UTC").strip()
    try:
        tzinfo = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise _invalid("Múi giờ không hợp lệ")
    key = (range_key or "30d").strip().lower()
    local_today = today or datetime.now(tzinfo).date()

    if key == "custom":
        if not from_date or not to_date:
            raise _invalid("Cần cả ngày bắt đầu và kết thúc")
        if to_date < from_date:
            raise _invalid("Ngày kết thúc phải sau ngày bắt đầu")
        start, end = from_date, min(to_date, local_today)
        if end < start:
            raise _invalid("Khoảng thời gian nằm trong tương lai")
    elif key in RANGE_KEYS:
        start, end = _period(key, local_today)
    else:
        raise _invalid("Khoảng thời gian không hợp lệ")
    current = Window(start, end, tzinfo)
    if current.days > MAX_DAYS:
        raise _invalid("Khoảng thời gian tối đa 5 năm")

    unit = (granularity or "auto").strip().lower()
    if unit == "auto":
        unit = auto_granularity(current.days)
    if unit not in GRANULARITIES:
        raise _invalid("Đơn vị thời gian không hợp lệ")
    if len(bucket_starts(start, end, unit)) > MAX_BUCKETS:
        raise _invalid("Quá nhiều mốc thời gian — hãy chọn đơn vị lớn hơn")

    mode = (compare or "previous").strip().lower()
    cmp: Window | None
    if mode == "none":
        cmp = None
    elif mode == "yoy":
        cmp = Window(*_shift_period(start, end, 12), tzinfo)
    elif mode == "custom":
        if not compare_from or not compare_to or compare_to < compare_from:
            raise _invalid("Kỳ so sánh tuỳ chọn không hợp lệ")
        cmp = Window(compare_from, compare_to, tzinfo)
        if cmp.days > MAX_DAYS:
            raise _invalid("Kỳ so sánh tối đa 5 năm")
    elif mode == "previous":
        if key in _CALENDAR_SHIFT_MONTHS:
            cmp = Window(*_shift_period(start, end, _CALENDAR_SHIFT_MONTHS[key]), tzinfo)
        elif key in _CALENDAR_SHIFT_DAYS:
            shift = timedelta(days=_CALENDAR_SHIFT_DAYS[key])
            cmp = Window(start - shift, end - shift, tzinfo)
        else:
            cmp_end = start - timedelta(days=1)
            cmp = Window(cmp_end - timedelta(days=current.days - 1), cmp_end, tzinfo)
    else:
        raise _invalid("Kiểu so sánh không hợp lệ")
    return AnalyticsRange(key, tz, unit, mode, current, cmp)


# ── filters and the order fact table ─────────────────────────────────────────

@dataclass
class Filters:
    segment: str = "all"
    seller_id: int | None = None
    category_id: int | None = None
    service_type: str | None = None

    def as_dict(self) -> dict:
        return {
            "segment": self.segment, "seller_id": self.seller_id,
            "category_id": self.category_id, "service_type": self.service_type,
        }

    @property
    def active(self) -> bool:
        return self.segment != "all" or any((self.seller_id, self.category_id, self.service_type))


async def _category_branch(category_id: int, db: AsyncSession) -> list[int]:
    rows = (await db.execute(select(Category.id, Category.parent_id))).all()
    children: dict[int | None, list[int]] = {}
    for cid, parent in rows:
        children.setdefault(parent, []).append(cid)
    out, stack = [], [category_id]
    while stack:
        cid = stack.pop()
        out.append(cid)
        stack.extend(children.get(cid, ()))
    return out


def _facts(f: Filters, category_ids: list[int] | None):
    """One row per real order, carrying every dimension the page slices by."""
    product_id = func.coalesce(Order.product_id, ProductVariant.product_id)
    first_paid = (
        select(Order.buyer_id.label("buyer_id"), func.min(Order.id).label("first_order_id"))
        .where(Order.is_seeded.is_(False), Order.status.in_(GROSS_STATUSES))
        .group_by(Order.buyer_id)
        .subquery("first_paid")
    )
    q = (
        select(
            Order.id.label("id"),
            Order.created_at.label("created_at"),
            Order.status.label("status"),
            Order.total_amount.label("total"),
            Order.refunded_amount.label("refunded"),
            Order.buyer_id.label("buyer_id"),
            Order.seller_id.label("seller_id"),
            product_id.label("product_id"),
            Product.category_id.label("category_id"),
            func.coalesce(Product.service_type, "other").label("service_type"),
            Account.is_internal.label("is_internal"),
            cast(Account.seller_tier, String).label("seller_tier"),
            (first_paid.c.first_order_id == Order.id).label("is_first"),
            Order.id.in_(select(Dispute.order_id)).label("ever_disputed"),
            Order.id.in_(select(Dispute.order_id).where(Dispute.status == DisputeStatus.open)).label("open_dispute"),
        )
        .select_from(Order)
        .join(Account, Account.id == Order.seller_id)
        .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
        .outerjoin(Product, Product.id == product_id)
        .outerjoin(first_paid, first_paid.c.buyer_id == Order.buyer_id)
        .where(Order.is_seeded.is_(False))
    )
    if f.segment == "internal":
        q = q.where(Account.is_internal.is_(True))
    elif f.segment == "external":
        q = q.where(Account.is_internal.is_(False))
    if f.seller_id:
        q = q.where(Order.seller_id == f.seller_id)
    if category_ids is not None:
        q = q.where(Product.category_id.in_(category_ids))
    if f.service_type:
        q = q.where(func.coalesce(Product.service_type, "other") == f.service_type)
    return q.subquery("facts")


# ── aggregation ──────────────────────────────────────────────────────────────
# The page needs the same order metrics sliced ~10 ways for two periods. One
# GROUPING SETS statement computes all of them in a single scan of the
# filtered orders (and one more for settlement rows) instead of a scan and a
# plan per slice. Rows are told apart with GROUPING(): a bit is set for every
# dimension the row is aggregated over.

CUR, CMP = "cur", "cmp"
_SETTLEMENT = (TransactionType.platform_fee, TransactionType.purchase_release)
_AFFILIATE = (TransactionType.affiliate_commission, TransactionType.affiliate_clawback)
ORDER_DIMS = ("bucket", "seller_id", "is_internal", "seller_tier", "category_id", "service_type", "product_id", "st", "dow_hour")
LEDGER_DIMS = ("bucket", "seller_id", "is_internal", "category_id", "service_type")


def _in(col, w: Window):
    return and_(col >= w.start, col < w.end)


def _sum(cond, value):
    return func.coalesce(func.sum(case((cond, value), else_=0)), 0)


def _tag_period(col, rng: AnalyticsRange):
    """(period label expression, WHERE clause covering both periods)."""
    if rng.compare is None:
        return literal(CUR), _in(col, rng.current)
    return (
        case((_in(col, rng.current), literal(CUR)), else_=literal(CMP)),
        or_(_in(col, rng.current), _in(col, rng.compare)),
    )


def _local_bucket(col, rng: AnalyticsRange):
    return cast(func.date_trunc(rng.granularity, func.timezone(rng.tz, col)), Date)


def _order_metrics(D):
    gross = D.c.status.in_(GROSS_STATUSES)
    return [
        func.count(D.c.id),
        _sum(gross, D.c.total),
        _sum(gross, D.c.refunded),
        _sum(gross, 1),
        _sum(D.c.status == OrderStatus.completed, 1),
        _sum(D.c.status == OrderStatus.cancelled, 1),
        _sum(D.c.status.in_(OPEN_STATUSES), 1),
        _sum(and_(gross, D.c.ever_disputed), 1),
        _sum(and_(gross, D.c.refunded > 0), 1),
        func.count(distinct(case((gross, D.c.buyer_id)))),
        func.count(distinct(case((gross, D.c.seller_id)))),
        _sum(and_(gross, D.c.is_first.is_(True)), 1),
        _sum(and_(gross, D.c.is_first.is_(True)), D.c.total),
        _sum(and_(gross, D.c.is_internal.is_(True)), D.c.total),
    ]


_ORDER_KEYS = (
    "orders", "gmv", "refunded", "paid_orders", "completed", "cancelled", "open_orders",
    "disputed_orders", "refunded_orders", "buyers", "sellers", "new_buyers", "new_buyer_gmv", "internal_gmv",
)
_MONEY_KEYS = _ORDER_KEYS + ("platform_fee", "internal_sales", "affiliate_cost", "deposits", "withdrawals_paid", "signups")


def _grouping_sets(D, dims: tuple[str, ...]):
    cols = [D.c[d] for d in dims]
    sets = [tuple_(D.c.period)] + [tuple_(D.c.period, c) for c in cols]
    return func.grouping(*cols).label("g"), func.grouping_sets(*sets)


def _dimension_of(g: int, dims: tuple[str, ...]) -> str | None:
    """GROUPING() bitmask → the one dimension this row is grouped by (None = period total)."""
    full = (1 << len(dims)) - 1
    for i, name in enumerate(dims):
        if g == full ^ (1 << (len(dims) - 1 - i)):
            return name
    return None


def _order_statement(F, rng: AnalyticsRange):
    period, in_window = _tag_period(F.c.created_at, rng)
    local = func.timezone(rng.tz, F.c.created_at)
    # Derived columns first, so the grouping sets refer to plain columns.
    D = select(
        F,
        period.label("period"),
        _local_bucket(F.c.created_at, rng).label("bucket"),
        case((F.c.open_dispute, OrderStatus.disputed.value), else_=cast(F.c.status, String)).label("st"),
        (cast(extract("isodow", local), Integer) * 100 + cast(extract("hour", local), Integer)).label("dow_hour"),
    ).where(in_window).subquery("d")
    g, sets = _grouping_sets(D, ORDER_DIMS)
    return select(g, D.c.period, *(D.c[d] for d in ORDER_DIMS), *_order_metrics(D)).group_by(sets)


def _ledger_statement(F, rng: AnalyticsRange):
    """Escrow release/fee rows (reference "order-<id>") joined back to the filtered orders."""
    period, in_window = _tag_period(Transaction.created_at, rng)
    D = (
        select(
            Transaction.type, Transaction.amount, period.label("period"),
            _local_bucket(Transaction.created_at, rng).label("bucket"),
            F.c.seller_id, F.c.is_internal, F.c.category_id, F.c.service_type,
        )
        .select_from(Transaction)
        .join(F, Transaction.reference_id == func.concat("order-", cast(F.c.id, String)))
        .where(Transaction.type.in_(_SETTLEMENT), in_window)
        .subquery("l")
    )
    g, sets = _grouping_sets(D, LEDGER_DIMS)
    return select(
        g, D.c.period, *(D.c[d] for d in LEDGER_DIMS),
        _sum(D.c.type == TransactionType.platform_fee, D.c.amount),
        _sum(and_(D.c.type == TransactionType.purchase_release, D.c.is_internal.is_(True)), D.c.amount),
    ).group_by(sets)


def _by_period_and_bucket(col, rng: AnalyticsRange, value, *where):
    """Σ value per period and per (period, bucket) for a cash-flow table."""
    period, in_window = _tag_period(col, rng)
    D = select(period.label("period"), _local_bucket(col, rng).label("bucket"), value.label("v")).where(in_window, *where).subquery("c")
    g, sets = _grouping_sets(D, ("bucket",))
    return select(g, D.c.period, D.c.bucket, func.coalesce(func.sum(D.c.v), 0)).group_by(sets)


def _affiliate_statement(F, rng: AnalyticsRange):
    period, in_window = _tag_period(Transaction.created_at, rng)
    signed = case((Transaction.type == TransactionType.affiliate_clawback, -Transaction.amount), else_=Transaction.amount)
    D = (
        select(period.label("period"), _local_bucket(Transaction.created_at, rng).label("bucket"), signed.label("v"))
        .select_from(Transaction)
        .join(F, Transaction.reference_id == cast(F.c.id, String))
        .where(Transaction.type.in_(_AFFILIATE), in_window)
        .subquery("a")
    )
    g, sets = _grouping_sets(D, ("bucket",))
    return select(g, D.c.period, D.c.bucket, func.coalesce(func.sum(D.c.v), 0)).group_by(sets)


def _with_revenue(row: dict) -> dict:
    row["net_gmv"] = row["gmv"] - row["refunded"]
    row["platform_revenue"] = row["platform_fee"] + row["internal_sales"] - row["affiliate_cost"]
    return row


def _blank() -> dict:
    return {k: 0 for k in _MONEY_KEYS}


class _Frame:
    """Unpacks the grouping-set rows into per-period totals, buckets and slices."""

    def __init__(self):
        self.totals = {CUR: _blank(), CMP: _blank()}
        self.buckets = {CUR: {}, CMP: {}}
        self.slices: dict[str, dict[str, dict]] = {}

    def total(self, period: str) -> dict:
        return self.totals[period]

    def bucket(self, period: str, d: date) -> dict:
        return self.buckets[period].setdefault(d, _blank())

    def slice(self, dim: str, period: str, key) -> dict:
        return self.slices.setdefault(dim, {CUR: {}, CMP: {}})[period].setdefault(key, _blank())

    def put(self, dim: str | None, period: str, key, values: dict):
        target = self.total(period) if dim is None else self.bucket(period, key) if dim == "bucket" else self.slice(dim, period, key)
        target.update(values)


async def _load(F, rng: AnalyticsRange, db: AsyncSession) -> tuple[_Frame, dict]:
    frame = _Frame()
    for row in (await db.execute(_order_statement(F, rng))).all():
        dim = _dimension_of(row[0], ORDER_DIMS)
        key = None if dim is None else row[2 + ORDER_DIMS.index(dim)]
        frame.put(dim, row[1], key, {k: int(v or 0) for k, v in zip(_ORDER_KEYS, row[2 + len(ORDER_DIMS):])})
    for row in (await db.execute(_ledger_statement(F, rng))).all():
        dim = _dimension_of(row[0], LEDGER_DIMS)
        key = None if dim is None else row[2 + LEDGER_DIMS.index(dim)]
        fee, internal = row[2 + len(LEDGER_DIMS):]
        frame.put(dim, row[1], key, {"platform_fee": int(fee or 0), "internal_sales": int(internal or 0)})

    cash = {
        "affiliate_cost": _affiliate_statement(F, rng),
        "deposits": _by_period_and_bucket(Transaction.created_at, rng, Transaction.amount, Transaction.type == TransactionType.deposit),
        "withdrawals_paid": _by_period_and_bucket(
            WithdrawRequest.paid_at, rng,
            func.coalesce(WithdrawRequest.net_amount, WithdrawRequest.amount - WithdrawRequest.fee_amount),
            WithdrawRequest.status == WithdrawStatus.paid,
        ),
        "withdraw_fees": _by_period_and_bucket(WithdrawRequest.paid_at, rng, WithdrawRequest.fee_amount, WithdrawRequest.status == WithdrawStatus.paid),
        "signups": _by_period_and_bucket(Account.created_at, rng, literal(1), Account.is_seeded.is_(False)),
    }
    for name, stmt in cash.items():
        for g, period, bucket, v in (await db.execute(stmt)).all():
            if name == "withdraw_fees":
                if g:  # totals only
                    frame.total(period)[name] = int(v or 0)
                continue
            frame.put(None if g else "bucket", period, bucket, {name: int(v or 0)})

    extra = {
        "new_sellers": await db.scalar(select(func.count()).select_from(
            select(Order.seller_id)
            .where(Order.is_seeded.is_(False), Order.status.in_(GROSS_STATUSES))
            .group_by(Order.seller_id)
            .having(and_(func.min(Order.created_at) >= rng.current.start, func.min(Order.created_at) < rng.current.end))
            .subquery()
        )),
        "categories": {c.id: c for c in (await db.execute(select(Category.id, Category.name, Category.parent_id))).all()},
    }
    return frame, extra


_GROUP_KEYS = ("gmv", "paid_orders", "refunded", "disputed_orders", "orders", "cancelled", "buyers", "sellers")


def _group_rows(frame: _Frame, dim: str) -> list[dict]:
    per = frame.slices.get(dim, {CUR: {}, CMP: {}})
    out = []
    for key in set(per[CUR]) | set(per[CMP]):
        cur, prev = per[CUR].get(key, _blank()), per[CMP].get(key, _blank())
        row = {"key": key, **{k: cur[k] for k in _GROUP_KEYS}}
        row.update(gmv_prev=prev["gmv"], paid_orders_prev=prev["paid_orders"], refunded_prev=prev["refunded"],
                   platform_take=cur["platform_fee"] + cur["internal_sales"])
        out.append(row)
    out.sort(key=lambda x: (x["gmv"], x["gmv_prev"]), reverse=True)
    return out


def _series(frame: _Frame, rng: AnalyticsRange, w: Window, period: str) -> list[dict]:
    out = []
    for d in rng.buckets(w):
        end = step(d, rng.granularity) - timedelta(days=1)
        values = frame.buckets[period].get(d, _blank())
        out.append({"date": d.isoformat(), "end_date": end.isoformat(),
                    "partial": d < w.from_date or end > w.to_date, **_with_revenue(dict(values))})
    return out


def _concentration(values: list[int]) -> dict:
    values = sorted((v for v in values if v > 0), reverse=True)
    total = sum(values)
    if not total:
        return {"sellers": 0, "top1": 0.0, "top5": 0.0, "top10": 0.0, "hhi": 0.0}
    share = lambda n: round(sum(values[:n]) / total, 4)  # noqa: E731
    return {
        "sellers": len(values), "top1": share(1), "top5": share(5), "top10": share(10),
        "hhi": round(sum((v / total) ** 2 for v in values) * 10_000, 1),
    }


def _strip_key(row: dict, name: str) -> dict:
    out = {k: v for k, v in row.items() if k not in ("key", "sellers")}
    out[name] = row["key"]
    return out


# Analytics runs on the same PostgreSQL as the storefront. Per-transaction
# limits keep a heavy admin report from hurting checkout:
# - statement_timeout: a runaway query is cancelled server-side (a client
#   disconnect alone does not stop it);
# - no parallel workers: one report cannot take every CPU core, and parallel
#   hash joins cannot exhaust the container's small /dev/shm;
# - a larger work_mem so the grouping sets sort in memory, not on disk.
ANALYTICS_SESSION_LIMITS = (
    "SET LOCAL statement_timeout = '25s'",
    "SET LOCAL max_parallel_workers_per_gather = 0",
    "SET LOCAL work_mem = '32MB'",
)


async def get_business_analytics(rng: AnalyticsRange, f: Filters, db: AsyncSession) -> dict:
    for stmt in ANALYTICS_SESSION_LIMITS:
        await db.execute(text(stmt))
    category_ids = await _category_branch(f.category_id, db) if f.category_id else None
    frame, extra = await _load(_facts(f, category_ids), rng, db)
    has_cmp = rng.compare is not None

    sellers = _group_rows(frame, "seller_id")
    top_sellers = [s for s in sellers if s["gmv"] > 0][:TOP_SELLERS]
    decliners = sorted((s for s in sellers if s["gmv_prev"] > s["gmv"]), key=lambda s: s["gmv"] - s["gmv_prev"])[:8]
    products = [p for p in _group_rows(frame, "product_id") if p["gmv"] > 0][:TOP_PRODUCTS]

    seller_ids = {s["key"] for s in top_sellers} | {s["key"] for s in decliners}
    product_ids = [p["key"] for p in products if p["key"]]
    accounts = {a.id: a for a in (await db.execute(select(Account).where(Account.id.in_(seller_ids)))).scalars()} if seller_ids else {}
    product_rows = {p.id: p for p in (await db.execute(select(Product).where(Product.id.in_(product_ids)))).scalars()} if product_ids else {}

    def seller_row(s: dict) -> dict:
        a = accounts.get(s["key"])
        return {
            **_strip_key(s, "id"),
            "name": (a.display_name or a.email.split("@")[0]) if a else f"#{s['key']}",
            "email": a.email if a else None,
            "is_internal": bool(a and a.is_internal),
            "tier": a.seller_tier.value if a else "new",
        }

    def product_row(p: dict) -> dict:
        prod = product_rows.get(p["key"])
        return {
            **_strip_key(p, "id"),
            "title": prod.title if prod else "Sản phẩm đã xoá",
            "service_type": (prod.service_type or "other") if prod else "other",
            "seller_id": prod.seller_id if prod else None,
        }

    all_categories = extra["categories"]
    categories = []
    for c in _group_rows(frame, "category_id"):
        cat = all_categories.get(c["key"])
        categories.append({**_strip_key(c, "id"), "name": cat.name if cat else "Không phân loại",
                           "parent_id": cat.parent_id if cat else None})
    # Ancestors so the client can draw a branch → leaf treemap.
    needed = {c["parent_id"] for c in categories if c["parent_id"]}
    tree: dict[int, dict] = {}
    while needed:
        cid = needed.pop()
        cat = all_categories.get(cid)
        if cat is None or cid in tree:
            continue
        tree[cid] = {"id": cat.id, "name": cat.name, "parent_id": cat.parent_id}
        if cat.parent_id:
            needed.add(cat.parent_id)

    def status(period: str) -> dict[str, int]:
        counts = {s: 0 for s in ALL_STATUSES}
        for key, values in frame.slices.get("st", {CUR: {}, CMP: {}})[period].items():
            counts[str(key)] = values["orders"]
        return counts

    heat = frame.slices.get("dow_hour", {CUR: {}})[CUR]
    return {
        "range": rng.as_dict(),
        "filters": f.as_dict(),
        "totals": {**_with_revenue(dict(frame.total(CUR))), "withdraw_fees": frame.total(CUR).get("withdraw_fees", 0)},
        "compare_totals": {**_with_revenue(dict(frame.total(CMP))), "withdraw_fees": frame.total(CMP).get("withdraw_fees", 0)} if has_cmp else None,
        "series": _series(frame, rng, rng.current, CUR),
        "compare_series": _series(frame, rng, rng.compare, CMP) if has_cmp else [],
        "status": status(CUR),
        "compare_status": status(CMP) if has_cmp else None,
        "segments": [
            {**_strip_key(s, "segment"), "segment": "internal" if s["key"] else "external"}
            for s in _group_rows(frame, "is_internal") if s["key"] is not None
        ],
        "tiers": [{**_strip_key(t, "tier"), "sellers": t["sellers"]} for t in _group_rows(frame, "seller_tier") if t["key"]],
        "categories": categories,
        "category_tree": list(tree.values()),
        "service_types": [_strip_key(s, "service_type") for s in _group_rows(frame, "service_type")],
        "top_sellers": [seller_row(s) for s in top_sellers],
        "declining_sellers": [seller_row(s) for s in decliners],
        "top_products": [product_row(p) for p in products],
        "heatmap": [
            {"dow": k // 100, "hour": k % 100, "orders": v["paid_orders"], "gmv": v["gmv"]}
            for k, v in sorted(heat.items()) if v["paid_orders"]
        ],
        "concentration": _concentration([s["gmv"] for s in sellers]),
        "compare_concentration": _concentration([s["gmv_prev"] for s in sellers]) if has_cmp else None,
        "new_sellers": int(extra["new_sellers"] or 0),
    }


async def get_filter_options(db: AsyncSession) -> dict:
    sellers = (await db.execute(
        select(Account.id, Account.display_name, Account.email, Account.is_internal, Account.seller_tier)
        .where(Account.roles.any("seller"), Account.is_seeded.is_(False))
        .order_by(Account.is_internal.desc(), Account.id)
    )).all()
    categories = (await db.execute(
        select(Category.id, Category.name, Category.parent_id).order_by(Category.sort_order, Category.name)
    )).all()
    service = func.coalesce(Product.service_type, "other").label("service_type")
    services = (await db.execute(select(service).group_by(service).order_by(service))).scalars().all()
    return {
        "sellers": [
            {"id": s.id, "name": s.display_name or s.email.split("@")[0], "email": s.email,
             "is_internal": s.is_internal, "tier": s.seller_tier.value}
            for s in sellers
        ],
        "categories": [{"id": c.id, "name": c.name, "parent_id": c.parent_id} for c in categories],
        "service_types": list(services),
    }
