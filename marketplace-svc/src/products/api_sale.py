"""How a product is sold through the public sales API (`/v1`).

The API reuses the storefront checkout unchanged, so what it can sell is
exactly what the web product page can sell:

- `fixed` products are bought by package (`variant`), like the web's
  package picker → `orders.service.create_order`;
- every other strategy (proxy plans, request packages, task URLs, cloud
  plans) is bought with options → `orders.service.create_order_with_adapter`,
  with the same `user_config` the web's `DynamicOrderForm` builds (the
  chosen fields plus `quantity`; a pool proxy pins `package_size` to 1).

`sale_profile` answers both "can /v1 fulfil this product at all" (structural:
used by the admin switch and by `/v1`) and "what does a buyer send"
(`option_fields`, mirroring `GET /products/{id}/pricing-options`).
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.compatibility import check_compatibility
from src.adapters.registry import AdapterSpec, get_spec, max_quantity_for
from src.i18n.catalog import resolve_product_pricing_params
from src.models.product import Product
from src.models.provider import Provider
from src.orders.constants import MAX_ORDER_QUANTITY
from src.pricing.engine import resolve_pricing, without_paused_packages
from src.pricing.factory import get_pricing_strategy

KINDS = ("account", "token", "proxy", "gateway", "service")

# Structural reasons /v1 cannot sell a product (admin switch + /v1 guard).
UNSUPPORTED_NO_PROVIDER = "no_provider"
UNSUPPORTED_INCOMPATIBLE = "incompatible_provider"


def product_kind(service_type: str | None, strategy: str | None, adapter_type: str | None) -> str:
    """What the buyer receives, as one stable word: `proxy` (proxy lines),
    `gateway` (a key for /gw/…), `token` (token lines), `account` (stock lines)
    or `service` (anything else: tasks, plans, manual hand-over)."""
    spec = get_spec(adapter_type)
    if (spec and spec.proxy_source) or service_type == "proxy":
        return "proxy"
    if spec and spec.mints_gateway_key:
        return "gateway"
    if adapter_type == "token_keys" or service_type == "token":
        return "token"
    if (strategy or "fixed") == "fixed" and service_type in (None, "account", "other"):
        return "account"
    return "service"


@dataclass(frozen=True)
class SaleProfile:
    kind: str
    strategy: str
    provider: Provider | None
    spec: AdapterSpec | None
    # Bought with options (create_order_with_adapter) rather than by variant.
    by_options: bool
    # A pool proxy: one proxy per order, `package_size` pinned to 1.
    pool_proxy: bool
    # Quantity bounds of an options order; None = the quantity is carried by an
    # option (request package size, task URL list) and the order is one unit.
    quantity_max: int | None
    unsupported: str | None
    # Provider switched off right now (temporary, not structural).
    provider_paused: bool


async def sale_profile(product: Product, db: AsyncSession) -> SaleProfile:
    strategy, _ = await resolve_pricing(product, db)
    provider = await db.get(Provider, product.provider_id) if product.provider_id else None
    adapter_type = provider.adapter_type if provider else None
    spec = get_spec(adapter_type)
    by_options = strategy != "fixed"
    unsupported = None
    if by_options:
        if provider is None:
            unsupported = UNSUPPORTED_NO_PROVIDER
        elif check_compatibility(adapter_type, strategy).level == "block":
            unsupported = UNSUPPORTED_INCOMPATIBLE
    pool_proxy = bool(spec and spec.proxy_source and strategy == "credit")
    quantity_max: int | None = None
    if by_options:
        adapter_max = max_quantity_for(spec, strategy, provider.config if provider else None)
        if pool_proxy:
            quantity_max = 1
        elif spec and spec.proxy_source:
            # Same rule as the web form: a proxy source without an announced
            # per-order limit stays at one proxy.
            quantity_max = 1 if adapter_max is None else max(1, min(adapter_max, MAX_ORDER_QUANTITY))
        elif strategy in ("task", "credit"):
            quantity_max = None
        else:
            quantity_max = max(1, min(adapter_max or MAX_ORDER_QUANTITY, MAX_ORDER_QUANTITY))
    return SaleProfile(
        kind=product_kind(product.service_type, strategy, adapter_type),
        strategy=strategy, provider=provider, spec=spec, by_options=by_options, pool_proxy=pool_proxy,
        quantity_max=quantity_max, unsupported=unsupported,
        provider_paused=bool(provider is not None and not provider.is_active),
    )


def _public_field(field: dict) -> dict:
    out: dict = {"name": field["field"], "label": field.get("label") or field["field"],
                 "required": bool(field.get("required"))}
    choices = field.get("choices")
    if isinstance(choices, list):
        out["type"] = "enum"
        out["values"] = [
            {"value": c.get("value"), "label": str(c.get("label") or c.get("value")),
             **({"price": int(c["price"])} if c.get("price") is not None else {})}
            for c in choices
        ]
    elif field.get("type") == "number":
        out["type"] = "integer"
        if field.get("min") is not None:
            out["min"] = int(field["min"])
        if field.get("max") is not None:
            out["max"] = int(field["max"])
    elif field.get("type") == "textarea":
        out["type"] = "text"
    else:
        out["type"] = "string"
    if field.get("help"):
        out["description"] = str(field["help"])
    return out


async def option_fields(product: Product, profile: SaleProfile, db: AsyncSession, *, locale: str) -> list[dict]:
    """The `options` a buyer sends for this product: the web checkout's fields
    (same strategy `get_options`, localized labels, paused TopProxy packages
    hidden) without `quantity`, which the API takes at the top level, and
    without `package_size` for a pool proxy, which is always 1."""
    _, params = await resolve_pricing(product, db)
    params = resolve_product_pricing_params(product, locale) or params
    fields = get_pricing_strategy(profile.strategy).get_options(params)
    if profile.provider is not None and profile.provider.adapter_type == "topproxy":
        fields = without_paused_packages(fields)
    hidden = {"quantity"} | ({"package_size"} if profile.pool_proxy else set())
    return [_public_field(f) for f in fields if f.get("field") not in hidden]


def options_ready(fields: list[dict]) -> bool:
    """False when a required choice has nothing left to pick (every package paused)."""
    return not any(f["required"] and f["type"] == "enum" and not f["values"] for f in fields)


def build_user_config(profile: SaleProfile, options: dict, quantity: int) -> dict:
    """The `user_config` the web form would send for these options."""
    config = {**options, "quantity": quantity}
    if profile.pool_proxy:
        config["package_size"] = 1
    return config
