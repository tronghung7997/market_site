"""Seller-set availability of made-to-order ("theo yêu cầu") packages.

``ProductVariant.manual_stock`` is how many units the package still takes on
(None = no limit). An order takes its quantity off in the same transaction
that charges the buyer and keeps it in ``Order.stock_held`` until the seller
delivers. An order cancelled before delivery (SLA breach, admin refund) puts
the held units back; once delivered they are used, so a later dispute or
refund does not.
"""

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import set_committed_value

from src.exceptions import ResourceUnavailable
from src.models.order import Order
from src.models.product import DeliveryMode, ProductVariant


def manual_stock_allows(variant: ProductVariant, quantity: int) -> bool:
    """Read-only check for quotes: does the package have ``quantity`` left?"""
    if variant.delivery_mode != DeliveryMode.manual or variant.manual_stock is None:
        return True
    return variant.manual_stock >= quantity


async def take_manual_stock(variant: ProductVariant, order: Order, db: AsyncSession) -> None:
    """Take ``order.quantity`` off a limited made-to-order package, or raise
    ``ResourceUnavailable`` (409, like a sold-out instant package). One
    conditional UPDATE, so two buyers can never both take the last units."""
    if variant.delivery_mode != DeliveryMode.manual or variant.manual_stock is None:
        return
    left = (await db.execute(
        update(ProductVariant)
        .where(
            ProductVariant.id == variant.id,
            ProductVariant.manual_stock.is_not(None),
            ProductVariant.manual_stock >= order.quantity,
        )
        .values(manual_stock=ProductVariant.manual_stock - order.quantity)
        .returning(ProductVariant.manual_stock)
        .execution_options(synchronize_session=False)
    )).scalar_one_or_none()
    if left is None:
        raise ResourceUnavailable()
    set_committed_value(variant, "manual_stock", left)
    order.stock_held = order.quantity


async def release_manual_stock(order: Order, db: AsyncSession) -> None:
    """Give an undelivered order's held units back to its package. Idempotent;
    a package switched to "no limit" in the meantime simply stays unlimited."""
    held = order.stock_held or 0
    if held <= 0 or order.variant_id is None:
        return
    await db.execute(
        update(ProductVariant)
        .where(ProductVariant.id == order.variant_id, ProductVariant.manual_stock.is_not(None))
        .values(manual_stock=ProductVariant.manual_stock + held)
        .execution_options(synchronize_session="fetch")
    )
    order.stock_held = 0


def consume_manual_stock(order: Order) -> None:
    """The seller delivered: the held units are used for good."""
    order.stock_held = 0
