from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.account import Account
from src.models.affiliate import AffiliateClick, AffiliateCommission
from src.models.order import Order


async def record_click(code: str, db: AsyncSession, path: str | None = None, referrer: str | None = None) -> None:
    affiliate = await db.scalar(select(Account).where(Account.affiliate_code == code))
    if not affiliate:
        return
    db.add(
        AffiliateClick(
            affiliate_account_id=affiliate.id,
            path=path,
            referrer=referrer,
        )
    )
    await db.commit()


def _parse_range(date_from: str | None, date_to: str | None) -> tuple[datetime | None, datetime | None]:
    start = datetime.fromisoformat(date_from) if date_from else None
    end = datetime.fromisoformat(date_to) + timedelta(days=1) if date_to else None
    return start, end


async def get_affiliate_stats(
    account_id: int,
    db: AsyncSession,
    date_from: str | None = None,
    date_to: str | None = None,
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
            from src.models.product import Product

            product = await db.get(Product, order.product_id)
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
    }


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

    clicks_by_day = await db.execute(
        select(func.date(AffiliateClick.created_at), func.count(AffiliateClick.id))
        .where(AffiliateClick.affiliate_account_id == account_id)
        .group_by(func.date(AffiliateClick.created_at))
    )
    for d_str, cnt in clicks_by_day.all():
        d = datetime.fromisoformat(str(d_str)).date()
        if d in day_index:
            day_index[d]["clicks"] = int(cnt)

    signups_by_day = await db.execute(
        select(func.date(Account.created_at), func.count(Account.id))
        .where(Account.referred_by_id == account_id)
        .group_by(func.date(Account.created_at))
    )
    for d_str, cnt in signups_by_day.all():
        d = datetime.fromisoformat(str(d_str)).date()
        if d in day_index:
            day_index[d]["signups"] = int(cnt)

    comm_by_day = await db.execute(
        select(
            func.date(AffiliateCommission.created_at),
            func.count(AffiliateCommission.id),
            func.coalesce(func.sum(AffiliateCommission.amount), 0),
        )
        .where(AffiliateCommission.affiliate_account_id == account_id)
        .group_by(func.date(AffiliateCommission.created_at))
    )
    for d_str, cnt, amt in comm_by_day.all():
        d = datetime.fromisoformat(str(d_str)).date()
        if d in day_index:
            day_index[d]["orders"] = int(cnt)
            day_index[d]["commission"] = int(amt)

    rev_by_day = await db.execute(
        select(
            func.date(AffiliateCommission.created_at),
            func.coalesce(func.sum(Order.total_amount), 0),
        )
        .join(AffiliateCommission, AffiliateCommission.order_id == Order.id)
        .where(AffiliateCommission.affiliate_account_id == account_id)
        .group_by(func.date(AffiliateCommission.created_at))
    )
    for d_str, amt in rev_by_day.all():
        d = datetime.fromisoformat(str(d_str)).date()
        if d in day_index:
            day_index[d]["revenue"] = int(amt)

    return days
