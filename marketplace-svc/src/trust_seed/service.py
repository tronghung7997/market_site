"""Seeded-liquidity console: admin-authored demo reviews on a real product.

Two-step by design. ``generate`` returns drafts and writes nothing; the admin
edits, deletes or regenerates rows and posts the accepted set back to ``apply``.
A model is never allowed to publish directly to the storefront.

What ``apply`` writes, all inside one transaction:

* reused/created seeded accounts (``seed_pool``)
* one ``orders`` row per review, ``is_seeded = True``, status ``completed``
* one ``reviews`` row per order, ``is_seeded = True``, tagged with the batch

What it deliberately does **not** touch: wallets, transactions, escrow,
commissions, resources, stock. No money moves and none can, because no
wallet code path is invoked at all.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.ai import service as ai_service
from src.ai.port import AiError
from src.ai.tasks import TRUST_SEED_REVIEWS
from src.audit.service import log_event
from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductVariant
from src.models.review import Review
from src.models.trust_seed import TrustSeedBatch
from src.reviews.service import refresh_product_rating
from src.trust_seed import seed_pool
from src.trust_seed.context import build_product_context, format_distribution
from src.trust_seed.policy import validate_draft

logger = structlog.get_logger()

MAX_BATCH_SIZE = 50

# A wall of 5-star reviews is the clearest signal that a rating was bought, so
# the default mix keeps a realistic tail. Admins may override per batch.
DEFAULT_DISTRIBUTION = {5: 62, 4: 22, 3: 10, 2: 4, 1: 2}

# Shape the model must return; reused verbatim by both adapters.
REVIEW_SCHEMA: dict[str, Any] = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "rating": {"type": "integer"},
            "comment": {"type": "string"},
            "seller_reply": {"type": "string", "nullable": True},
        },
        "required": ["rating", "comment"],
    },
}


class TrustSeedError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def resolve_distribution(count: int, weights: dict[int, int] | None) -> dict[int, int]:
    """Turn star weights into exact per-star counts totalling ``count``.

    Largest-remainder allocation, so the visible mix matches what the admin
    asked for instead of drifting with sampling noise.
    """
    weights = {int(k): int(v) for k, v in (weights or DEFAULT_DISTRIBUTION).items() if int(v) > 0}
    if not weights:
        weights = dict(DEFAULT_DISTRIBUTION)
    total_weight = sum(weights.values())

    exact = {star: count * weight / total_weight for star, weight in weights.items()}
    counts = {star: int(value) for star, value in exact.items()}
    remainder = count - sum(counts.values())
    for star, _ in sorted(exact.items(), key=lambda kv: kv[1] - int(kv[1]), reverse=True):
        if remainder <= 0:
            break
        counts[star] += 1
        remainder -= 1
    return {star: n for star, n in counts.items() if n > 0}


async def _load_product(db: AsyncSession, product_id: int) -> Product:
    product = await db.get(Product, product_id)
    if product is None:
        raise TrustSeedError("product_not_found", "Không tìm thấy sản phẩm")
    return product


async def generate(
    db: AsyncSession,
    *,
    product_id: int,
    count: int,
    distribution: dict[int, int] | None,
    locale: str,
    actor_id: int,
    system_override: str | None = None,
    user_override: str | None = None,
    extra_instructions: str = "",
) -> dict:
    """Produce drafts without persisting anything.

    Every draft is returned with its policy problems attached rather than being
    silently dropped, so the admin sees what the model tried to write.
    """
    if count < 1 or count > MAX_BATCH_SIZE:
        raise TrustSeedError("count_range", f"Số lượng phải từ 1 đến {MAX_BATCH_SIZE}")

    product = await _load_product(db, product_id)
    resolved = resolve_distribution(count, distribution)
    product_context = await build_product_context(db, product)

    try:
        result = await ai_service.run_task(
            db,
            task=TRUST_SEED_REVIEWS,
            locale=locale,
            actor_id=actor_id,
            schema=REVIEW_SCHEMA,
            system_override=system_override,
            user_override=user_override,
            context={
                "product_context": product_context,
                "count": count,
                "distribution": format_distribution(resolved),
                "extra_instructions": extra_instructions or "",
            },
        )
    except AiError as exc:
        raise TrustSeedError(f"ai_{exc.kind}", str(exc)) from exc

    raw = result.data if isinstance(result.data, list) else []
    drafts: list[dict] = []
    for index, item in enumerate(raw[:count]):
        if not isinstance(item, dict):
            continue
        rating = int(item.get("rating") or 0)
        comment = (item.get("comment") or "").strip() or None
        reply = (item.get("seller_reply") or "").strip() or None
        drafts.append({
            "index": index,
            "rating": rating,
            "comment": comment,
            "seller_reply": reply,
            "problems": validate_draft(rating, comment, reply),
        })

    if not drafts:
        raise TrustSeedError("ai_invalid_output", "Mô hình không trả về đánh giá nào hợp lệ")

    return {
        "product_id": product_id,
        "product_title": product.title,
        "model": result.model,
        "used_fallback": result.used_fallback,
        "locale": locale,
        "requested_count": count,
        "distribution": resolved,
        "product_context": product_context,
        "drafts": drafts,
    }


async def apply(
    db: AsyncSession,
    *,
    product_id: int,
    items: list[dict],
    date_from: datetime,
    date_to: datetime,
    actor_id: int,
    source: str = "ai",
    model: str | None = None,
    locale: str = "vi",
    prompt_snapshot: str | None = None,
    options_snapshot: dict | None = None,
    bump_sold_count: bool = True,
) -> dict:
    """Persist an accepted draft set as one reversible batch."""
    if not items:
        raise TrustSeedError("empty", "Không có đánh giá nào để lưu")
    if len(items) > MAX_BATCH_SIZE:
        raise TrustSeedError("count_range", f"Tối đa {MAX_BATCH_SIZE} đánh giá mỗi lần")
    if date_to <= date_from:
        raise TrustSeedError("date_range", "Ngày kết thúc phải sau ngày bắt đầu")

    now = datetime.now(timezone.utc)
    if date_to > now:
        date_to = now
    if date_from >= date_to:
        raise TrustSeedError("date_range", "Khoảng thời gian không hợp lệ")

    product = await _load_product(db, product_id)

    # Re-validate server-side: the console shows problems, but the decision to
    # publish must not be enforceable only in the browser.
    for position, item in enumerate(items, start=1):
        problems = validate_draft(
            int(item.get("rating") or 0),
            item.get("comment"),
            item.get("seller_reply"),
        )
        if problems:
            raise TrustSeedError(
                "policy_violation",
                f"Đánh giá #{position} vi phạm nội dung: {', '.join(problems)}",
            )

    variants = list((await db.execute(
        select(ProductVariant).where(ProductVariant.product_id == product_id)
    )).scalars())
    if not variants:
        raise TrustSeedError("no_variant", "Sản phẩm chưa có gói nào để gắn đơn hàng")

    buyers = await seed_pool.get_or_create_pool(db, size=min(len(items), 12))
    if not buyers:
        raise TrustSeedError("no_pool", "Không tạo được tài khoản đánh giá")

    batch = TrustSeedBatch(
        product_id=product_id,
        status="applied",
        review_count=len(items),
        source=source,
        model=model,
        locale=locale,
        prompt_snapshot=prompt_snapshot,
        options_snapshot=options_snapshot,
        created_by_id=actor_id,
    )
    db.add(batch)
    await db.flush()

    span = (date_to - date_from).total_seconds()
    for item in items:
        variant = random.choice(variants)
        buyer = random.choice(buyers)
        quantity = random.choice([1, 1, 1, 2, 3])
        ordered_at = date_from + timedelta(seconds=random.uniform(0, span))

        order = Order(
            buyer_id=buyer.id,
            seller_id=product.seller_id,
            variant_id=variant.id,
            product_id=product.id,
            quantity=quantity,
            total_amount=variant.price * quantity,
            status=OrderStatus.completed,
            escrow_expires_at=ordered_at + timedelta(days=product.escrow_days),
            created_at=ordered_at,
            is_seeded=True,
        )
        db.add(order)
        await db.flush()

        # Buyers rate after they have used the goods, not at checkout.
        reviewed_at = min(ordered_at + timedelta(hours=random.uniform(4, 96)), date_to)
        review = Review(
            order_id=order.id,
            buyer_id=buyer.id,
            product_id=product.id,
            rating=int(item["rating"]),
            comment=(item.get("comment") or "").strip() or None,
            created_at=reviewed_at,
            is_seeded=True,
            trust_seed_batch_id=batch.id,
        )
        reply = (item.get("seller_reply") or "").strip()
        if reply:
            review.seller_reply = reply
            review.seller_replied_at = reviewed_at + timedelta(hours=random.uniform(1, 36))
        db.add(review)

    await db.flush()
    await refresh_product_rating(product_id, db)

    if bump_sold_count:
        # The storefront's social proof is the point of the exercise; the
        # counter is display-only and never feeds revenue reporting.
        product.sold_count = (product.sold_count or 0) + sum(1 for _ in items)

    await log_event(
        db, "warning", f"Trust-seed applied: {len(items)} review(s) on product {product_id}",
        metadata={
            "event": "trust_seed_applied",
            "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "product", "subject_id": product_id,
            "batch_id": batch.id, "review_count": len(items),
            "source": source, "model": model, "locale": locale,
            "outcome": "success", "source_channel": "admin",
        },
    )
    await db.commit()
    await db.refresh(product)

    return {
        "batch_id": batch.id,
        "product_id": product_id,
        "review_count": len(items),
        "rating_avg": product.rating_avg,
        "rating_count": product.rating_count,
    }


async def purge_batch(db: AsyncSession, *, batch_id: int, actor_id: int) -> dict:
    """Undo one batch completely: reviews, their synthetic orders, the rating.

    Seeded accounts stay in the pool for reuse; they hold nothing and are
    invisible to the rest of the system.
    """
    batch = await db.get(TrustSeedBatch, batch_id)
    if batch is None:
        raise TrustSeedError("batch_not_found", "Không tìm thấy lô đánh giá")
    if batch.status == "purged":
        raise TrustSeedError("already_purged", "Lô này đã được xoá")

    order_ids = list((await db.execute(
        select(Review.order_id).where(Review.trust_seed_batch_id == batch_id)
    )).scalars())

    removed = await db.execute(delete(Review).where(Review.trust_seed_batch_id == batch_id))
    if order_ids:
        # Only ever seeded orders: the filter is belt-and-braces against a
        # review row that somehow points at a real purchase.
        await db.execute(
            delete(Order).where(Order.id.in_(order_ids), Order.is_seeded.is_(True))
        )

    product = await db.get(Product, batch.product_id)
    if product is not None:
        product.sold_count = max(0, (product.sold_count or 0) - batch.review_count)

    await db.flush()
    await refresh_product_rating(batch.product_id, db)

    batch.status = "purged"
    batch.purged_by_id = actor_id
    batch.purged_at = datetime.now(timezone.utc)

    await log_event(
        db, "warning", f"Trust-seed batch {batch_id} purged",
        metadata={
            "event": "trust_seed_purged",
            "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "product", "subject_id": batch.product_id,
            "batch_id": batch_id, "removed_reviews": removed.rowcount or 0,
            "outcome": "success", "source": "admin",
        },
    )
    await db.commit()

    return {
        "batch_id": batch_id,
        "product_id": batch.product_id,
        "removed_reviews": removed.rowcount or 0,
    }


async def list_batches(db: AsyncSession, *, product_id: int | None = None) -> list[dict]:
    query = select(TrustSeedBatch).order_by(TrustSeedBatch.created_at.desc()).limit(100)
    if product_id is not None:
        query = query.where(TrustSeedBatch.product_id == product_id)
    rows = (await db.execute(query)).scalars().all()
    return [
        {
            "id": b.id, "product_id": b.product_id, "status": b.status,
            "review_count": b.review_count, "source": b.source, "model": b.model,
            "locale": b.locale,
            "created_by_id": b.created_by_id,
            "created_at": b.created_at.isoformat() if b.created_at else None,
            "purged_at": b.purged_at.isoformat() if b.purged_at else None,
        }
        for b in rows
    ]


async def product_summary(db: AsyncSession, product_id: int) -> dict:
    """Seeded-vs-real breakdown, so an admin always sees how much of a
    product's social proof is manufactured."""
    seeded = int(await db.scalar(
        select(func.count(Review.id)).where(
            Review.product_id == product_id, Review.is_seeded.is_(True),
        )
    ) or 0)
    total = int(await db.scalar(
        select(func.count(Review.id)).where(
            Review.product_id == product_id, Review.is_hidden.is_(False),
        )
    ) or 0)
    return {
        "product_id": product_id,
        "seeded_reviews": seeded,
        "total_visible_reviews": total,
        "real_reviews": max(0, total - seeded),
        "seed_pool_size": await seed_pool.pool_size(db),
    }
