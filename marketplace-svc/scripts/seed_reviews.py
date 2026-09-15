"""Seed random demo reviews (with backing completed orders) on one product.

Run from marketplace-svc/:
    .venv/bin/python scripts/seed_reviews.py --product 79 --count 50 [--seed 79]

Uses DATABASE_URL from the environment / .env like the app does. Each review
gets its own synthetic `completed` order (delivered_data = "seed|review|demo")
so the one-review-per-order rule holds; ~25% of 5★ rows are marked as
automatic reviews and ~45% of the rest carry a seller reply. Product
rating_avg / rating_count are recomputed at the end.
"""
from __future__ import annotations

import argparse
import asyncio
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # noqa: E402 — run as a plain script

from sqlalchemy import select  # noqa: E402

from src.database import SessionLocal  # noqa: E402
from src.models.account import Account  # noqa: E402
from src.models.order import Order, OrderStatus  # noqa: E402
from src.models.product import Product, ProductVariant  # noqa: E402
from src.models.review import Review  # noqa: E402
from src.reviews.service import refresh_product_rating  # noqa: E402

COMMENTS = {
    5: ["Acc ổn, login phát ăn ngay.", "Giao ngay sau khi thanh toán, quá nhanh.", "Dùng nuôi bot rất ổn, chưa bị khoá.",
        "Shop hỗ trợ nhiệt tình, sẽ mua lại.", "Đầy đủ như mô tả, import 1 phát xong.", None, None, "Mua lần 3 rồi, vẫn ngon."],
    4: ["Ổn, mỗi tội giao hơi chậm 5 phút.", "Dùng tốt, giá hơi cao so với chỗ khác.", "Tạm ổn, 1/3 phải đổi nhưng shop đổi ngay.", None],
    3: ["Bình thường, có acc bị hạn chế spam.", "Dùng được nhưng tuổi acc không như mô tả.", None],
    2: ["2 acc thì 1 acc die sau 2 ngày.", "Chậm hỗ trợ, phải nhắn nhiều lần."],
    1: ["Acc bị khoá ngay khi đăng nhập, phải khiếu nại.", "Không đúng mô tả."],
}
REPLIES = [
    "Cảm ơn bạn đã ủng hộ shop!",
    "Cảm ơn bạn, có vấn đề gì cứ nhắn shop nhé.",
    "Shop xin lỗi vì trải nghiệm chưa tốt, đã đổi acc mới cho bạn rồi ạ.",
    "Cảm ơn góp ý, shop sẽ cải thiện tốc độ hỗ trợ.",
]
WEIGHTS = {5: 62, 4: 20, 3: 9, 2: 5, 1: 4}


async def seed(product_id: int, count: int) -> None:
    async with SessionLocal() as db:
        product = await db.get(Product, product_id)
        if product is None:
            raise SystemExit(f"product {product_id} not found")
        variants = list((await db.execute(select(ProductVariant).where(ProductVariant.product_id == product_id))).scalars())
        if not variants:
            raise SystemExit(f"product {product_id} has no variants to attach orders to")
        buyers = list((await db.execute(select(Account).where(Account.id != product.seller_id).limit(12))).scalars())
        if not buyers:
            raise SystemExit("no buyer accounts available")
        now = datetime.now(timezone.utc)
        ratings: list[int] = []
        for _ in range(count):
            rating = random.choices(list(WEIGHTS), weights=list(WEIGHTS.values()))[0]
            buyer, variant = random.choice(buyers), random.choice(variants)
            qty = random.choice([1, 1, 1, 2, 3, 5])
            when = now - timedelta(days=random.uniform(0.2, 60), hours=random.uniform(0, 12))
            order = Order(
                buyer_id=buyer.id, seller_id=product.seller_id, variant_id=variant.id, product_id=product.id,
                quantity=qty, total_amount=variant.price * qty, status=OrderStatus.completed,
                escrow_expires_at=when + timedelta(days=product.escrow_days), delivered_data="seed|review|demo",
                created_at=when,
            )
            db.add(order)
            await db.flush()
            is_auto = rating == 5 and random.random() < 0.25
            review = Review(
                order_id=order.id, buyer_id=buyer.id, product_id=product.id, rating=rating,
                comment=None if is_auto else random.choice(COMMENTS[rating]), is_auto=is_auto,
                created_at=when + timedelta(days=random.uniform(0.1, 3)),
            )
            if not is_auto and random.random() < 0.45:
                review.seller_reply = random.choice(REPLIES if rating >= 4 else REPLIES[2:])
                review.seller_replied_at = review.created_at + timedelta(hours=random.uniform(1, 48))
            db.add(review)
            ratings.append(rating)
        await db.flush()
        await refresh_product_rating(product_id, db)
        await db.commit()
        await db.refresh(product)
        print(f"seeded {count} reviews on product {product_id}: " + ", ".join(f"{s}★×{ratings.count(s)}" for s in (5, 4, 3, 2, 1)))
        print(f"product rating now {product.rating_avg:.2f} / {product.rating_count}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--product", type=int, required=True)
    parser.add_argument("--count", type=int, default=50)
    parser.add_argument("--seed", type=int, default=None, help="random seed for reproducible output")
    args = parser.parse_args()
    if args.seed is not None:
        random.seed(args.seed)
    asyncio.run(seed(args.product, args.count))
