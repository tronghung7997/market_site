from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.account import Account
from src.models.affiliate import AffiliateClick, AffiliateCommission, AffiliateFundEntry
from src.models.category import Category
from src.models.order import Order
from src.models.product import Product, ProductVariant
from src.wallet.service import credit_affiliate_commission


CLICK_DEDUP_WINDOW = timedelta(hours=24)


async def record_click(
    code: str,
    db: AsyncSession,
    path: str | None = None,
    referrer: str | None = None,
    visitor_id: str | None = None,
    ip: str | None = None,
) -> None:
    """Record a referral-link click, deduplicated per visitor per 24h.

    Identity is the client-persisted visitor_id when present, else the client
    IP — refreshes and repeat visits inside the window don't add clicks.
    A request with neither identity is dropped rather than counted, since it
    could be replayed indefinitely.
    """
    affiliate = await db.scalar(select(Account).where(Account.affiliate_code == code))
    if not affiliate:
        return

    # Prefer visitor_id when present; only fall back to IP for anonymous
    # clients. Combining both with OR would collapse distinct visitors
    # sharing a NAT/IP (or the single test client IP) into one click.
    if visitor_id:
        identity_filter = AffiliateClick.visitor_id == visitor_id
    elif ip:
        identity_filter = AffiliateClick.ip == ip
    else:
        return

    window_start = datetime.now(timezone.utc) - CLICK_DEDUP_WINDOW
    duplicate = await db.scalar(
        select(AffiliateClick.id).where(
            AffiliateClick.affiliate_account_id == affiliate.id,
            AffiliateClick.created_at >= window_start,
            identity_filter,
        ).limit(1)
    )
    if duplicate:
        return

    db.add(
        AffiliateClick(
            affiliate_account_id=affiliate.id,
            path=path,
            referrer=referrer,
            visitor_id=visitor_id,
            ip=ip,
        )
    )
    await db.commit()


async def apply_affiliate_commission(order: Order, db: AsyncSession) -> None:
    """Credit affiliate commission for a completed order, in the caller's transaction.

    Called at every point Order.status transitions to `completed`. Must run
    BEFORE the caller's `db.commit()` so the commission + wallet credit share
    the same transaction as the status change.
    """
    buyer = await db.get(Account, order.buyer_id)
    if not buyer or buyer.referred_by_id is None:
        return
    if buyer.referred_by_id == order.buyer_id:
        return

    existing = await db.scalar(
        select(AffiliateCommission.id).where(AffiliateCommission.order_id == order.id)
    )
    if existing:
        return

    product = None
    if order.product_id:
        product = await db.get(Product, order.product_id)
    elif order.variant_id:
        variant = await db.get(ProductVariant, order.variant_id)
        if variant:
            product = await db.get(Product, variant.product_id)

    rate: float | None = None
    if product:
        if product.commission_rate is not None:
            rate = product.commission_rate
        else:
            category = await db.get(Category, product.category_id)
            if category and category.commission_rate is not None:
                rate = category.commission_rate
    if rate is None:
        rate = settings.default_affiliate_commission_percent

    amount = round(order.total_amount * rate / 100)
    if amount <= 0:
        return

    db.add(
        AffiliateCommission(
            order_id=order.id,
            affiliate_account_id=buyer.referred_by_id,
            buyer_account_id=buyer.id,
            rate_percent=rate,
            amount=amount,
        )
    )
    # Draw the payout down from the global affiliate fund. The balance is
    # allowed to go negative (commission is always paid); a negative balance
    # tells admin to top up.
    db.add(
        AffiliateFundEntry(
            amount=-amount,
            kind="commission",
            reference_id=str(order.id),
        )
    )
    await credit_affiliate_commission(buyer.referred_by_id, amount, order.id, db)


async def get_fund_balance(db: AsyncSession) -> int:
    return int(await db.scalar(select(func.coalesce(func.sum(AffiliateFundEntry.amount), 0))) or 0)


async def get_fund_overview(db: AsyncSession, limit: int = 30) -> dict:
    balance = await get_fund_balance(db)
    spent = int(
        await db.scalar(
            select(func.coalesce(func.sum(AffiliateFundEntry.amount), 0)).where(
                AffiliateFundEntry.kind == "commission"
            )
        )
        or 0
    )
    topped = int(
        await db.scalar(
            select(func.coalesce(func.sum(AffiliateFundEntry.amount), 0)).where(
                AffiliateFundEntry.kind == "topup"
            )
        )
        or 0
    )
    rows = await db.execute(
        select(AffiliateFundEntry).order_by(AffiliateFundEntry.created_at.desc()).limit(limit)
    )
    entries = [
        {
            "id": e.id,
            "amount": e.amount,
            "kind": e.kind,
            "reference_id": e.reference_id,
            "note": e.note,
            "created_at": e.created_at,
        }
        for e in rows.scalars().all()
    ]
    # spent is stored negative; report as positive "paid out"
    return {"balance": balance, "total_topped_up": topped, "total_paid_out": -spent, "entries": entries}


async def topup_fund(amount: int, admin_id: int, db: AsyncSession, note: str | None = None) -> dict:
    from src.audit.service import log_event
    from src.logging import current_request_id

    if amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền phải lớn hơn 0")
    db.add(
        AffiliateFundEntry(amount=amount, kind="topup", note=note, created_by=admin_id)
    )
    await log_event(
        db, "info", f"Affiliate fund topped up by {amount}",
        request_id=current_request_id(),
        metadata={
            "event": "affiliate_fund_topup",
            "actor_id": admin_id,
            "actor_type": "admin",
            "subject_type": "affiliate_fund",
            "subject_id": admin_id,
            "outcome": "success",
            "source": "admin",
            "amount": amount,
        },
    )
    await db.commit()
    return await get_fund_overview(db)


async def update_affiliate_code(account_id: int, new_code: str, db: AsyncSession) -> Account:
    """Admin-set an affiliate's referral code.

    referred_by_id and affiliate_clicks link by account id, so existing
    attributions and click history are unaffected; only external links that
    still carry the old code stop resolving.
    """
    code = new_code.strip().upper()
    if not (4 <= len(code) <= 8) or not code.isalnum():
        raise HTTPException(status_code=422, detail="Mã phải dài 4–8 ký tự chữ/số")
    account = await db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    clash = await db.scalar(
        select(Account.id).where(Account.affiliate_code == code, Account.id != account_id)
    )
    if clash:
        raise HTTPException(status_code=409, detail="Mã này đã được dùng")
    account.affiliate_code = code
    await db.commit()
    await db.refresh(account)
    return account


async def list_affiliates_admin(
    db: AsyncSession,
    search: str | None = None,
    page: int = 1,
    per_page: int = 20,
) -> dict:
    """Paginated list of accounts with aggregated affiliate stats.

    Uses subqueries per aggregate to avoid cartesian-product sum inflation.
    """
    clicks_subq = (
        select(
            AffiliateClick.affiliate_account_id.label("aid"),
            func.count(AffiliateClick.id).label("clicks"),
        )
        .group_by(AffiliateClick.affiliate_account_id)
        .subquery()
    )
    signups_subq = (
        select(
            Account.referred_by_id.label("rid"),
            func.count(Account.id).label("signups"),
        )
        .where(Account.referred_by_id.isnot(None))
        .group_by(Account.referred_by_id)
        .subquery()
    )
    comm_subq = (
        select(
            AffiliateCommission.affiliate_account_id.label("aid"),
            func.count(AffiliateCommission.id).label("orders"),
            func.coalesce(func.sum(AffiliateCommission.amount), 0).label("commission"),
        )
        .group_by(AffiliateCommission.affiliate_account_id)
        .subquery()
    )

    query = (
        select(
            Account.id,
            Account.email,
            Account.affiliate_code,
            func.coalesce(clicks_subq.c.clicks, 0).label("clicks"),
            func.coalesce(signups_subq.c.signups, 0).label("signups"),
            func.coalesce(comm_subq.c.orders, 0).label("orders"),
            func.coalesce(comm_subq.c.commission, 0).label("commission"),
        )
        .outerjoin(clicks_subq, clicks_subq.c.aid == Account.id)
        .outerjoin(signups_subq, signups_subq.c.rid == Account.id)
        .outerjoin(comm_subq, comm_subq.c.aid == Account.id)
    )
    if search:
        query = query.where(Account.email.ilike(f"%{search}%"))

    count_q = select(func.count(Account.id))
    if search:
        count_q = count_q.where(Account.email.ilike(f"%{search}%"))
    total = await db.scalar(count_q) or 0

    rows = await db.execute(
        query.order_by(Account.id).offset((page - 1) * per_page).limit(per_page)
    )
    items = [
        {
            "id": r.id,
            "email": r.email,
            "affiliate_code": r.affiliate_code,
            "clicks": int(r.clicks or 0),
            "signups": int(r.signups or 0),
            "orders": int(r.orders or 0),
            "commission": int(r.commission or 0),
        }
        for r in rows.all()
    ]
    return {"items": items, "total": int(total), "page": page, "per_page": per_page}


def _parse_range(date_from: str | None, date_to: str | None) -> tuple[datetime | None, datetime | None]:
    try:
        start = datetime.fromisoformat(date_from) if date_from else None
        end = datetime.fromisoformat(date_to) + timedelta(days=1) if date_to else None
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="date_from/date_to phải theo định dạng YYYY-MM-DD",
        )
    return start, end


async def get_affiliate_stats(
    account_id: int,
    db: AsyncSession,
    date_from: str | None = None,
    date_to: str | None = None,
    reveal_spend: bool = False,
) -> dict:
    start, end = _parse_range(date_from, date_to)

    account = await db.get(Account, account_id)
    code = account.affiliate_code if account else ""
    link = f"{settings.frontend_base_url}/?ref={code}"

    clicks_q = select(func.count(AffiliateClick.id)).where(
        AffiliateClick.affiliate_account_id == account_id
    )
    signups_q = select(func.count(Account.id)).where(Account.referred_by_id == account_id)
    commission_q = select(
        func.count(AffiliateCommission.id),
        func.coalesce(func.sum(AffiliateCommission.amount), 0),
    ).where(AffiliateCommission.affiliate_account_id == account_id)
    revenue_q = (
        select(func.coalesce(func.sum(Order.total_amount), 0))
        .join(AffiliateCommission, AffiliateCommission.order_id == Order.id)
        .where(AffiliateCommission.affiliate_account_id == account_id)
    )

    if start:
        clicks_q = clicks_q.where(AffiliateClick.created_at >= start)
        signups_q = signups_q.where(Account.created_at >= start)
        commission_q = commission_q.where(AffiliateCommission.created_at >= start)
        revenue_q = revenue_q.where(AffiliateCommission.created_at >= start)
    if end:
        clicks_q = clicks_q.where(AffiliateClick.created_at < end)
        signups_q = signups_q.where(Account.created_at < end)
        commission_q = commission_q.where(AffiliateCommission.created_at < end)
        revenue_q = revenue_q.where(AffiliateCommission.created_at < end)

    clicks = await db.scalar(clicks_q) or 0
    signups = await db.scalar(signups_q) or 0
    commission_row = (await db.execute(commission_q)).one()
    orders_count = int(commission_row[0] or 0)
    commission_total = int(commission_row[1] or 0)
    revenue = int(await db.scalar(revenue_q) or 0)

    totals = {
        "clicks": int(clicks),
        "signups": int(signups),
        "orders": orders_count,
        "revenue": revenue,
        "commission": commission_total,
    }

    timeseries = await _build_timeseries(account_id, db, start, end, date_from, date_to)

    referred_users = await _get_referred_users(account_id, db, start, end, reveal_spend=reveal_spend)

    recent = await db.execute(
        select(AffiliateCommission)
        .where(AffiliateCommission.affiliate_account_id == account_id)
        .order_by(AffiliateCommission.created_at.desc())
        .limit(20)
    )
    commissions: list[dict] = []
    for c in recent.scalars().all():
        order = await db.get(Order, c.order_id)
        product_title = None
        if order and order.product_id:
            product = await db.get(Product, order.product_id)
            product_title = product.title if product else None
        elif order and order.variant_id:
            variant = await db.get(ProductVariant, order.variant_id)
            if variant:
                product = await db.get(Product, variant.product_id)
                product_title = product.title if product else None
        commissions.append({
            "id": c.id,
            "order_id": c.order_id,
            "buyer_account_id": c.buyer_account_id,
            "rate_percent": c.rate_percent,
            "amount": c.amount,
            "created_at": c.created_at,
            "product_title": product_title,
            "order_total": order.total_amount if order else None,
        })

    return {
        "code": code,
        "link": link,
        "totals": totals,
        "timeseries": timeseries,
        "commissions": commissions,
        "referred_users": referred_users,
    }


async def _get_referred_users(
    account_id: int,
    db: AsyncSession,
    start: datetime | None,
    end: datetime | None,
    reveal_spend: bool = False,
) -> list[dict]:
    """Accounts signed up under this affiliate's link, most recent first.

    total_spent is only populated when reveal_spend=True (admin view) — the
    self-service affiliate page must not leak other users' spending.
    """
    orders_subq = (
        select(
            Order.buyer_id.label("bid"),
            func.count(Order.id).label("order_count"),
            func.coalesce(func.sum(Order.total_amount), 0).label("total_spent"),
        )
        .group_by(Order.buyer_id)
        .subquery()
    )
    query = (
        select(
            Account.id,
            Account.email,
            Account.created_at,
            func.coalesce(orders_subq.c.order_count, 0).label("order_count"),
            func.coalesce(orders_subq.c.total_spent, 0).label("total_spent"),
        )
        .outerjoin(orders_subq, orders_subq.c.bid == Account.id)
        .where(Account.referred_by_id == account_id)
        .order_by(Account.created_at.desc())
        .limit(100)
    )
    if start:
        query = query.where(Account.created_at >= start)
    if end:
        query = query.where(Account.created_at < end)

    rows = await db.execute(query)
    return [
        {
            "id": r.id,
            "email": r.email,
            "created_at": r.created_at,
            "order_count": int(r.order_count or 0),
            "total_spent": int(r.total_spent or 0) if reveal_spend else None,
        }
        for r in rows.all()
    ]


async def _build_timeseries(
    account_id: int,
    db: AsyncSession,
    start: datetime | None,
    end: datetime | None,
    date_from: str | None,
    date_to: str | None,
) -> list[dict]:
    today = datetime.now(timezone.utc).date()
    if start and end:
        cur = start.date()
        last = (end - timedelta(days=1)).date()
    elif date_from:
        cur = datetime.fromisoformat(date_from).date()
        last = date_to if date_to else today
        if isinstance(last, str):
            last = datetime.fromisoformat(last).date()
    elif date_to:
        last = datetime.fromisoformat(date_to).date()
        cur = last - timedelta(days=29)
    else:
        last = today
        cur = last - timedelta(days=29)

    days: list[dict] = []
    d = cur
    while d <= last:
        days.append({
            "date": d.isoformat(),
            "clicks": 0,
            "signups": 0,
            "orders": 0,
            "revenue": 0,
            "commission": 0,
        })
        d = d + timedelta(days=1)

    if not days:
        return days

    day_index = {datetime.fromisoformat(pt["date"]).date(): pt for pt in days}

    # Bucket by UTC calendar day to match `today`/range which are computed in UTC,
    # and bound each aggregate to the visible window so we never scan full history.
    win_start = datetime(cur.year, cur.month, cur.day, tzinfo=timezone.utc)
    win_end = datetime(last.year, last.month, last.day, tzinfo=timezone.utc) + timedelta(days=1)

    # literal_column keeps 'UTC' out of a bind param so the SELECT and GROUP BY
    # expressions render identically (Postgres rejects grouping otherwise).
    def _utc_day(col):
        return func.date(func.timezone(literal_column("'UTC'"), col))

    clicks_by_day = await db.execute(
        select(_utc_day(AffiliateClick.created_at), func.count(AffiliateClick.id))
        .where(
            AffiliateClick.affiliate_account_id == account_id,
            AffiliateClick.created_at >= win_start,
            AffiliateClick.created_at < win_end,
        )
        .group_by(_utc_day(AffiliateClick.created_at))
    )
    for d_str, cnt in clicks_by_day.all():
        d = datetime.fromisoformat(str(d_str)).date()
        if d in day_index:
            day_index[d]["clicks"] = int(cnt)

    signups_by_day = await db.execute(
        select(_utc_day(Account.created_at), func.count(Account.id))
        .where(
            Account.referred_by_id == account_id,
            Account.created_at >= win_start,
            Account.created_at < win_end,
        )
        .group_by(_utc_day(Account.created_at))
    )
    for d_str, cnt in signups_by_day.all():
        d = datetime.fromisoformat(str(d_str)).date()
        if d in day_index:
            day_index[d]["signups"] = int(cnt)

    comm_by_day = await db.execute(
        select(
            _utc_day(AffiliateCommission.created_at),
            func.count(AffiliateCommission.id),
            func.coalesce(func.sum(AffiliateCommission.amount), 0),
        )
        .where(
            AffiliateCommission.affiliate_account_id == account_id,
            AffiliateCommission.created_at >= win_start,
            AffiliateCommission.created_at < win_end,
        )
        .group_by(_utc_day(AffiliateCommission.created_at))
    )
    for d_str, cnt, amt in comm_by_day.all():
        d = datetime.fromisoformat(str(d_str)).date()
        if d in day_index:
            day_index[d]["orders"] = int(cnt)
            day_index[d]["commission"] = int(amt)

    rev_by_day = await db.execute(
        select(
            _utc_day(AffiliateCommission.created_at),
            func.coalesce(func.sum(Order.total_amount), 0),
        )
        .join(AffiliateCommission, AffiliateCommission.order_id == Order.id)
        .where(
            AffiliateCommission.affiliate_account_id == account_id,
            AffiliateCommission.created_at >= win_start,
            AffiliateCommission.created_at < win_end,
        )
        .group_by(_utc_day(AffiliateCommission.created_at))
    )
    for d_str, amt in rev_by_day.all():
        d = datetime.fromisoformat(str(d_str)).date()
        if d in day_index:
            day_index[d]["revenue"] = int(amt)

    return days
