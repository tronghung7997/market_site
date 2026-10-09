"""Can a buyer order this package / product right now — one definition.

Every surface that says "còn hàng / hết hàng" reads these rules: the public
product payloads (``stock_state`` per package, ``availability`` per product),
the storefront "in stock" filter and "from" price (``product_sellable_sql``,
``sellable_min_price_sql``), the seller product table / overview / dashboard
and the admin product list. The frontend renders the states it is given
(``frontend/lib/stock.ts``) and only derives them itself for management
payloads that carry exact counts.

Package (variant) states — ``stock_state``:

- ``in_stock`` / ``low``: instant package with sellable units (seller stock
  lines or a catalog supplier's synced amount, ``suppliers.stock``); ``low``
  when at most ``PUBLIC_LOW_STOCK_THRESHOLD``.
- ``manual``: made to order (``delivery_mode=manual``) — the seller hands over
  within ``sla_hours``. Without a seller limit (``manual_stock`` NULL) it has
  no count and is never "out of stock"; with a limit it shows what is left
  ("còn N") and the order form caps there (``orders.manual_stock`` takes the
  units at checkout). Either way capped by ``max_per_order``, else
  ``MAX_ORDER_QUANTITY``.
- ``paused``: instant package resold from a catalog supplier whose source is
  switched off (``providers.is_active`` false — by hand, out of credit, or
  health checks). Temporary, so not "out of stock"; not purchasable.
- ``out``: instant package with nothing to sell, or a made-to-order package
  whose seller limit is used up (``manual_stock = 0``). Not purchasable.

Product states — ``availability`` (active packages only):

- inventory-managed (fixed price) products roll their packages up: any
  ``in_stock`` → ``in_stock``; else any ``low`` → ``low``; else any
  ``manual`` → ``manual``; else any ``paused`` → ``paused``; else ``out``
  (also when no package is active).
- provider-fulfilled products (config / credit / task pricing) have no stock:
  ``auto`` while their provider is on, ``paused`` while it is off (the product
  page already refuses the order then, ``adapters.compatibility.setup_status``).
"""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import ColumnElement, and_, case, func, or_

from src.models.product import DeliveryMode
from src.orders.constants import MAX_ORDER_QUANTITY

# Public stock is bucketed so competitors cannot poll exact inventory levels.
PUBLIC_LOW_STOCK_THRESHOLD = 10

IN_STOCK = "in_stock"
LOW = "low"
MANUAL = "manual"
PAUSED = "paused"
OUT = "out"
AUTO = "auto"

VARIANT_STATES = (IN_STOCK, LOW, MANUAL, PAUSED, OUT)
PRODUCT_STATES = (IN_STOCK, LOW, MANUAL, PAUSED, OUT, AUTO)
PURCHASABLE = frozenset({IN_STOCK, LOW, MANUAL})


def variant_stock_state(
    delivery_mode: DeliveryMode | str, count: int, *,
    source_paused: bool = False, manual_stock: int | None = None,
) -> str:
    """``count`` = sellable units of an instant package; ``manual_stock`` =
    the seller's remaining limit of a made-to-order one (None = no limit)."""
    mode = delivery_mode.value if isinstance(delivery_mode, DeliveryMode) else delivery_mode
    if mode != DeliveryMode.instant.value:
        if manual_stock is not None and manual_stock <= 0:
            return OUT
        return MANUAL
    if source_paused:
        return PAUSED
    if count <= 0:
        return OUT
    return LOW if count <= PUBLIC_LOW_STOCK_THRESHOLD else IN_STOCK


def variant_max_quantity(
    state: str, count: int, max_per_order: int | None, *, manual_stock: int | None = None,
) -> int:
    """Largest quantity one order may take: the stock for an instant package,
    what is left of a limited made-to-order one (else the marketplace cap),
    never above the seller's ``max_per_order``. 0 when it cannot be bought."""
    if state in (IN_STOCK, LOW):
        high = min(count, MAX_ORDER_QUANTITY)
    elif state == MANUAL:
        high = MAX_ORDER_QUANTITY if manual_stock is None else min(manual_stock, MAX_ORDER_QUANTITY)
    else:
        return 0
    return min(high, max_per_order) if max_per_order is not None else high


def is_purchasable(state: str | None) -> bool:
    return state in PURCHASABLE


def product_availability(
    variant_states: Iterable[str], *, inventory_managed: bool, provider_active: bool = True,
) -> str:
    if not inventory_managed:
        return AUTO if provider_active else PAUSED
    states = set(variant_states)
    for state in (IN_STOCK, LOW, MANUAL, PAUSED):
        if state in states:
            return state
    return OUT


# ── SQL mirrors (aggregates over many products) ───────────────────────────────

def manual_open_sql(delivery_mode_col, manual_stock_col) -> ColumnElement:
    """A made-to-order package still taking orders: no limit, or units left."""
    return and_(
        delivery_mode_col == DeliveryMode.manual,
        or_(manual_stock_col.is_(None), manual_stock_col > 0),
    )


def variant_sellable_sql(delivery_mode_col, stock_col, manual_stock_col) -> ColumnElement:
    """Per package row: purchasable now (an open made-to-order package, or
    instant units to sell). A paused supplier source already counts 0 units
    (``suppliers.stock``)."""
    return or_(
        manual_open_sql(delivery_mode_col, manual_stock_col),
        and_(delivery_mode_col == DeliveryMode.instant, func.coalesce(stock_col, 0) > 0),
    )


def sellable_min_price_sql(price_col, delivery_mode_col, stock_col, manual_stock_col) -> ColumnElement:
    """Aggregate "from" price: the cheapest package a buyer can order now,
    falling back to the cheapest priced package when none can be ordered (a
    sold-out card still shows what it costs)."""
    priced = price_col > 0
    return func.coalesce(
        func.min(price_col).filter(and_(priced, variant_sellable_sql(delivery_mode_col, stock_col, manual_stock_col))),
        func.min(price_col).filter(priced),
    )


def product_sellable_sql(*, managed, stock_count, has_manual, provider_active) -> ColumnElement:
    """Product-level "a buyer can order something here now" (the storefront
    "in stock" filter): provider-fulfilled with its provider on, or an
    inventory product with units to sell or a made-to-order package."""
    return case(
        (managed == False, provider_active),  # noqa: E712
        else_=or_(func.coalesce(stock_count, 0) > 0, func.coalesce(has_manual, False)),
    )


def seller_stock_state(
    *, managed: bool, stock: int, has_manual: bool, low_threshold: int, unlimited: bool = False,
) -> str:
    """The seller/admin product-level label. ``stock`` = instant units plus
    the made-to-order limits left; ``has_manual`` = an active made-to-order
    package still takes orders; ``unlimited`` = the product sells only
    made-to-order and one package has no limit.

    ``not_managed`` for provider products; ``manual`` when it sells only
    made-to-order without a limit (never low or out), or when no units are
    left but an open made-to-order package keeps it on sale (not "out of
    stock" — the empty instant packages still show "out" in the inventory
    console); else the stock buckets with the admin-configured threshold, so a
    product that also sells instant packages keeps its low reminders."""
    if not managed:
        return "not_managed"
    if unlimited:
        return MANUAL
    if stock <= 0:
        return MANUAL if has_manual else OUT
    return LOW if stock <= low_threshold else IN_STOCK
