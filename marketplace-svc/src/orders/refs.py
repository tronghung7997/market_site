"""``/orders/{order_ref}`` path resolution shared by every order-scoped router."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.models.order import Order
from src.orders.codes import parse_order_ref


async def resolve_order_ref(order_ref: str, db: AsyncSession = Depends(get_session)) -> int:
    """Path param ``order_ref`` (``ORD-XXXXXXXX`` or a legacy integer id) -> ``orders.id``.

    Ownership is still checked by the service layer; this only translates the
    reference. Unparseable and unknown refs both answer 404 so nobody can
    tell a foreign order from a nonexistent one.
    """
    parsed = parse_order_ref(order_ref)
    if parsed is None:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    kind, value = parsed
    if kind == "id":
        return int(value)
    order_id = await db.scalar(select(Order.id).where(Order.order_code == value))
    if order_id is None:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return int(order_id)


OrderRef = Annotated[int, Depends(resolve_order_ref)]
