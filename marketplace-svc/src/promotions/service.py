"""Promo codes: evaluation at checkout and the admin campaign console.

`orders.service` is the only checkout caller: it asks `apply_code` for the
discount (the promotion row stays locked until the order commits, so usage
and budget ceilings hold under concurrent orders) and then `record_redemption`
once the order has an id. Every rule is a column of `promotions`, so a new
campaign never needs a deploy.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.logging import current_request_id
from src.models.account import Account
from src.models.category import Category
from src.models.order import Order, OrderStatus
from src.models.promotion import DiscountType, Promotion, PromotionRedemption
from src.promotions.schemas import CODE_PATTERN as CODE_REGEX, PromotionInput

CODE_PATTERN = re.compile(CODE_REGEX)
EDITABLE_FIELDS = (
    "code", "name", "note", "discount_type", "discount_value", "max_discount_amount", "min_order_amount",
    "starts_at", "ends_at", "usage_limit", "per_buyer_limit", "budget_amount", "category_ids",
    "new_buyers_only", "is_active",
)


def normalize_code(raw: str) -> str:
    return (raw or "").strip().upper()


@dataclass(frozen=True)
class AppliedPromo:
    promotion_id: int
    code: str
    discount: int


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


async def apply_code(
    db: AsyncSession, raw_code: str, *, buyer_id: int, category_id: int | None, subtotal: int, lock: bool,
) -> AppliedPromo:
    """Check every rule of the campaign behind `raw_code` for this order and
    return the discount. `lock=True` (order creation) holds the promotion row
    until the caller's transaction ends; a quote passes False and writes nothing."""
    code = normalize_code(raw_code)
    if not CODE_PATTERN.match(code):
        raise api_error(ErrorCode.PROMO_NOT_FOUND, status.HTTP_400_BAD_REQUEST)
    stmt = select(Promotion).where(Promotion.code == code)
    if lock:
        stmt = stmt.with_for_update()
    promo = await db.scalar(stmt)
    if promo is None or not promo.is_active:
        raise api_error(ErrorCode.PROMO_NOT_FOUND, status.HTTP_400_BAD_REQUEST)

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
    return AppliedPromo(promotion_id=promo.id, code=promo.code, discount=discount)


def record_redemption(db: AsyncSession, applied: AppliedPromo, order: Order) -> None:
    """Count the use against the campaign, in the order's transaction."""
    db.add(PromotionRedemption(
        promotion_id=applied.promotion_id, order_id=order.id, buyer_id=order.buyer_id,
        discount_amount=applied.discount,
    ))


# ── Admin console ────────────────────────────────────────────────────────────

def campaign_state(promo: Promotion, uses: int, spent: int, now: datetime) -> str:
    """One word the console shows: paused / scheduled / ended / exhausted / running."""
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


def _view(promo: Promotion, uses: int, spent: int, now: datetime) -> dict:
    return {
        **current_values(promo),
        "id": promo.id,
        "uses": uses,
        "discount_given": spent,
        "state": campaign_state(promo, uses, spent, now),
        "created_at": promo.created_at,
        "updated_at": promo.updated_at,
    }


async def _usage_by_promotion(db: AsyncSession, promotion_ids: list[int]) -> dict[int, tuple[int, int]]:
    if not promotion_ids:
        return {}
    live = _live_redemptions().where(PromotionRedemption.promotion_id.in_(promotion_ids)).subquery()
    rows = await db.execute(
        select(live.c.promotion_id, func.count(live.c.id), func.coalesce(func.sum(live.c.discount_amount), 0))
        .group_by(live.c.promotion_id)
    )
    return {pid: (int(n), int(total)) for pid, n, total in rows.all()}


async def list_promotions(db: AsyncSession) -> list[dict]:
    promos = list((await db.execute(select(Promotion).order_by(Promotion.created_at.desc(), Promotion.id.desc()))).scalars())
    usage = await _usage_by_promotion(db, [p.id for p in promos])
    now = datetime.now(timezone.utc)
    return [_view(p, *usage.get(p.id, (0, 0)), now) for p in promos]


async def _get(db: AsyncSession, promotion_id: int, *, lock: bool = False) -> Promotion:
    stmt = select(Promotion).where(Promotion.id == promotion_id)
    if lock:
        stmt = stmt.with_for_update()
    promo = await db.scalar(stmt)
    if promo is None:
        raise api_error(ErrorCode.PROMO_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return promo


async def _check_code_free(db: AsyncSession, code: str, promotion_id: int | None) -> None:
    taken = await db.scalar(select(Promotion.id).where(Promotion.code == code))
    if taken is not None and taken != promotion_id:
        raise api_error(ErrorCode.PROMO_CODE_TAKEN, status.HTTP_409_CONFLICT)


def _audit_value(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, DiscountType):
        return value.value
    return value


async def create_promotion(db: AsyncSession, *, actor_id: int, data: dict) -> dict:
    data = _validated(data)
    await _check_code_free(db, data["code"], None)
    promo = Promotion(**data, created_by_id=actor_id)
    db.add(promo)
    try:
        await db.flush()
    except IntegrityError:
        # Two admins saving the same code at once: the unique index decides.
        await db.rollback()
        raise api_error(ErrorCode.PROMO_CODE_TAKEN, status.HTTP_409_CONFLICT) from None
    await log_event(
        db, "info", f"Promotion {promo.code} created", request_id=current_request_id(),
        metadata={
            "event": "promotion_created", "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "promotion", "subject_id": promo.id, "outcome": "success",
            "values": {k: _audit_value(v) for k, v in data.items()},
        },
    )
    await db.commit()
    await db.refresh(promo)
    return _view(promo, 0, 0, datetime.now(timezone.utc))


def current_values(promo: Promotion) -> dict:
    return {field: getattr(promo, field) for field in EDITABLE_FIELDS}


def _validated(values: dict) -> dict:
    """Run the admin input model over a full field set (stored values merged
    with a partial patch), so cross-field rules hold for partial edits too."""
    try:
        return PromotionInput.model_validate(values).model_dump()
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_url=False, include_context=False)) from None


async def update_promotion(db: AsyncSession, *, actor_id: int, promotion_id: int, patch: dict) -> dict:
    promo = await _get(db, promotion_id, lock=True)
    uses, spent, _ = await _usage(db, promo.id)
    redeemed = bool(await db.scalar(
        select(PromotionRedemption.id).where(PromotionRedemption.promotion_id == promo.id).limit(1)
    ))
    data = _validated({**current_values(promo), **patch})
    if data["code"] != promo.code:
        # Orders keep the code they were bought with; renaming it afterwards
        # would make the order and the campaign disagree.
        if redeemed:
            raise api_error(ErrorCode.PROMO_LOCKED, status.HTTP_409_CONFLICT)
        await _check_code_free(db, data["code"], promo.id)
    changes = {}
    for field, value in data.items():
        old = getattr(promo, field)
        if old != value:
            changes[field] = {"old": _audit_value(old), "new": _audit_value(value)}
            setattr(promo, field, value)
    if changes:
        await log_event(
            db, "info", f"Promotion {promo.code} updated", request_id=current_request_id(),
            metadata={
                "event": "promotion_updated", "actor_id": actor_id, "actor_type": "admin",
                "subject_type": "promotion", "subject_id": promo.id, "outcome": "success", "changes": changes,
            },
        )
    await db.commit()
    await db.refresh(promo)
    return _view(promo, uses, spent, datetime.now(timezone.utc))


async def delete_promotion(db: AsyncSession, *, actor_id: int, promotion_id: int) -> None:
    promo = await _get(db, promotion_id, lock=True)
    if await db.scalar(select(PromotionRedemption.id).where(PromotionRedemption.promotion_id == promo.id).limit(1)):
        # A used campaign is history the orders point at: pause it instead.
        raise api_error(ErrorCode.PROMO_LOCKED, status.HTTP_409_CONFLICT)
    await log_event(
        db, "info", f"Promotion {promo.code} deleted", request_id=current_request_id(),
        metadata={
            "event": "promotion_deleted", "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "promotion", "subject_id": promo.id, "outcome": "success", "code": promo.code,
        },
    )
    await db.delete(promo)
    await db.commit()


async def list_redemptions(db: AsyncSession, promotion_id: int, *, limit: int = 100) -> list[dict]:
    await _get(db, promotion_id)
    rows = await db.execute(
        select(PromotionRedemption, Order.order_code, Order.status, Order.total_amount, Account.email)
        .join(Order, Order.id == PromotionRedemption.order_id)
        .join(Account, Account.id == PromotionRedemption.buyer_id)
        .where(PromotionRedemption.promotion_id == promotion_id)
        .order_by(PromotionRedemption.created_at.desc(), PromotionRedemption.id.desc())
        .limit(limit)
    )
    return [
        {
            "order_id": r.order_id, "order_code": code, "order_status": order_status,
            "paid_amount": paid, "discount_amount": r.discount_amount,
            "buyer_email": email, "created_at": r.created_at,
        }
        for r, code, order_status, paid, email in rows.all()
    ]
