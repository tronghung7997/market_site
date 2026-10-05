"""Admin account directory, risk signals and the account 360 page.

Everything here is admin-only; routes live in ``auth.router``. Numeric ids are
fine in these payloads (admin console). Money is integer VND.
"""
from __future__ import annotations

import ipaddress
import re
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import and_, case, exists, func, literal_column, or_, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.logging import current_request_id
from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.login_event import LoginEvent
from src.models.order import Dispute, Order, OrderStatus
from src.models.product import Product, ProductStatus
from src.models.order import DisputeStatus
from src.models.wallet import Transaction, TransactionType, Wallet
from src.common.csv_export import csv_document

VALID_TIERS = ("new", "verified", "trusted", "enterprise")
RISKY_FAILED_LOGINS = 5
RISKY_WINDOW = timedelta(days=7)
EXPORT_ROW_LIMIT = 10_000
EXPORT_COLUMNS = (
    "id", "email", "roles", "tier", "is_active", "email_verified",
    "available_balance", "orders_bought", "orders_sold", "created_at", "last_login_at",
)
_ORDER_CODE_RE = re.compile(r"^ORD-[A-Z0-9-]+$", re.IGNORECASE)
_ID_RE = re.compile(r"^#?(\d{1,9})$")


# ── Link signals (shared phone / shared IP) ──────────────────────────────────

def _digits(col):
    return func.regexp_replace(col, "[^0-9]", "", "g")


def _phone_key(col):
    # Last 9 digits: "+84 912 345 678" and "0912.345.678" are the same line.
    return func.right(_digits(col), 9)


def _phones():
    """(account_id, digits) from the account profile and every application."""
    return union(
        select(Account.id.label("account_id"), _phone_key(Account.phone).label("digits")).where(Account.phone.is_not(None)),
        select(SellerApplication.account_id.label("account_id"), _phone_key(SellerApplication.phone).label("digits"))
        .where(SellerApplication.phone.is_not(None)),
    ).subquery()


# Private / loopback / link-local addresses are infrastructure (a reverse proxy
# or Docker network once recorded as the client), never a person: they must
# not link accounts as "same IP".
_NON_PUBLIC_IP = r"^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|::1$|f[cd][0-9a-f]{2}:|fe80:)"


def _public(column):
    return and_(column.is_not(None), ~func.lower(column).op("~")(_NON_PUBLIC_IP))


def _ips():
    """(account_id, ip) from login history and the sign-up address; public addresses only."""
    return union(
        select(LoginEvent.account_id.label("account_id"), LoginEvent.ip.label("ip")).where(_public(LoginEvent.ip)),
        select(Account.id.label("account_id"), Account.registration_ip.label("ip")).where(_public(Account.registration_ip)),
    ).subquery()


async def phone_links(db: AsyncSession, account_ids: list[int]) -> dict[int, list[dict]]:
    """Other (non-seeded) accounts sharing a phone number with each account."""
    if not account_ids:
        return {}
    mine, other = _phones().alias("mine"), _phones().alias("other")
    rows = (await db.execute(
        select(mine.c.account_id, Account.id, Account.email, Account.is_active)
        .distinct()
        .join(other, and_(other.c.digits == mine.c.digits, other.c.account_id != mine.c.account_id))
        .join(Account, Account.id == other.c.account_id)
        .where(mine.c.account_id.in_(account_ids), func.length(mine.c.digits) >= 6, Account.is_seeded.is_(False))
        .order_by(mine.c.account_id, Account.id)
    )).all()
    out: dict[int, list[dict]] = {}
    for owner, aid, email, active in rows:
        out.setdefault(owner, []).append({"id": aid, "email": email, "is_active": active})
    return out


async def ip_links(db: AsyncSession, account_ids: list[int], *, locked_only: bool, limit: int = 20) -> dict[int, list[dict]]:
    """Other accounts that used an IP this account used (optionally only locked ones)."""
    if not account_ids:
        return {}
    mine, other = _ips().alias("mine"), _ips().alias("other")
    filters = [mine.c.account_id.in_(account_ids), Account.is_seeded.is_(False)]
    if locked_only:
        filters.append(Account.is_active.is_(False))
    rows = (await db.execute(
        select(mine.c.account_id, Account.id, Account.email, Account.is_active)
        .distinct()
        .join(other, and_(other.c.ip == mine.c.ip, other.c.account_id != mine.c.account_id))
        .join(Account, Account.id == other.c.account_id)
        .where(*filters)
        .order_by(mine.c.account_id, Account.id)
    )).all()
    out: dict[int, list[dict]] = {}
    for owner, aid, email, active in rows:
        bucket = out.setdefault(owner, [])
        if len(bucket) < limit:
            bucket.append({"id": aid, "email": email, "is_active": active})
    return out


def _failed_login_ids():
    return (
        select(LoginEvent.account_id)
        .where(LoginEvent.outcome == "invalid_credentials", LoginEvent.created_at >= func.now() - RISKY_WINDOW)
        .group_by(LoginEvent.account_id)
        .having(func.count() >= RISKY_FAILED_LOGINS)
    )


def _shared_phone_with_locked_ids():
    mine, other = _phones().alias("mine_p"), _phones().alias("other_p")
    locked = Account.__table__.alias("locked_acc")
    return (
        select(mine.c.account_id)
        .join(other, and_(other.c.digits == mine.c.digits, other.c.account_id != mine.c.account_id))
        .join(locked, locked.c.id == other.c.account_id)
        .where(func.length(mine.c.digits) >= 6, locked.c.is_active.is_(False), locked.c.is_seeded.is_(False))
    )


def _risky_clause():
    return or_(Account.id.in_(_failed_login_ids()), Account.id.in_(_shared_phone_with_locked_ids()))


async def risk_flags(db: AsyncSession, account_ids: list[int]) -> dict[int, list[str]]:
    if not account_ids:
        return {}
    failed = set((await db.execute(_failed_login_ids().where(LoginEvent.account_id.in_(account_ids)))).scalars().all())
    phone_q = _shared_phone_with_locked_ids().subquery()
    shared = set((await db.execute(
        select(phone_q.c.account_id).where(phone_q.c.account_id.in_(account_ids))
    )).scalars().all())
    out: dict[int, list[str]] = {}
    for aid in account_ids:
        flags = []
        if aid in failed:
            flags.append("failed_logins")
        if aid in shared:
            flags.append("shared_phone")
        out[aid] = flags
    return out


# ── Directory ────────────────────────────────────────────────────────────────

def _search_clause(search: str):
    term = search.strip()
    id_match = _ID_RE.match(term)
    if term.startswith("#") and id_match:
        return Account.id == int(id_match.group(1))
    if _ORDER_CODE_RE.match(term):
        code = term.upper()
        return or_(
            exists().where(Order.order_code == code, Order.buyer_id == Account.id),
            exists().where(Order.order_code == code, Order.seller_id == Account.id),
        )
    try:
        ip = str(ipaddress.ip_address(term))
    except ValueError:
        ip = None
    if ip is not None:
        return or_(
            Account.registration_ip == ip,
            exists().where(LoginEvent.account_id == Account.id, LoginEvent.ip == ip),
        )
    like = f"%{term}%"
    clauses = [
        Account.email.ilike(like),
        exists().where(
            SellerApplication.account_id == Account.id,
            SellerApplication.status == ApplicationStatus.approved,
            SellerApplication.business_name.ilike(like),
        ),
    ]
    digits = re.sub(r"\D", "", term)
    if len(digits) >= 6 and re.fullmatch(r"\+?[0-9 .()-]+", term):
        clauses.append(_digits(Account.phone).contains(digits))
        clauses.append(exists().where(
            SellerApplication.account_id == Account.id, _digits(SellerApplication.phone).contains(digits),
        ))
    if id_match:
        clauses.append(Account.id == int(id_match.group(1)))
    return or_(*clauses)


def directory_filters(
    *, search: str | None = None, role: str | None = None, status: str | None = None, tier: str | None = None,
) -> list:
    # Synthetic trust-seed reviewers are never listed (see src/trust_seed).
    filters = [Account.is_seeded.is_(False)]
    if search and search.strip():
        filters.append(_search_clause(search))
    if role in {"buyer", "seller", "admin"}:
        filters.append(Account.roles.any(role))
    if status == "active":
        filters.append(Account.is_active.is_(True))
    elif status == "locked":
        filters.append(Account.is_active.is_(False))
    elif status == "unverified":
        filters.append(Account.email_verified_at.is_(None))
    elif status == "2fa":
        filters.append(Account.totp_enabled_at.is_not(None))
    elif status == "internal":
        filters.append(Account.is_internal.is_(True))
    elif status == "risky":
        filters.append(_risky_clause())
    elif status == "new_7d":
        filters.append(Account.created_at >= func.now() - literal_column("interval '7 days'"))
    tiers = [t.strip() for t in (tier or "").split(",") if t.strip() in VALID_TIERS]
    if tiers:
        filters.append(Account.seller_tier.in_(tiers))
    return filters


def _last_login_subquery():
    return (
        select(LoginEvent.account_id, func.max(LoginEvent.created_at).label("at"))
        .where(LoginEvent.outcome == "success")
        .group_by(LoginEvent.account_id)
        .subquery()
    )


async def _order_counts(db: AsyncSession, account_ids: list[int], column) -> dict[int, int]:
    if not account_ids:
        return {}
    rows = (await db.execute(
        select(column, func.count(Order.id))
        .where(column.in_(account_ids), Order.is_seeded.is_(False))
        .group_by(column)
    )).all()
    return {aid: int(n) for aid, n in rows}


# Money that actually changed hands on an order: paid (not pending/cancelled)
# minus what was refunded. Seeded (synthetic) orders never count.
_PAID_STATUSES = (OrderStatus.pending, OrderStatus.cancelled)


def _paid_amount():
    return func.coalesce(func.sum(case(
        (Order.status.notin_(_PAID_STATUSES), Order.total_amount - Order.refunded_amount), else_=0,
    )), 0)


def _party_stats_select(column):
    """(account_id, orders, paid_amount) per buyer_id or seller_id."""
    return (
        select(column.label("account_id"), func.count(Order.id).label("n"), _paid_amount().label("amount"))
        .where(Order.is_seeded.is_(False))
        .group_by(column)
    )


def _deposits_select():
    """(account_id, total) of real gateway deposits (``deposit``; admin top-ups excluded)."""
    return (
        select(Wallet.account_id.label("account_id"), func.sum(Transaction.amount).label("amount"))
        .join(Wallet, Wallet.id == Transaction.wallet_id)
        .where(Transaction.type == TransactionType.deposit)
        .group_by(Wallet.account_id)
    )


async def _party_stats(db: AsyncSession, account_ids: list[int], column) -> dict[int, tuple[int, int]]:
    if not account_ids:
        return {}
    rows = (await db.execute(_party_stats_select(column).where(column.in_(account_ids)))).all()
    return {aid: (int(n), int(amount or 0)) for aid, n, amount in rows}


async def _open_disputes(db: AsyncSession, account_ids: list[int]) -> dict[int, int]:
    """Open disputes per account, as buyer or as seller of the disputed order."""
    if not account_ids:
        return {}
    out: dict[int, int] = {}
    for column in (Order.buyer_id, Order.seller_id):
        for aid, n in (await db.execute(
            select(column, func.count(Dispute.id))
            .join(Order, Order.id == Dispute.order_id)
            .where(Dispute.status == DisputeStatus.open, column.in_(account_ids))
            .group_by(column)
        )).all():
            out[aid] = out.get(aid, 0) + int(n)
    return out


async def _shared_counts(db: AsyncSession, source, account_ids: list[int], *, min_len: bool) -> dict[int, int]:
    """Distinct other (non-seeded) accounts sharing a phone / public IP, per account."""
    if not account_ids:
        return {}
    mine, other = source().alias("mine_c"), source().alias("other_c")
    key = mine.c.digits if min_len else mine.c.ip
    other_key = other.c.digits if min_len else other.c.ip
    filters = [mine.c.account_id.in_(account_ids), Account.is_seeded.is_(False)]
    if min_len:
        filters.append(func.length(mine.c.digits) >= 6)
    rows = (await db.execute(
        select(mine.c.account_id, func.count(func.distinct(other.c.account_id)))
        .join(other, and_(other_key == key, other.c.account_id != mine.c.account_id))
        .join(Account, Account.id == other.c.account_id)
        .where(*filters)
        .group_by(mine.c.account_id)
    )).all()
    return {aid: int(n) for aid, n in rows}


async def _shop_names(db: AsyncSession, account_ids: list[int]) -> dict[int, str]:
    from src.sellers.service import approved_business_names

    return await approved_business_names(account_ids, db)


async def enrich_rows(db: AsyncSession, pairs: list[tuple[Account, datetime | None]]) -> list[dict]:
    """AccountAdminRow dicts for (account, last_login_at) pairs, batched per page:
    a fixed number of grouped queries whatever the page size (no N+1)."""
    from src.auth import schemas

    ids = [a.id for a, _ in pairs]
    wallets = {aid: (avail, locked) for aid, avail, locked in (await db.execute(
        select(Wallet.account_id, Wallet.available_balance, Wallet.locked_balance).where(Wallet.account_id.in_(ids))
    )).all()} if ids else {}
    bought = await _party_stats(db, ids, Order.buyer_id)
    sold = await _party_stats(db, ids, Order.seller_id)
    deposits = dict((await db.execute(
        _deposits_select().where(Wallet.account_id.in_(ids))
    )).all()) if ids else {}
    disputes = await _open_disputes(db, ids)
    shared_phone = await _shared_counts(db, _phones, ids, min_len=True)
    shared_ip = await _shared_counts(db, _ips, ids, min_len=False)
    shops = await _shop_names(db, ids)
    flags = await risk_flags(db, ids)
    locker_ids = {a.locked_by_id for a, _ in pairs if a.locked_by_id}
    lockers = dict((await db.execute(
        select(Account.id, Account.email).where(Account.id.in_(locker_ids))
    )).all()) if locker_ids else {}
    items = []
    for account, seen_at in pairs:
        row = schemas.AccountAdminRow.model_validate(account).model_dump()
        avail, locked = wallets.get(account.id, (0, 0))
        n_bought, spent = bought.get(account.id, (0, 0))
        n_sold, revenue = sold.get(account.id, (0, 0))
        row.update(
            last_login_at=seen_at,
            available_balance=int(avail or 0),
            locked_balance=int(locked or 0),
            orders_bought=n_bought,
            orders_sold=n_sold,
            total_spent=spent,
            total_revenue=revenue,
            total_deposited=int(deposits.get(account.id) or 0),
            open_disputes=disputes.get(account.id, 0),
            shared_phone_accounts=shared_phone.get(account.id, 0),
            shared_ip_accounts=shared_ip.get(account.id, 0),
            shop_name=shops.get(account.id),
            locked_by_email=lockers.get(account.locked_by_id),
            risk_flags=flags.get(account.id, []),
        )
        if account.is_active:
            row.update(lock_reason=None, locked_at=None, locked_by_email=None)
        items.append(row)
    return items


async def account_row(db: AsyncSession, account: Account) -> dict:
    seen_at = await db.scalar(
        select(func.max(LoginEvent.created_at)).where(LoginEvent.account_id == account.id, LoginEvent.outcome == "success")
    )
    return (await enrich_rows(db, [(account, seen_at)]))[0]


# sort key -> default direction. ``newest``/``oldest`` are the legacy names of
# ``created`` desc/asc; every other key takes an optional ``dir`` override.
SORT_KEYS = {
    "created": "desc", "email": "asc", "last_login": "desc", "balance": "desc",
    "orders_bought": "desc", "orders_sold": "desc", "spent": "desc", "revenue": "desc",
    "deposited": "desc", "disputes": "desc", "risk": "desc",
}
_SORT_ALIASES = {"newest": ("created", "desc"), "oldest": ("created", "asc")}


def resolve_sort(sort: str | None, direction: str | None = None) -> tuple[str, str]:
    """(key, dir) for a sort param; unknown keys fall back to newest first."""
    if sort in _SORT_ALIASES:
        key, default = _SORT_ALIASES[sort]
    elif sort in SORT_KEYS:
        key, default = sort, SORT_KEYS[sort]
    else:
        key, default = "created", "desc"
    return key, direction if direction in ("asc", "desc") else default


def _risk_score():
    return (
        case((Account.id.in_(_failed_login_ids()), 1), else_=0)
        + case((Account.id.in_(_shared_phone_with_locked_ids()), 1), else_=0)
        + case((Account.is_active.is_(False), 1), else_=0)
    )


def _directory_select(filters: list, sort: str, direction: str | None = None):
    key, dir_ = resolve_sort(sort, direction)
    last_login = _last_login_subquery()
    stmt = (
        select(Account, last_login.c.at)
        .outerjoin(last_login, last_login.c.account_id == Account.id)
        .where(*filters)
    )
    if key == "created":
        expr = Account.id
    elif key == "email":
        expr = Account.email
    elif key == "last_login":
        expr = last_login.c.at
    elif key == "balance":
        stmt = stmt.outerjoin(Wallet, Wallet.account_id == Account.id)
        expr = func.coalesce(Wallet.available_balance, 0)
    elif key in ("orders_bought", "spent", "orders_sold", "revenue"):
        stats = _party_stats_select(Order.buyer_id if key in ("orders_bought", "spent") else Order.seller_id).subquery()
        stmt = stmt.outerjoin(stats, stats.c.account_id == Account.id)
        expr = func.coalesce(stats.c.n if key.startswith("orders") else stats.c.amount, 0)
    elif key == "deposited":
        dep = _deposits_select().subquery()
        stmt = stmt.outerjoin(dep, dep.c.account_id == Account.id)
        expr = func.coalesce(dep.c.amount, 0)
    elif key == "disputes":
        party = union(
            select(Order.buyer_id.label("account_id"), Dispute.id.label("dispute_id"))
            .join(Dispute, Dispute.order_id == Order.id).where(Dispute.status == DisputeStatus.open),
            select(Order.seller_id.label("account_id"), Dispute.id.label("dispute_id"))
            .join(Dispute, Dispute.order_id == Order.id).where(Dispute.status == DisputeStatus.open),
        ).subquery()
        open_q = (
            select(party.c.account_id, func.count().label("n")).group_by(party.c.account_id).subquery()
        )
        stmt = stmt.outerjoin(open_q, open_q.c.account_id == Account.id)
        expr = func.coalesce(open_q.c.n, 0)
    else:  # risk
        expr = _risk_score()
    ordered = expr.asc() if dir_ == "asc" else expr.desc()
    if key == "last_login":
        ordered = ordered.nulls_last()
    tie = Account.id.asc() if dir_ == "asc" else Account.id.desc()
    return stmt.order_by(ordered, tie) if key != "created" else stmt.order_by(ordered)


async def list_accounts(
    db: AsyncSession,
    search: str | None = None,
    page: int = 1,
    per_page: int = 20,
    *,
    role: str | None = None,
    status: str | None = None,
    tier: str | None = None,
    sort: str = "newest",
    direction: str | None = None,
) -> dict:
    filters = directory_filters(search=search, role=role, status=status, tier=tier)
    total = int(await db.scalar(select(func.count(Account.id)).where(*filters)) or 0)
    rows = (await db.execute(
        _directory_select(filters, sort, direction).offset((page - 1) * per_page).limit(per_page)
    )).all()
    items = await enrich_rows(db, [(a, at) for a, at in rows])

    summary_row = (await db.execute(select(
        func.count(Account.id),
        func.sum(case((Account.roles.any("buyer"), 1), else_=0)),
        func.sum(case((Account.roles.any("seller"), 1), else_=0)),
        func.sum(case((Account.roles.any("admin"), 1), else_=0)),
        func.sum(case((Account.is_active.is_(False), 1), else_=0)),
        func.sum(case((Account.email_verified_at.is_(None), 1), else_=0)),
        func.sum(case((Account.totp_enabled_at.is_not(None), 1), else_=0)),
        func.sum(case((Account.is_internal.is_(True), 1), else_=0)),
        func.sum(case((Account.created_at >= func.now() - literal_column("interval '7 days'"), 1), else_=0)),
        func.sum(case((_risky_clause(), 1), else_=0)),
    ).where(Account.is_seeded.is_(False)))).one()
    keys = ("all", "buyers", "sellers", "admins", "locked", "unverified", "twofa", "internal", "new_7d", "risky")
    summary = {k: int(v or 0) for k, v in zip(keys, summary_row)}
    return {"items": items, "total": total, "page": page, "per_page": per_page, "summary": summary}


async def export_accounts_csv(
    db: AsyncSession, *, search: str | None, role: str | None, status: str | None, tier: str | None, sort: str,
    ids: list[int] | None = None, direction: str | None = None,
) -> str:
    """CSV of the directory. ``ids`` (a selection) replaces the filters."""
    if ids:
        filters = [Account.is_seeded.is_(False), Account.id.in_(ids)]
    else:
        filters = directory_filters(search=search, role=role, status=status, tier=tier)
    rows = (await db.execute(_directory_select(filters, sort, direction).limit(EXPORT_ROW_LIMIT))).all()
    ids = [a.id for a, _ in rows]
    balances = dict((await db.execute(
        select(Wallet.account_id, Wallet.available_balance).where(Wallet.account_id.in_(ids))
    )).all()) if ids else {}
    bought = await _order_counts(db, ids, Order.buyer_id)
    sold = await _order_counts(db, ids, Order.seller_id)
    out = []
    for account, seen_at in rows:
        tier = account.seller_tier.value if hasattr(account.seller_tier, "value") else account.seller_tier
        out.append([
            account.id, account.email, " ".join(account.roles or []), tier,
            account.is_active, account.email_verified,
            int(balances.get(account.id) or 0), bought.get(account.id, 0), sold.get(account.id, 0),
            account.created_at, seen_at,
        ])
    return csv_document(EXPORT_COLUMNS, out)


# ── Lock / bulk lock ─────────────────────────────────────────────────────────

async def apply_account_active(
    account: Account, is_active: bool, db: AsyncSession, *, actor_id: int, reason: str | None, ip: str | None,
) -> None:
    """State change + side effects of a lock/unlock inside the caller's
    transaction (caller holds the row lock and commits)."""
    from src.auth.service import _record_login_event
    from src.auth.sessions import revoke_all_sessions
    from src.security.events import security_event

    clean_reason = (reason or "").strip()[:500] or None
    account.is_active = is_active
    if is_active:
        account.lock_reason = account.locked_at = account.locked_by_id = None
    else:
        account.lock_reason = clean_reason
        account.locked_at = datetime.now(timezone.utc)
        account.locked_by_id = actor_id
        await revoke_all_sessions(account.id, db)
    _record_login_event(
        db, account.id, kind="unlocked" if is_active else "locked", outcome="success",
        ip=ip, user_agent=None, actor_id=actor_id,
    )
    await log_event(
        db, "warning",
        f"Account {account.id} {'unlocked' if is_active else 'locked'}",
        request_id=current_request_id(),
        metadata={
            "event": "account_unlocked" if is_active else "account_locked",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "account",
            "subject_id": account.id,
            "outcome": "success",
            "source": "admin",
            "reason": clean_reason,
        },
    )
    security_event(
        "account_unlocked" if is_active else "account_locked",
        level="warning",
        account_id=account.id,
        actor_id=actor_id,
    )


async def bulk_set_active(
    ids: list[int], is_active: bool, db: AsyncSession, *, actor_id: int, reason: str | None, ip: str | None,
) -> dict:
    wanted = list(dict.fromkeys(ids))
    # Lock rows in id order so two concurrent bulk calls cannot deadlock.
    accounts = {a.id: a for a in (await db.execute(
        select(Account).where(Account.id.in_(wanted)).order_by(Account.id).with_for_update()
    )).scalars().all()}
    updated, skipped = [], []
    for aid in wanted:
        account = accounts.get(aid)
        if account is None or account.is_seeded:
            skipped.append({"id": aid, "reason": "not_found"})
        elif aid == actor_id and not is_active:
            skipped.append({"id": aid, "reason": "self"})
        elif account.is_active == is_active:
            skipped.append({"id": aid, "reason": "unchanged"})
        else:
            await apply_account_active(account, is_active, db, actor_id=actor_id, reason=reason, ip=ip)
            updated.append(aid)
    await db.commit()
    return {"updated": updated, "skipped": skipped}


# ── Account 360 ──────────────────────────────────────────────────────────────

async def _get_account(db: AsyncSession, account_id: int, *, for_update: bool = False) -> Account:
    account = await db.get(Account, account_id, with_for_update=for_update)
    if account is None or account.is_seeded:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    return account


async def ensure_account(db: AsyncSession, account_id: int) -> Account:
    return await _get_account(db, account_id)


def _admin_action_text(meta: dict) -> str:
    event = meta.get("event") or "admin_action"
    detail = meta.get("reason") or meta.get("new_tier") or meta.get("new_roles")
    if isinstance(detail, list):
        detail = ", ".join(detail)
    return f"{event}: {detail}" if detail else event


async def account_overview(db: AsyncSession, account_id: int) -> dict:
    from src.auth.sessions import list_active_sessions
    from src.sellers.service import seller_public_ref
    from src.wallet.service import escrow_snapshot

    account = await _get_account(db, account_id)
    row = await account_row(db, account)
    _, escrow_incoming = await escrow_snapshot(account_id, db)
    since = datetime.now(timezone.utc) - timedelta(days=30)
    gmv_30d = int(await db.scalar(
        select(func.coalesce(func.sum(Order.total_amount - Order.refunded_amount), 0)).where(
            Order.seller_id == account_id, Order.is_seeded.is_(False), Order.created_at >= since,
            Order.status.not_in((OrderStatus.cancelled, OrderStatus.refunded)),
        )
    ) or 0)
    sold_dispute_count = int(await db.scalar(
        select(func.count(Dispute.id)).join(Order, Order.id == Dispute.order_id).where(Order.seller_id == account_id)
    ) or 0)
    disputes = int(await db.scalar(
        select(func.count(Dispute.id)).join(Order, Order.id == Dispute.order_id)
        .where(or_(Dispute.buyer_id == account_id, Order.seller_id == account_id))
    ) or 0)
    orders_sold = row["orders_sold"]
    kpis = {
        "available_balance": row["available_balance"],
        "escrow_incoming": escrow_incoming,
        "gmv_30d": gmv_30d,
        "dispute_rate_pct": round(sold_dispute_count * 100 / orders_sold, 1) if orders_sold else None,
        "orders_bought": row["orders_bought"],
        "orders_sold": orders_sold,
        "disputes": disputes,
    }
    lock = None
    if not account.is_active:
        lock = {"reason": row["lock_reason"], "at": row["locked_at"], "by_email": row["locked_by_email"]}

    app = await db.scalar(
        select(SellerApplication).where(SellerApplication.account_id == account_id)
        .order_by(SellerApplication.created_at.desc(), SellerApplication.id.desc()).limit(1)
    )
    application = {"id": app.id, "status": app.status.value, "reviewed_at": app.reviewed_at} if app else None
    shop = None
    if "seller" in (account.roles or []) and row["shop_name"]:
        shop = {"name": row["shop_name"], "path": seller_public_ref(account.public_key, row["shop_name"])["canonical_path"]}
    active_products = int(await db.scalar(
        select(func.count(Product.id)).where(Product.seller_id == account_id, Product.status == ProductStatus.active)
    ) or 0)
    sessions_active = len(await list_active_sessions(account_id, db))

    related: list[dict] = []
    seen: set[int] = set()
    for reason, links in (
        ("phone", (await phone_links(db, [account_id])).get(account_id, [])),
        ("ip", (await ip_links(db, [account_id], locked_only=False)).get(account_id, [])),
    ):
        for link in links:
            if link["id"] not in seen and len(related) < 20:
                seen.add(link["id"])
                related.append({**link, "reason": reason})

    return {
        "account": row, "kpis": kpis, "lock": lock, "application": application, "shop": shop,
        "active_product_count": active_products, "sessions_active": sessions_active,
        "related": related, "timeline": await _timeline(db, account_id),
    }


TIMELINE_LIMIT = 30


async def _timeline(db: AsyncSession, account_id: int) -> list[dict]:
    from src.models.log_entry import LogEntry
    from src.models.seller_tier_event import SellerTierEvent

    n = TIMELINE_LIMIT
    events: list[dict] = []
    for ev in (await db.execute(
        select(LoginEvent).where(LoginEvent.account_id == account_id)
        .order_by(LoginEvent.created_at.desc()).limit(n)
    )).scalars():
        if ev.kind in ("locked", "unlocked"):
            continue  # the audit row below carries the reason
        events.append({"at": ev.created_at, "kind": "login" if ev.outcome == "success" else "login_failed",
                       "text": f"{ev.kind} · {ev.outcome}" + (f" · {ev.ip}" if ev.ip else ""), "href": None})
    for order in (await db.execute(
        select(Order).where(or_(Order.buyer_id == account_id, Order.seller_id == account_id), Order.is_seeded.is_(False))
        .order_by(Order.created_at.desc()).limit(n)
    )).scalars():
        side = "order_bought" if order.buyer_id == account_id else "order_sold"
        status = order.status.value if hasattr(order.status, "value") else order.status
        events.append({"at": order.created_at, "kind": side, "text": f"{order.order_code} · {status}",
                       "href": f"/admin/orders/{order.id}"})
    for dispute, code in (await db.execute(
        select(Dispute, Order.order_code).join(Order, Order.id == Dispute.order_id)
        .where(or_(Dispute.buyer_id == account_id, Order.seller_id == account_id))
        .order_by(Dispute.created_at.desc()).limit(n)
    )).all():
        status = dispute.status.value if hasattr(dispute.status, "value") else dispute.status
        events.append({"at": dispute.created_at, "kind": "dispute", "text": f"{code} · {status}",
                       "href": f"/admin/disputes/{dispute.id}"})
    for tier_ev in (await db.execute(
        select(SellerTierEvent).where(SellerTierEvent.account_id == account_id)
        .order_by(SellerTierEvent.created_at.desc()).limit(n)
    )).scalars():
        events.append({"at": tier_ev.created_at, "kind": "tier_change",
                       "text": f"{tier_ev.old_tier} → {tier_ev.new_tier}" + (f" · {tier_ev.reason}" if tier_ev.reason else ""),
                       "href": None})
    for app in (await db.execute(
        select(SellerApplication).where(SellerApplication.account_id == account_id)
        .order_by(SellerApplication.created_at.desc()).limit(5)
    )).scalars():
        href = f"/admin/seller-applications?app={app.id}"
        events.append({"at": app.created_at, "kind": "application_submitted", "text": app.business_name, "href": href})
        if app.info_requested_at:
            events.append({"at": app.info_requested_at, "kind": "application_info_requested", "text": app.info_request, "href": href})
        if app.info_responded_at:
            events.append({"at": app.info_responded_at, "kind": "application_resubmitted", "text": None, "href": href})
        if app.reviewed_at and app.status in (ApplicationStatus.approved, ApplicationStatus.rejected):
            events.append({"at": app.reviewed_at, "kind": f"application_{app.status.value}",
                           "text": app.reject_reason if app.status == ApplicationStatus.rejected else None, "href": href})
    for entry in (await db.execute(
        select(LogEntry).where(
            LogEntry.metadata_["subject_type"].astext == "account",
            LogEntry.metadata_["subject_id"].astext == str(account_id),
            LogEntry.metadata_["actor_type"].astext == "admin",
        ).order_by(LogEntry.created_at.desc()).limit(n)
    )).scalars():
        events.append({"at": entry.created_at, "kind": "admin_action", "text": _admin_action_text(entry.metadata_ or {}),
                       "href": None})
    events.sort(key=lambda e: e["at"], reverse=True)
    return events[:n]


async def revoke_sessions(db: AsyncSession, account_id: int, *, actor_id: int) -> int:
    from src.auth.sessions import list_active_sessions, revoke_all_sessions

    await _get_account(db, account_id, for_update=True)
    revoked = len(await list_active_sessions(account_id, db))
    await revoke_all_sessions(account_id, db)
    await log_event(
        db, "warning", f"Sessions revoked for account {account_id}",
        request_id=current_request_id(),
        metadata={
            "event": "account_sessions_revoked", "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "account", "subject_id": account_id, "outcome": "success", "source": "admin",
            "revoked": revoked,
        },
    )
    await db.commit()
    return revoked


async def send_password_reset(db: AsyncSession, account_id: int, *, actor_id: int) -> None:
    """Mail the owner the standard reset link (same token/outbox path as
    "forgot password"). The admin never sees the link."""
    from src.auth.service import request_password_reset

    account = await _get_account(db, account_id)
    if not account.is_active:
        raise HTTPException(status_code=400, detail="Tài khoản đang bị khóa")
    email, locale = account.email, account.preferred_locale or "vi"
    await log_event(
        db, "warning", f"Password reset mail sent by admin for account {account_id}",
        request_id=current_request_id(),
        metadata={
            "event": "password_reset_sent_by_admin", "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "account", "subject_id": account_id, "outcome": "success", "source": "admin",
        },
    )
    # request_password_reset commits the audit row above together with the token + mail.
    await request_password_reset(email, locale, db)


async def seller_activity(db: AsyncSession, account_id: int) -> tuple[int, int]:
    """(active products, escrow incoming) — what removing the seller role would strand."""
    from src.wallet.service import escrow_snapshot

    active = int(await db.scalar(
        select(func.count(Product.id)).where(Product.seller_id == account_id, Product.status == ProductStatus.active)
    ) or 0)
    _, incoming = await escrow_snapshot(account_id, db)
    return active, incoming
