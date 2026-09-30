"""Single-use child codes of a multi-code campaign (`promotion_codes`).

Generation draws from an alphabet without look-alike characters (no 0/O,
1/I/L), checks every candidate against both code tables and inserts with
ON CONFLICT DO NOTHING, retrying until the requested count exists. Redemption
lives in `promotions.service` (`apply_code` / `record_redemption`).
"""
from __future__ import annotations

import secrets

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.pagination import PageParams, paginate
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.models.order import Order
from src.models.promotion import Promotion, PromotionCode
from src.promotions import service

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
MAX_CODES_PER_CAMPAIGN = 100_000
_MAX_ROUNDS = 20
CODES_CSV_HEADER = ["Code", "Status", "Redeemed_At", "Order_Code", "Created_At"]
CODES_CSV_LIMIT = MAX_CODES_PER_CAMPAIGN


def _random_code(prefix: str, length: int) -> str:
    return prefix + "".join(secrets.choice(ALPHABET) for _ in range(length))


async def create_codes(
    db: AsyncSession, *, actor_id: int, promotion_id: int, count: int, prefix: str, length: int,
) -> int:
    promo = await service._get(db, promotion_id, lock=True)
    prefix = prefix.strip().upper()
    if len(prefix) + length > 32:
        raise api_error(ErrorCode.PROMO_CODES_INVALID, status.HTTP_422_UNPROCESSABLE_CONTENT)
    existing = int(await db.scalar(
        select(func.count(PromotionCode.id)).where(PromotionCode.promotion_id == promo.id)
    ) or 0)
    if existing + count > MAX_CODES_PER_CAMPAIGN:
        raise api_error(ErrorCode.PROMO_CODES_INVALID, status.HTTP_422_UNPROCESSABLE_CONTENT,
                        max=MAX_CODES_PER_CAMPAIGN)
    created = 0
    for _ in range(_MAX_ROUNDS):
        want = count - created
        if want <= 0:
            break
        candidates = {_random_code(prefix, length) for _ in range(want + 8)}
        # A child code must never equal a campaign code.
        clash = set((await db.execute(select(Promotion.code).where(Promotion.code.in_(candidates)))).scalars())
        fresh = list(candidates - clash)[:want]
        if not fresh:
            continue
        result = await db.execute(
            insert(PromotionCode)
            .values([{"promotion_id": promo.id, "code": c, "created_by_id": actor_id} for c in fresh])
            .on_conflict_do_nothing(index_elements=["code"])
            .returning(PromotionCode.id)
        )
        created += len(result.all())
    if created < count:
        # The code space for this prefix/length is too crowded.
        await db.rollback()
        raise api_error(ErrorCode.PROMO_CODES_INVALID, status.HTTP_409_CONFLICT)
    await service._audit(
        db, "promotion_codes_created", promo, actor_id, f"{created} codes created for promotion {promo.code}",
        count=created, prefix=prefix or None, length=length,
    )
    await db.commit()
    return created


def _codes_select(promotion_id: int, code_status: str):
    stmt = (
        select(PromotionCode, Order.order_code)
        .outerjoin(Order, Order.id == PromotionCode.redeemed_order_id)
        .where(PromotionCode.promotion_id == promotion_id)
    )
    if code_status == "unused":
        stmt = stmt.where(PromotionCode.redeemed_order_id.is_(None))
    elif code_status == "used":
        stmt = stmt.where(PromotionCode.redeemed_order_id.is_not(None))
    return stmt.order_by(PromotionCode.redeemed_at.desc().nulls_last(), PromotionCode.id.desc())


def _row(code: PromotionCode, order_code: str | None) -> dict:
    return {"code": code.code, "redeemed_at": code.redeemed_at, "order_code": order_code, "created_at": code.created_at}


async def list_codes(db: AsyncSession, promotion_id: int, *, code_status: str, params: PageParams) -> dict:
    await service._get(db, promotion_id)
    return await paginate(
        db, _codes_select(promotion_id, code_status), params, scalars=False,
        transform=lambda rows: [_row(c, oc) for c, oc in rows],
    )


async def codes_csv_rows(db: AsyncSession, promotion_id: int, *, code_status: str) -> list[list]:
    await service._get(db, promotion_id)
    rows = (await db.execute(_codes_select(promotion_id, code_status).limit(CODES_CSV_LIMIT))).all()
    return [
        [c.code, "used" if c.redeemed_order_id else "unused", c.redeemed_at, oc, c.created_at]
        for c, oc in rows
    ]
