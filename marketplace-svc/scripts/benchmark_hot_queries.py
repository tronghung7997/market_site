"""Seed the dedicated test database and benchmark known database hot paths.

Run from ``marketplace-svc``::

    uv run python scripts/benchmark_hot_queries.py --scenario small --repeat 5

The script intentionally truncates application tables.  It refuses to run unless
the connected PostgreSQL database is exactly ``marketplace_test``.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import statistics
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass


TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://marketplace:marketplace@localhost:5432/marketplace_test",
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["DEPLOYMENT_ENVIRONMENT"] = "test"
os.environ.setdefault("JWT_SECRET", "benchmark-jwt-secret-at-least-32-bytes")
os.environ.setdefault("INTERNAL_API_KEY", "benchmark-internal-key-at-least-32-bytes")
os.environ.setdefault("BFF_REQUEST_SIGNING_SECRET", "benchmark-bff-key-at-least-32-bytes")
os.environ.setdefault("ENCRYPTION_KEY", "benchmark-encryption-key-at-least-32-bytes")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy import event, text  # noqa: E402

from src.chat.service import get_conversation, list_conversations  # noqa: E402
from src.database import SessionLocal, engine  # noqa: E402
from src.disputes.service import list_disputes, list_seller_disputes  # noqa: E402
from src.models.account import Account  # noqa: E402
from src.models.category import Category  # noqa: E402
from src.models.chat import ChatConversation, ChatMessage, ChatParticipant  # noqa: E402
from src.models.order import Dispute, DisputeMessage, DisputeStatus, Order, OrderStatus  # noqa: E402
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant  # noqa: E402
from src.resources.service import seller_inventory_summary  # noqa: E402


@dataclass(frozen=True)
class Scenario:
    conversations: int
    messages_per_conversation: int
    disputes: int
    inventory_variants: int = 1
    inventory_resources: int = 0


SCENARIOS = {
    "small": Scenario(10, 20, 10),
    "medium": Scenario(50, 200, 100),
    "large": Scenario(500, 1_000, 1_000),
    "inventory": Scenario(1, 1, 0, inventory_variants=2_000, inventory_resources=1_000_000),
}


class QueryCounter:
    def __init__(self) -> None:
        self.count = 0

    def before_cursor_execute(self, *_args: object) -> None:
        self.count += 1

    def reset(self) -> None:
        self.count = 0


async def assert_safe_database() -> None:
    async with engine.connect() as conn:
        database = await conn.scalar(text("SELECT current_database()"))
    if database != "marketplace_test":
        raise RuntimeError(
            f"Refusing destructive benchmark against database {database!r}; "
            "expected 'marketplace_test'."
        )


async def reset_database() -> None:
    async with engine.begin() as conn:
        rows = await conn.execute(
            text(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public' AND tablename != 'alembic_version'"
            )
        )
        tables = [row[0] for row in rows]
        if tables:
            quoted = ", ".join(f'"{name}"' for name in tables)
            await conn.execute(text(f"TRUNCATE {quoted} RESTART IDENTITY CASCADE"))


async def seed(scenario: Scenario) -> tuple[int, int, uuid.UUID]:
    async with SessionLocal() as db:
        buyer = Account(
            email="benchmark-buyer@example.test",
            password_hash="not-a-real-password",
            roles=["buyer"],
        )
        seller = Account(
            email="benchmark-seller@example.test",
            password_hash="not-a-real-password",
            roles=["buyer", "seller"],
        )
        db.add_all([buyer, seller])
        await db.flush()

        category = Category(name="Benchmark", slug="benchmark")
        db.add(category)
        await db.flush()
        product = Product(
            seller_id=seller.id,
            category_id=category.id,
            title="Benchmark product",
            status=ProductStatus.active,
            service_type="other",
            pricing_strategy="flat",
        )
        db.add(product)
        await db.flush()
        variant = ProductVariant(
            product_id=product.id,
            name="Benchmark variant",
            price=10_000,
            delivery_mode=DeliveryMode.manual,
        )
        db.add(variant)
        await db.flush()

        if scenario.inventory_variants > 1:
            await db.execute(text("""
                INSERT INTO product_variants
                    (product_id, name, price, delivery_mode, sla_hours, sort_order, is_active)
                SELECT :product_id, 'Benchmark variant ' || n, 10000, 'instant', 24, n, true
                FROM generate_series(2, :variant_count) AS n
            """), {"product_id": product.id, "variant_count": scenario.inventory_variants})
            variant.delivery_mode = DeliveryMode.instant
            await db.flush()
        if scenario.inventory_resources:
            await db.execute(text("""
                WITH variants AS (
                    SELECT array_agg(id ORDER BY id) AS ids, count(*) AS total
                    FROM product_variants WHERE product_id = :product_id
                )
                INSERT INTO resources
                    (variant_id, seller_id, status, data, is_archived, created_at)
                SELECT v.ids[((g - 1) % v.total)::int + 1], :seller_id,
                       'available', 'benchmark-resource-' || g, false, now()
                FROM generate_series(1, :resource_count) AS g
                CROSS JOIN variants v
            """), {
                "product_id": product.id,
                "seller_id": seller.id,
                "resource_count": scenario.inventory_resources,
            })

        total_orders = max(scenario.conversations, scenario.disputes)
        orders = [
            Order(
                buyer_id=buyer.id,
                seller_id=seller.id,
                product_id=product.id,
                variant_id=variant.id,
                quantity=1,
                total_amount=10_000,
                status=OrderStatus.delivered,
            )
            for _ in range(total_orders)
        ]
        db.add_all(orders)
        await db.flush()

        conversations = [
            ChatConversation(
                kind="order",
                status="open",
                product_id=product.id,
                order_id=orders[index].id,
                buyer_id=buyer.id,
                seller_id=seller.id,
                created_by_id=buyer.id,
            )
            for index in range(scenario.conversations)
        ]
        db.add_all(conversations)
        await db.flush()
        db.add_all(
            [
                ChatParticipant(
                    conversation_id=conversation.id,
                    account_id=account_id,
                    context_role=role,
                )
                for conversation in conversations
                for account_id, role in ((buyer.id, "buyer"), (seller.id, "seller"))
            ]
        )
        await db.flush()

        chunk: list[ChatMessage] = []
        for conversation in conversations:
            last_message = None
            for index in range(scenario.messages_per_conversation):
                last_message = ChatMessage(
                    conversation_id=conversation.id,
                    sender_id=buyer.id if index % 2 == 0 else seller.id,
                    sender_role="buyer" if index % 2 == 0 else "seller",
                    client_message_id=uuid.uuid4(),
                    body=f"Benchmark message {index}: " + ("x" * 120),
                )
                chunk.append(last_message)
                if len(chunk) >= 5_000:
                    db.add_all(chunk)
                    await db.flush()
                    chunk.clear()
            if chunk:
                db.add_all(chunk)
                await db.flush()
                chunk.clear()
            if last_message is not None:
                conversation.last_message_id = last_message.id
                conversation.last_message_at = last_message.created_at

        disputes = [
            Dispute(
                order_id=orders[index].id,
                buyer_id=buyer.id,
                reason="Benchmark dispute",
                status=DisputeStatus.open,
            )
            for index in range(scenario.disputes)
        ]
        db.add_all(disputes)
        await db.flush()
        db.add_all(
            DisputeMessage(
                dispute_id=dispute.id,
                actor_id=buyer.id,
                actor_role="buyer",
                event_type="message",
                body="Benchmark dispute message",
            )
            for dispute in disputes
        )
        await db.commit()
        return buyer.id, seller.id, conversations[0].id


async def measure(
    name: str,
    operation: Callable[[], Awaitable[object]],
    repeat: int,
    counter: QueryCounter,
) -> tuple[str, int, float, float]:
    samples: list[float] = []
    query_counts: list[int] = []
    await operation()  # warm caches and statement compilation
    for _ in range(repeat):
        counter.reset()
        started = time.perf_counter()
        await operation()
        samples.append((time.perf_counter() - started) * 1_000)
        query_counts.append(counter.count)
    p95 = (
        statistics.quantiles(samples, n=100, method="inclusive")[94]
        if len(samples) > 1
        else samples[0]
    )
    return name, max(query_counts), statistics.median(samples), p95


async def storage_size() -> tuple[str, str, str, int]:
    async with SessionLocal() as db:
        row = (
            await db.execute(
                text(
                    "SELECT pg_size_pretty(pg_relation_size('chat_messages')), "
                    "pg_size_pretty(pg_indexes_size('chat_messages')), "
                    "pg_size_pretty(pg_total_relation_size('chat_messages')), "
                    "count(*) FROM chat_messages"
                )
            )
        ).one()
        return row[0], row[1], row[2], row[3]


async def main(args: argparse.Namespace) -> None:
    scenario = SCENARIOS[args.scenario]
    await assert_safe_database()
    await reset_database()
    started = time.perf_counter()
    buyer_id, seller_id, conversation_id = await seed(scenario)
    seed_seconds = time.perf_counter() - started

    counter = QueryCounter()
    event.listen(engine.sync_engine, "before_cursor_execute", counter.before_cursor_execute)
    try:
        async with SessionLocal() as db:
            buyer = await db.get(Account, buyer_id)
            assert buyer is not None
            cases = [
                ("chat_inbox", lambda: list_conversations(buyer, "buyer", db)),
                ("chat_detail", lambda: get_conversation(buyer, conversation_id, db)),
                ("admin_disputes", lambda: list_disputes(db, page=1, per_page=100)),
                (
                    "seller_disputes",
                    lambda: list_seller_disputes(
                        seller_id=seller_id,
                        db=db,
                        page=1,
                        per_page=min(scenario.disputes, 100),
                    ),
                ),
                (
                    "seller_inventory",
                    lambda: seller_inventory_summary(
                        seller_id, db, page=1, per_page=100,
                    ),
                ),
            ]
            results = [
                await measure(name, operation, args.repeat, counter)
                for name, operation in cases
            ]
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", counter.before_cursor_execute)

    table_size, index_size, total_size, message_count = await storage_size()
    print(f"scenario={args.scenario} seed_seconds={seed_seconds:.2f}")
    print(f"chat_messages={message_count} table={table_size} indexes={index_size} total={total_size}")
    print(f"{'case':<22} {'queries':>8} {'p50_ms':>10} {'p95_ms':>10}")
    for name, queries, p50, p95 in results:
        print(f"{name:<22} {queries:>8} {p50:>10.2f} {p95:>10.2f}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", choices=SCENARIOS, default="small")
    parser.add_argument("--repeat", type=int, default=5)
    args = parser.parse_args()
    if args.repeat < 1:
        parser.error("--repeat must be at least 1")
    return args


if __name__ == "__main__":
    asyncio.run(main(parse_args()))
