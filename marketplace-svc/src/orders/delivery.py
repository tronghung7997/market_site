"""Read access to `Order.delivered_data`.

The column is deferred with raiseload (it can hold thousands of delivered
lines, tens of MB), so an `Order` row never carries it. Code that really
returns or rewrites the text reads it through these helpers, which reuse a
value already in the session and otherwise select only that column.
"""
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import id_in
from src.models.order import Order


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
