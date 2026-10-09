"""Promo codes: evaluation at checkout and the admin campaign console.

`orders.service` is the only checkout caller: it asks `apply_code` for the
discount (the promotion row — and a child code's row — stay locked until the
order commits, so usage/budget ceilings and single-use codes hold under
concurrent orders) and then `record_redemption` once the order has an id.
Every rule is a column of `promotions`, so a new campaign never needs a deploy.

A campaign may also own single-use child codes (`promotion_codes`, see
`promotions.codes`): each one carries the parent's offer and limits and pays
for one order. The parent code keeps working unless its `usage_limit` says
otherwise.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.affiliate.attribution import attribute_via_promotion
from src.audit.service import log_event
from src.common.pagination import PageParams, paginate
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.logging import current_request_id
from src.models.account import Account
from src.models.category import Category
from src.models.order import Order, OrderStatus
from src.models.promotion import DiscountType, Promotion, PromotionCode, PromotionRedemption
from src.promotions.schemas import CODE_PATTERN as _CODE_REGEX
from src.promotions.validation import PromotionValidationError, normalize_code, validate_promotion

# Checkout accepts campaign codes and child codes; both fit this shape.
CODE_PATTERN = re.compile(_CODE_REGEX)
EDITABLE_FIELDS = (
    "code", "name", "note", "discount_type", "discount_value", "max_discount_amount", "min_order_amount",
    "starts_at", "ends_at", "usage_limit", "per_buyer_limit", "budget_amount", "category_ids",
    "new_buyers_only", "is_active", "affiliate_account_id",
)
VN_TZ = "Asia/Ho_Chi_Minh"
ATTENTION_RATIO = 0.85
ENDING_WINDOW = timedelta(hours=48)


@dataclass(frozen=True)
class AppliedPromo:
    promotion_id: int
    # The code the buyer typed (campaign code or child code), stored on the order.
    code: str
    discount: int
    code_id: int | None = None
    # KOL campaign: who earns this order's commission (snapshot on the redemption).
    affiliate_account_id: int | None = None


def discount_for(discount_type: DiscountType, value: int, max_discount: int | None, subtotal: int) -> int:
    """Discount on `subtotal` before usage/budget ceilings. The buyer always
    pays at least 1 đ: escrow, refunds and the ledger all assume an order
    holds money."""
    if discount_type == DiscountType.percent:
        amount = subtotal * value // 100
        if max_discount is not None:
            amount = min(amount, max_discount)
    else:
        amount = value
    return max(0, min(amount, subtotal - 1))


def _live_redemptions():
    """Redemptions that still count: a cancelled order gives its use back."""
    return (
        select(PromotionRedemption)
        .join(Order, Order.id == PromotionRedemption.order_id)
        .where(Order.status != OrderStatus.cancelled)
    )


async def _usage(db: AsyncSession, promotion_id: int, buyer_id: int | None = None) -> tuple[int, int, int]:
    """(uses, discount given, uses by this buyer) over live redemptions."""
    live = _live_redemptions().where(PromotionRedemption.promotion_id == promotion_id).subquery()
    uses, spent = (await db.execute(
        select(func.count(live.c.id), func.coalesce(func.sum(live.c.discount_amount), 0))
    )).one()
    mine = 0
    if buyer_id is not None:
        mine = int(await db.scalar(select(func.count(live.c.id)).where(live.c.buyer_id == buyer_id)) or 0)
    return int(uses), int(spent), mine


async def _category_chain(db: AsyncSession, category_id: int | None) -> set[int]:
    """The category and all its ancestors (a campaign on a parent covers children)."""
    chain: set[int] = set()
    current = category_id
    while current is not None and current not in chain:
        chain.add(current)
        current = await db.scalar(select(Category.parent_id).where(Category.id == current))
    return chain


async def _has_prior_order(db: AsyncSession, buyer_id: int) -> bool:
    return bool(await db.scalar(
        select(Order.id).where(
            Order.buyer_id == buyer_id, Order.status != OrderStatus.cancelled, Order.is_seeded.is_(False),
        ).limit(1)
    ))


async def _resolve_code(db: AsyncSession, code: str, *, lock: bool) -> tuple[Promotion | None, PromotionCode | None]:
    """The campaign behind a typed code, and the child code row if it is one.

    Lock order is always campaign → child code, so two checkouts of the same
    campaign cannot deadlock; the campaign lock alone already serialises
    them, and the child row lock + conditional update in `record_redemption`
    keep a child code single-use even if that ever changes."""
    stmt = select(Promotion).where(Promotion.code == code)
    if lock:
        stmt = stmt.with_for_update()
    promo = await db.scalar(stmt)
    if promo is not None:
        return promo, None
    parent_id = await db.scalar(select(PromotionCode.promotion_id).where(PromotionCode.code == code))
    if parent_id is None:
        return None, None
    parent_stmt = select(Promotion).where(Promotion.id == parent_id)
    child_stmt = select(PromotionCode).where(PromotionCode.code == code)
    if lock:
        parent_stmt = parent_stmt.with_for_update()
        child_stmt = child_stmt.with_for_update()
    promo = await db.scalar(parent_stmt)
    child = await db.scalar(child_stmt)
    return promo, child


async def apply_code(
    db: AsyncSession, raw_code: str, *, buyer_id: int, category_id: int | None, subtotal: int, lock: bool,
) -> AppliedPromo:
    """Check every rule of the campaign behind `raw_code` for this order and
    return the discount. `lock=True` (order creation) holds the promotion row
    (and a child code's row) until the caller's transaction ends; a quote
    passes False and writes nothing."""
    code = normalize_code(raw_code)
    if not CODE_PATTERN.match(code):
        raise api_error(ErrorCode.PROMO_NOT_FOUND, status.HTTP_400_BAD_REQUEST)
    promo, child = await _resolve_code(db, code, lock=lock)
    if promo is None or not promo.is_active or promo.archived_at is not None:
        raise api_error(ErrorCode.PROMO_NOT_FOUND, status.HTTP_400_BAD_REQUEST)
    if child is not None and child.redeemed_order_id is not None:
        raise api_error(ErrorCode.PROMO_EXHAUSTED, status.HTTP_400_BAD_REQUEST)
    if promo.affiliate_account_id is not None and promo.affiliate_account_id == buyer_id:
        # A KOL's own code is for their audience: using it would be a
        # self-referral on a platform-funded discount.
        raise api_error(ErrorCode.PROMO_OWN_CODE, status.HTTP_400_BAD_REQUEST)

    now = datetime.now(timezone.utc)
    if promo.starts_at and now < promo.starts_at:
        raise api_error(ErrorCode.PROMO_NOT_STARTED, status.HTTP_400_BAD_REQUEST, starts_at=promo.starts_at.isoformat())
    if promo.ends_at and now >= promo.ends_at:
        raise api_error(ErrorCode.PROMO_EXPIRED, status.HTTP_400_BAD_REQUEST)
    if subtotal < promo.min_order_amount:
        raise api_error(ErrorCode.PROMO_MIN_ORDER, status.HTTP_400_BAD_REQUEST, min=promo.min_order_amount)
    if promo.category_ids and not (set(promo.category_ids) & await _category_chain(db, category_id)):
        raise api_error(ErrorCode.PROMO_NOT_APPLICABLE, status.HTTP_400_BAD_REQUEST)
    if promo.new_buyers_only and await _has_prior_order(db, buyer_id):
        raise api_error(ErrorCode.PROMO_NEW_BUYERS_ONLY, status.HTTP_400_BAD_REQUEST)

    uses, spent, mine = await _usage(db, promo.id, buyer_id)
    if promo.per_buyer_limit is not None and mine >= promo.per_buyer_limit:
        raise api_error(ErrorCode.PROMO_ALREADY_USED, status.HTTP_400_BAD_REQUEST)
    if promo.usage_limit is not None and uses >= promo.usage_limit:
        raise api_error(ErrorCode.PROMO_EXHAUSTED, status.HTTP_400_BAD_REQUEST)

    discount = discount_for(promo.discount_type, promo.discount_value, promo.max_discount_amount, subtotal)
    if promo.budget_amount is not None:
        remaining_budget = promo.budget_amount - spent
        if remaining_budget <= 0:
            raise api_error(ErrorCode.PROMO_EXHAUSTED, status.HTTP_400_BAD_REQUEST)
        # The last order of a campaign gets what is left of the budget.
        discount = min(discount, remaining_budget)
    if discount <= 0:
        raise api_error(ErrorCode.PROMO_NOT_APPLICABLE, status.HTTP_400_BAD_REQUEST)
    return AppliedPromo(
        promotion_id=promo.id, code=code, discount=discount, code_id=child.id if child else None,
        affiliate_account_id=promo.affiliate_account_id,
    )


async def record_redemption(db: AsyncSession, applied: AppliedPromo, order: Order) -> None:
    """Count the use against the campaign, in the order's transaction. A
    child code is marked redeemed by a conditional update: if another order
    got it first the whole order fails with PROMO_EXHAUSTED. A KOL campaign
    snapshots its KOL on the redemption (this order's commission is theirs)
    and attaches a buyer who has no referrer yet to that KOL."""
    if applied.code_id is not None:
        result = await db.execute(
            update(PromotionCode)
            .where(PromotionCode.id == applied.code_id, PromotionCode.redeemed_order_id.is_(None))
            .values(redeemed_order_id=order.id, redeemed_at=func.now())
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            raise api_error(ErrorCode.PROMO_EXHAUSTED, status.HTTP_400_BAD_REQUEST)
    db.add(PromotionRedemption(
        promotion_id=applied.promotion_id, order_id=order.id, buyer_id=order.buyer_id,
        discount_amount=applied.discount, code=applied.code,
        affiliate_account_id=applied.affiliate_account_id,
    ))
    if applied.affiliate_account_id is not None:
        await attribute_via_promotion(
            db, buyer_id=order.buyer_id, affiliate_id=applied.affiliate_account_id,
            promotion_id=applied.promotion_id,
        )


# ── Admin console: campaign view ─────────────────────────────────────────────

def campaign_state(promo: Promotion, uses: int, spent: int, now: datetime) -> str:
    """One word the console shows: archived / paused / ended / exhausted / scheduled / running."""
    if promo.archived_at is not None:
        return "archived"
    if not promo.is_active:
        return "paused"
    if promo.ends_at and now >= promo.ends_at:
        return "ended"
    if (promo.usage_limit is not None and uses >= promo.usage_limit) or (
        promo.budget_amount is not None and spent >= promo.budget_amount
    ):
        return "exhausted"
    if promo.starts_at and now < promo.starts_at:
        return "scheduled"
    return "running"


@dataclass
class _Usage:
    uses: int = 0
    spent: int = 0
    gmv: int = 0
    burn_7d: int = 0
    code_count: int = 0
    codes_redeemed: int = 0


def attention_reason(promo: Promotion, state: str, u: _Usage, now: datetime) -> str | None:
    if promo.archived_at is None and promo.is_active and promo.ends_at and now >= promo.ends_at:
        return "expired_active"
    if state != "running":
        return None
    if promo.budget_amount and u.spent >= promo.budget_amount * ATTENTION_RATIO:
        return "budget"
    if promo.usage_limit and u.uses >= promo.usage_limit * ATTENTION_RATIO:
        return "uses"
    if promo.ends_at and promo.ends_at - now <= ENDING_WINDOW:
        return "ending"
    return None


def budget_eta_days(promo: Promotion, u: _Usage) -> float | None:
    if not promo.budget_amount or u.burn_7d <= 0:
        return None
    remaining = promo.budget_amount - u.spent
    if remaining <= 0:
        return 0.0
    return round(remaining / (u.burn_7d / 7), 1)


def current_values(promo: Promotion) -> dict:
    return {field: getattr(promo, field) for field in EDITABLE_FIELDS}


def _view(promo: Promotion, u: _Usage, now: datetime, emails: dict[int, str] | None = None) -> dict:
    state = campaign_state(promo, u.uses, u.spent, now)
    return {
        **current_values(promo),
        "affiliate_email": (emails or {}).get(promo.affiliate_account_id) if promo.affiliate_account_id else None,
        "id": promo.id,
        "uses": u.uses,
        "discount_given": u.spent,
        "state": state,
        "archived_at": promo.archived_at,
        "code_count": u.code_count,
        "codes_redeemed": u.codes_redeemed,
        "gmv": u.gmv,
        "attention_reason": attention_reason(promo, state, u, now),
        "budget_eta_days": budget_eta_days(promo, u),
        "created_at": promo.created_at,
        "updated_at": promo.updated_at,
    }


async def _usage_by_promotion(db: AsyncSession, promotion_ids: list[int], now: datetime) -> dict[int, _Usage]:
    out = {pid: _Usage() for pid in promotion_ids}
    if not promotion_ids:
        return out
    week_ago = now - timedelta(days=7)
    rows = await db.execute(
        select(
            PromotionRedemption.promotion_id,
            func.count(PromotionRedemption.id),
            func.coalesce(func.sum(PromotionRedemption.discount_amount), 0),
            func.coalesce(func.sum(Order.total_amount), 0),
            func.coalesce(func.sum(PromotionRedemption.discount_amount).filter(
                PromotionRedemption.created_at >= week_ago), 0),
        )
        .join(Order, Order.id == PromotionRedemption.order_id)
        .where(Order.status != OrderStatus.cancelled, PromotionRedemption.promotion_id.in_(promotion_ids))
        .group_by(PromotionRedemption.promotion_id)
    )
    for pid, n, spent, gmv, burn in rows.all():
        u = out[pid]
        u.uses, u.spent, u.gmv, u.burn_7d = int(n), int(spent), int(gmv), int(burn)
    code_rows = await db.execute(
        select(
            PromotionCode.promotion_id, func.count(PromotionCode.id),
            func.count(PromotionCode.redeemed_order_id),
        )
        .where(PromotionCode.promotion_id.in_(promotion_ids))
        .group_by(PromotionCode.promotion_id)
    )
    for pid, total, redeemed in code_rows.all():
        out[pid].code_count, out[pid].codes_redeemed = int(total), int(redeemed)
    return out


async def _get(db: AsyncSession, promotion_id: int, *, lock: bool = False) -> Promotion:
    stmt = select(Promotion).where(Promotion.id == promotion_id)
    if lock:
        stmt = stmt.with_for_update()
    promo = await db.scalar(stmt)
    if promo is None:
        raise api_error(ErrorCode.PROMO_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return promo


async def _affiliate_emails(db: AsyncSession, promos: list[Promotion]) -> dict[int, str]:
    ids = {p.affiliate_account_id for p in promos if p.affiliate_account_id}
    if not ids:
        return {}
    return dict((await db.execute(select(Account.id, Account.email).where(Account.id.in_(ids)))).all())


async def get_promotion(db: AsyncSession, promotion_id: int) -> dict:
    promo = await _get(db, promotion_id)
    now = datetime.now(timezone.utc)
    return _view(
        promo, (await _usage_by_promotion(db, [promo.id], now))[promo.id], now, await _affiliate_emails(db, [promo]),
    )


_DONE = {"ended", "exhausted"}


async def list_promotions(
    db: AsyncSession, *, q: str | None = None, state: str | None = None, sort: str = "updated",
    params: PageParams = PageParams(),
) -> dict:
    """The console list. Campaigns are few (hundreds at most), so views are
    computed for all of them in two grouped queries and then filtered,
    counted and paged in memory — the counts need every row anyway."""
    stmt = select(Promotion)
    needle = (q or "").strip()
    if needle:
        like = f"%{needle}%"
        child_hit = select(PromotionCode.promotion_id).where(PromotionCode.code == normalize_code(needle))
        stmt = stmt.where(or_(Promotion.code.ilike(like), Promotion.name.ilike(like), Promotion.id.in_(child_hit)))
    promos = list((await db.execute(stmt)).scalars())
    now = datetime.now(timezone.utc)
    usage = await _usage_by_promotion(db, [p.id for p in promos], now)
    emails = await _affiliate_emails(db, promos)
    views = [_view(p, usage[p.id], now, emails) for p in promos]

    live = [v for v in views if v["state"] != "archived"]
    counts = {
        "all": len(live),
        "running": sum(v["state"] == "running" for v in live),
        "scheduled": sum(v["state"] == "scheduled" for v in live),
        "paused": sum(v["state"] == "paused" for v in live),
        "attention": sum(v["attention_reason"] is not None for v in live),
        "done": sum(v["state"] in _DONE for v in live),
        "archived": len(views) - len(live),
    }
    if state == "archived":
        chosen = [v for v in views if v["state"] == "archived"]
    elif state == "attention":
        chosen = [v for v in live if v["attention_reason"] is not None]
    elif state == "done":
        chosen = [v for v in live if v["state"] in _DONE]
    elif state:
        chosen = [v for v in live if v["state"] == state]
    else:
        chosen = live

    far = datetime.max.replace(tzinfo=timezone.utc)
    if sort == "uses":
        chosen.sort(key=lambda v: (-v["uses"], -v["id"]))
    elif sort == "ends_soon":
        chosen.sort(key=lambda v: (v["ends_at"] or far, v["id"]))
    else:
        chosen.sort(key=lambda v: (v["updated_at"] or v["created_at"] or now, v["id"]), reverse=True)

    since = now - timedelta(days=30)
    uses30, disc30, gmv30 = (await db.execute(
        select(
            func.count(PromotionRedemption.id),
            func.coalesce(func.sum(PromotionRedemption.discount_amount), 0),
            func.coalesce(func.sum(Order.total_amount), 0),
        )
        .join(Order, Order.id == PromotionRedemption.order_id)
        .where(Order.status != OrderStatus.cancelled, PromotionRedemption.created_at >= since)
    )).one()
    return {
        "items": chosen[params.offset: params.offset + params.per_page],
        "total": len(chosen), "page": params.page, "per_page": params.per_page,
        "counts": counts,
        "totals_30d": {"uses": int(uses30), "discount": int(disc30), "gmv": int(gmv30)},
    }


# ── Admin console: mutations ─────────────────────────────────────────────────

async def code_taken(db: AsyncSession, code: str, *, promotion_id: int | None = None) -> bool:
    """True when `code` is some other campaign's code or any child code.
    Uniqueness across both tables is enforced here; each table's unique
    index still decides a race within it."""
    owner = await db.scalar(select(Promotion.id).where(Promotion.code == code))
    if owner is not None and owner != promotion_id:
        return True
    return await db.scalar(select(PromotionCode.id).where(PromotionCode.code == code)) is not None


async def _check_code_free(db: AsyncSession, code: str, promotion_id: int | None) -> None:
    if await code_taken(db, code, promotion_id=promotion_id):
        raise api_error(ErrorCode.PROMO_CODE_TAKEN, status.HTTP_409_CONFLICT)


def _audit_value(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, DiscountType):
        return value.value
    return value


async def _audit(db: AsyncSession, event: str, promo: Promotion, actor_id: int, message: str, **extra) -> None:
    await log_event(
        db, "info", message, request_id=current_request_id(),
        metadata={
            "event": event, "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "promotion", "subject_id": promo.id, "outcome": "success", **extra,
        },
    )


async def _insert(db: AsyncSession, promo: Promotion) -> None:
    db.add(promo)
    try:
        await db.flush()
    except IntegrityError:
        # Two admins saving the same code at once: the unique index decides.
        await db.rollback()
        raise api_error(ErrorCode.PROMO_CODE_TAKEN, status.HTTP_409_CONFLICT) from None


async def _check_affiliate(db: AsyncSession, affiliate_id: int | None) -> None:
    """A KOL campaign must point at a real, active account."""
    if affiliate_id is None:
        return
    account = await db.get(Account, affiliate_id)
    if account is None or not account.is_active or account.is_seeded:
        raise PromotionValidationError({"affiliate_account_id": "Không tìm thấy tài khoản KOL đang hoạt động"})


async def create_promotion(db: AsyncSession, *, actor_id: int, data: dict) -> dict:
    data = validate_promotion(data)
    await _check_code_free(db, data["code"], None)
    await _check_affiliate(db, data["affiliate_account_id"])
    promo = Promotion(**data, created_by_id=actor_id)
    await _insert(db, promo)
    await _audit(db, "promotion_created", promo, actor_id, f"Promotion {promo.code} created",
                 values={k: _audit_value(v) for k, v in data.items()})
    await db.commit()
    return await get_promotion(db, promo.id)


async def update_promotion(db: AsyncSession, *, actor_id: int, promotion_id: int, patch: dict) -> dict:
    promo = await _get(db, promotion_id, lock=True)
    redeemed = bool(await db.scalar(
        select(PromotionRedemption.id).where(PromotionRedemption.promotion_id == promo.id).limit(1)
    ))
    data = validate_promotion({**current_values(promo), **patch})
    if data["affiliate_account_id"] != promo.affiliate_account_id:
        # Orders already placed keep the KOL snapshotted on their redemption.
        await _check_affiliate(db, data["affiliate_account_id"])
    if data["code"] != promo.code:
        # Orders keep the code they were bought with; renaming it afterwards
        # would make the order and the campaign disagree.
        if redeemed:
            raise api_error(ErrorCode.PROMO_LOCKED, status.HTTP_409_CONFLICT)
        await _check_code_free(db, data["code"], promo.id)
    if promo.archived_at is not None and data["is_active"] and not promo.is_active:
        # An archived campaign must be unarchived before it can run again.
        raise api_error(ErrorCode.PROMO_ARCHIVED, status.HTTP_409_CONFLICT)
    changes = {}
    for field, value in data.items():
        old = getattr(promo, field)
        if old != value:
            changes[field] = {"old": _audit_value(old), "new": _audit_value(value)}
            setattr(promo, field, value)
    if changes:
        await _audit(db, "promotion_updated", promo, actor_id, f"Promotion {promo.code} updated", changes=changes)
    await db.commit()
    return await get_promotion(db, promo.id)


async def delete_promotion(db: AsyncSession, *, actor_id: int, promotion_id: int) -> None:
    promo = await _get(db, promotion_id, lock=True)
    if await db.scalar(select(PromotionRedemption.id).where(PromotionRedemption.promotion_id == promo.id).limit(1)):
        # A used campaign is history the orders point at: pause it instead.
        raise api_error(ErrorCode.PROMO_LOCKED, status.HTTP_409_CONFLICT)
    await _audit(db, "promotion_deleted", promo, actor_id, f"Promotion {promo.code} deleted", code=promo.code)
    await db.delete(promo)
    await db.commit()


async def _copy_code(db: AsyncSession, code: str) -> str:
    for n in range(1, 100):
        suffix = "-COPY" if n == 1 else f"-COPY{n}"
        candidate = code[: 32 - len(suffix)] + suffix
        if not await code_taken(db, candidate):
            return candidate
    raise api_error(ErrorCode.PROMO_CODE_TAKEN, status.HTTP_409_CONFLICT)


async def duplicate_promotion(db: AsyncSession, *, actor_id: int, promotion_id: int) -> dict:
    """Same offer and limits under a new code, paused, without child codes."""
    source = await _get(db, promotion_id)
    values = current_values(source)
    values.update(code=await _copy_code(db, source.code), name=f"{source.name} (bản sao)"[:120], is_active=False)
    copy = Promotion(**values, created_by_id=actor_id)
    await _insert(db, copy)
    await _audit(db, "promotion_duplicated", copy, actor_id, f"Promotion {copy.code} duplicated from {source.code}",
                 source_id=source.id, source_code=source.code)
    await db.commit()
    return await get_promotion(db, copy.id)


async def set_archived(db: AsyncSession, *, actor_id: int, promotion_id: int, archived: bool) -> dict:
    promo = await _get(db, promotion_id, lock=True)
    if archived and promo.archived_at is None:
        promo.archived_at = datetime.now(timezone.utc)
        promo.is_active = False
        await _audit(db, "promotion_archived", promo, actor_id, f"Promotion {promo.code} archived")
    elif not archived and promo.archived_at is not None:
        promo.archived_at = None
        await _audit(db, "promotion_unarchived", promo, actor_id, f"Promotion {promo.code} unarchived")
    await db.commit()
    return await get_promotion(db, promo.id)


# ── Admin console: redemptions & stats ───────────────────────────────────────

REDEMPTION_CSV_HEADER = [
    "Order_Code", "Order_Status", "Buyer_Email", "Code", "Discount_VND", "Order_Total_VND", "Created_At",
]
REDEMPTION_CSV_LIMIT = 50_000


def _redemptions_select(promotion_id: int, q: str | None):
    stmt = (
        select(PromotionRedemption, Order.order_code, Order.status, Order.total_amount, Account.email)
        .join(Order, Order.id == PromotionRedemption.order_id)
        .join(Account, Account.id == PromotionRedemption.buyer_id)
        .where(PromotionRedemption.promotion_id == promotion_id)
        .order_by(PromotionRedemption.created_at.desc(), PromotionRedemption.id.desc())
    )
    needle = (q or "").strip()
    if needle:
        like = f"%{needle}%"
        stmt = stmt.where(or_(Order.order_code.ilike(like), Account.email.ilike(like), PromotionRedemption.code.ilike(like)))
    return stmt


def _redemption_row(row) -> dict:
    r, code, order_status, paid, email = row
    return {
        "id": r.id, "order_id": r.order_id, "order_code": code,
        "order_status": order_status.value if hasattr(order_status, "value") else str(order_status),
        "buyer_id": r.buyer_id, "buyer_email": email, "code": r.code,
        "discount_amount": r.discount_amount, "order_total": paid, "created_at": r.created_at,
    }


async def list_redemptions(db: AsyncSession, promotion_id: int, *, q: str | None, params: PageParams) -> dict:
    await _get(db, promotion_id)
    return await paginate(
        db, _redemptions_select(promotion_id, q), params, scalars=False,
        transform=lambda rows: [_redemption_row(r) for r in rows],
    )


async def redemption_csv_rows(db: AsyncSession, promotion_id: int, *, q: str | None) -> list[list]:
    await _get(db, promotion_id)
    rows = (await db.execute(_redemptions_select(promotion_id, q).limit(REDEMPTION_CSV_LIMIT))).all()
    out = []
    for row in rows:
        r = _redemption_row(row)
        out.append([r["order_code"], r["order_status"], r["buyer_email"], r["code"], r["discount_amount"],
                    r["order_total"], r["created_at"]])
    return out


async def promotion_stats(db: AsyncSession, promotion_id: int, *, days: int) -> dict:
    """Daily uses / discount / GMV over the last `days` Vietnam calendar days
    (zero-filled), plus how many buyers placed their first order with it."""
    await _get(db, promotion_id)
    local_day = func.date(func.timezone(VN_TZ, PromotionRedemption.created_at))
    today = (datetime.now(timezone.utc) + timedelta(hours=7)).date()
    first_day = today - timedelta(days=days - 1)
    rows = (await db.execute(
        select(
            local_day.label("d"), func.count(PromotionRedemption.id),
            func.coalesce(func.sum(PromotionRedemption.discount_amount), 0),
            func.coalesce(func.sum(Order.total_amount), 0),
        )
        .join(Order, Order.id == PromotionRedemption.order_id)
        .where(
            PromotionRedemption.promotion_id == promotion_id, Order.status != OrderStatus.cancelled,
            local_day >= first_day,
        )
        .group_by("d")
    )).all()
    by_day = {d: (int(n), int(disc), int(gmv)) for d, n, disc, gmv in rows}
    series = []
    for i in range(days):
        day = first_day + timedelta(days=i)
        n, disc, gmv = by_day.get(day, (0, 0, 0))
        series.append({"date": day.isoformat(), "uses": n, "discount": disc, "gmv": gmv})

    first_order = (
        select(Order.buyer_id, func.min(Order.id).label("first_id"))
        .where(Order.status != OrderStatus.cancelled, Order.is_seeded.is_(False))
        .group_by(Order.buyer_id)
        .subquery()
    )
    new_buyers = await db.scalar(
        select(func.count(func.distinct(PromotionRedemption.buyer_id)))
        .join(Order, Order.id == PromotionRedemption.order_id)
        .join(first_order, first_order.c.first_id == PromotionRedemption.order_id)
        .where(
            PromotionRedemption.promotion_id == promotion_id, Order.status != OrderStatus.cancelled,
            local_day >= first_day,
        )
    )
    return {
        "series": series,
        "uses": sum(p["uses"] for p in series),
        "discount": sum(p["discount"] for p in series),
        "gmv": sum(p["gmv"] for p in series),
        "new_buyers": int(new_buyers or 0),
    }
