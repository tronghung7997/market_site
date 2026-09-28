"""Seller order CSV export, streamed.

Order lists no longer carry delivered goods, and one order can deliver 5 000
lines of up to 200 KB, so "export with delivered data" is produced here, batch
by batch, instead of in the browser from list pages.
"""
import asyncio
import csv
import io
from collections import defaultdict
from collections.abc import AsyncIterator

from sqlalchemy import Text, select, type_coerce

from src.database import SessionLocal, id_in
from src.models.order import Order
from src.models.resource import Resource, ResourceStatus, read_stored_text
from src.orders.delivery import delivered_data_by_order, delivery_summary

EXPORT_MAX_ROWS = 5_000
# Orders per round; all their delivered lines are loaded together.
EXPORT_BATCH = 20

HEADERS = [
    "Order_Code", "Created_At", "Product", "Variant", "Quantity", "Amount_VND", "Status",
    "Fulfillment", "Buyer_Email", "Dispute_Status",
]


def _csv(rows: list[list]) -> str:
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="\r\n").writerows(rows)
    return buffer.getvalue()


async def _delivered_text_by_order(orders: list[Order], db) -> dict[int, str]:
    summaries = await delivery_summary([o.id for o in orders], db)
    text_orders = [o for o in orders if summaries[o.id].has_text and not summaries[o.id].from_resources]
    texts = {k: v or "" for k, v in (await delivered_data_by_order(text_orders, db)).items()}
    stock_ids = [o.id for o in orders if summaries[o.id].from_resources]
    if stock_ids:
        rows = (await db.execute(
            select(Resource.order_id, type_coerce(Resource.data, Text))
            .where(id_in(Resource.order_id, stock_ids), Resource.status == ResourceStatus.assigned)
            .order_by(Resource.order_id, Resource.id)
        )).all()
        plain = await asyncio.to_thread(lambda: [(order_id, read_stored_text(stored)) for order_id, stored in rows])
        lines: dict[int, list[str]] = defaultdict(list)
        for order_id, line in plain:
            lines[order_id].append(line)
        texts.update({order_id: "\n".join(values) for order_id, values in lines.items()})
    return texts


async def stream_seller_orders_csv(seller_id: int, filters: dict, *, sort: str, include_data: bool) -> AsyncIterator[str]:
    from src.orders.service import _enrich_orders, seller_orders_order_by, seller_orders_query

    yield "﻿" + _csv([HEADERS + (["Delivered_Data"] if include_data else [])])
    async with SessionLocal() as db:
        query = await seller_orders_query(seller_id, db, **filters)
        ids = list((await db.scalars(query.order_by(*seller_orders_order_by(sort)).limit(EXPORT_MAX_ROWS))).all())
    for start in range(0, len(ids), EXPORT_BATCH):
        batch_ids = ids[start:start + EXPORT_BATCH]
        async with SessionLocal() as db:
            by_id = {o.id: o for o in (await db.scalars(select(Order).where(id_in(Order.id, batch_ids)))).all()}
            orders = [by_id[i] for i in batch_ids if i in by_id]
            items = await _enrich_orders(orders, db, viewer="seller", include_delivery=False)
            texts = await _delivered_text_by_order(orders, db) if include_data else {}
        yield _csv([
            [
                item["order_code"], item["created_at"].isoformat() if item["created_at"] else "",
                item.get("product_title") or "", item.get("variant_name") or "", item["quantity"],
                item["total_amount"], getattr(item["status"], "value", item["status"]),
                (item.get("fulfillment") or {}).get("kind") or "",
                item.get("buyer_email") or "", item.get("dispute_status") or "",
                *([texts.get(item["id"], "")] if include_data else []),
            ]
            for item in items
        ])
