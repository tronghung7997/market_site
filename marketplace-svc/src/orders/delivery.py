"""Read access to `Order.delivered_data`.

The column is deferred with raiseload (it can hold thousands of delivered
lines, tens of MB), so an `Order` row never carries it. Code that really
returns or rewrites the text reads it through these helpers, which reuse a
value already in the session and otherwise select only that column.
"""
import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass

from sqlalchemy import Text, func, inspect, select, type_coerce
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import SessionLocal, id_in
from src.models.order import Order
from src.models.resource import Resource, ResourceStatus, read_stored_text
from src.resources.batches import header_lines, order_batches


def _loaded(order: Order) -> tuple[bool, str | None]:
    state = inspect(order)
    if "delivered_data" in state.dict:
        return True, state.dict["delivered_data"]
    return False, None


async def delivered_data_of(order: Order, db: AsyncSession) -> str | None:
    loaded, value = _loaded(order)
    if loaded:
        return value
    return await db.scalar(select(Order.delivered_data).where(Order.id == order.id))


async def delivered_data_by_order(orders: list[Order], db: AsyncSession) -> dict[int, str | None]:
    """`{order_id: delivered_data}` for several orders with one query."""
    values: dict[int, str | None] = {}
    missing: list[int] = []
    for order in orders:
        loaded, value = _loaded(order)
        if loaded:
            values[order.id] = value
        else:
            missing.append(order.id)
    if missing:
        rows = await db.execute(
            select(Order.id, Order.delivered_data)
            .where(id_in(Order.id, missing))
        )
        values.update(dict(rows.all()))
    return values


@dataclass(frozen=True)
class DeliverySummary:
    """What an order delivered, without reading the delivered text.

    Orders filled from stock (instant packages, seller pools, catalog
    suppliers) deliver `resources` rows: the lines live there, encrypted, and
    `delivered_lines` counts the ones currently delivered (assigned). Other
    orders (proxies, gateway keys, manual deliveries) deliver a short text in
    `Order.delivered_data`.
    """
    from_resources: bool
    delivered_lines: int
    has_text: bool

    @property
    def has_delivery(self) -> bool:
        return self.delivered_lines > 0 or (self.has_text and not self.from_resources)


async def delivery_summary(order_ids: list[int], db: AsyncSession) -> dict[int, DeliverySummary]:
    if not order_ids:
        return {}
    counts = {
        order_id: (total, assigned)
        for order_id, total, assigned in (await db.execute(
            select(
                Resource.order_id,
                func.count(Resource.id),
                func.count(Resource.id).filter(Resource.status == ResourceStatus.assigned),
            )
            .where(id_in(Resource.order_id, order_ids))
            .group_by(Resource.order_id)
        )).all()
    }
    # IS NOT NULL reads the row header only; the (possibly large) text is not fetched.
    with_text = set((await db.scalars(
        select(Order.id).where(id_in(Order.id, order_ids), Order.delivered_data.is_not(None))
    )).all())
    return {
        order_id: DeliverySummary(
            from_resources=counts.get(order_id, (0, 0))[0] > 0,
            delivered_lines=counts.get(order_id, (0, 0))[1],
            has_text=order_id in with_text,
        )
        for order_id in order_ids
    }


async def delivery_text_of(order: Order, db: AsyncSession) -> str | None:
    """The delivered text for an order that delivers text; None for an order
    filled from stock, whose lines are read page by page from `resources`
    (a leftover copy on older orders is ignored)."""
    summary = (await delivery_summary([order.id], db))[order.id]
    if summary.from_resources:
        return None
    return await delivered_data_of(order, db)


# Lines per decrypt round; a stock line can be 200 KB (RESOURCE_DATA_MAX_LENGTH).
DELIVERY_STREAM_BATCH = 50


async def stream_delivery_lines(order_id: int) -> AsyncIterator[bytes]:
    """Every currently delivered line, one per line of text, for download.

    Stock orders are read in batches of `DELIVERY_STREAM_BATCH` rows, each on
    its own short session (no connection is held while the client downloads),
    and decrypted in a worker thread so a large order never blocks the event
    loop. Text deliveries are sent as stored.
    """
    async with SessionLocal() as db:
        summary = (await delivery_summary([order_id], db))[order_id]
        text = None if summary.from_resources else await db.scalar(
            select(Order.delivered_data).where(Order.id == order_id)
        )
    if not summary.from_resources:
        if text:
            yield (text if text.endswith("\n") else text + "\n").encode()
        return
    # Lines of a stock batch come under its format line and `# login notes`;
    # a new block (after a blank line) starts whenever the batch changes.
    async with SessionLocal() as db:
        heads = {b["id"]: header_lines(b["format"], b["login_note"]) for b in await order_batches(order_id, db)}
    after = 0
    current: int | None | bool = False  # False: nothing written yet
    while True:
        async with SessionLocal() as db:
            rows = (await db.execute(
                select(Resource.id, Resource.batch_id, type_coerce(Resource.data, Text))
                .where(
                    Resource.order_id == order_id,
                    Resource.status == ResourceStatus.assigned,
                    Resource.id > after,
                )
                .order_by(Resource.id)
                .limit(DELIVERY_STREAM_BATCH)
            )).all()
        if not rows:
            return
        lines = await asyncio.to_thread(lambda: [read_stored_text(stored) for _, _, stored in rows])
        out: list[str] = []
        for (_, batch_id, _), line in zip(rows, lines):
            if batch_id != current:
                if current is not False:
                    out.append("\n")
                out.append(heads.get(batch_id, "") if batch_id is not None else "")
                current = batch_id
            out.append(f"{line}\n")
        yield "".join(out).encode()
        if len(rows) < DELIVERY_STREAM_BATCH:
            return
        after = rows[-1][0]


async def delivered_lines(
    order_id: int, db: AsyncSession, *, max_lines: int, max_bytes: int,
) -> tuple[list[dict], bool]:
    """The order's currently delivered lines as ``[{line, data}]`` plus whether
    the list was cut at ``max_lines`` / ``max_bytes`` (public API payloads).

    Stock orders number every line of the order 1-based (the buyer's `#01`,
    so a remedied line keeps its gap) and return only `assigned` ones; text
    deliveries return the stored text line by line."""
    summary = (await delivery_summary([order_id], db))[order_id]
    if not summary.from_resources:
        text = await db.scalar(select(Order.delivered_data).where(Order.id == order_id))
        rows = [line for line in (text or "").splitlines() if line.strip()]
        out, size = [], 0
        for index, line in enumerate(rows, start=1):
            size += len(line)
            if index > max_lines or size > max_bytes:
                return out, True
            out.append({"line": index, "data": line})
        return out, False
    numbered = (
        select(
            Resource.id.label("id"),
            Resource.status.label("status"),
            func.row_number().over(order_by=Resource.id).label("line_no"),
        )
        .where(Resource.order_id == order_id)
        .subquery()
    )
    rows = (await db.execute(
        select(numbered.c.line_no, Resource.data_length, type_coerce(Resource.data, Text))
        .join(Resource, Resource.id == numbered.c.id)
        .where(numbered.c.status == ResourceStatus.assigned)
        .order_by(numbered.c.line_no)
        .limit(max_lines + 1)
    )).all()
    truncated = len(rows) > max_lines
    kept, size = [], 0
    for line_no, length, stored in rows[:max_lines]:
        size += length or 0
        if kept and size > max_bytes:
            truncated = True
            break
        kept.append((line_no, stored))
    texts = await asyncio.to_thread(lambda: [read_stored_text(stored) for _, stored in kept])
    return [{"line": int(line_no), "data": text} for (line_no, _), text in zip(kept, texts)], truncated
