"""Pricing engine — điểm tính giá duy nhất cho preview lẫn order.

Mọi caller (endpoint /calculate, orders service) đều đi qua quote_product
nên giá xem trước và giá trừ ví không thể lệch nhau.
"""

from fastapi import status
from sqlalchemy import and_, case, cast, false, func, select, true
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.pricing_config import PricingConfig
from src.models.product import Product
from src.exceptions import ErrorCode, api_error

from .base import Quote
from .factory import get_pricing_strategy


def product_pricing_override(product: Product) -> tuple[str, dict] | None:
    """Return an explicit product-level override when it is complete.

    ``fixed`` intentionally has no JSON params: its prices live on variants, so
    ``pricing_strategy='fixed', pricing_params=NULL`` must still override a
    service-level dynamic pricing config.
    """
    if product.pricing_strategy == "fixed":
        return "fixed", product.pricing_params or {}
    if product.pricing_strategy and product.pricing_params:
        return product.pricing_strategy, product.pricing_params
    return None


def inventory_managed_sql():
    """SQL equivalent of ``product_pricing_override(...) == ('fixed', ...)``.

    ``pricing_params`` is JSON (not JSONB); compare via JSONB cast because
    PostgreSQL has no ``json <> json`` operator.
    """
    config_strategy = (
        select(PricingConfig.strategy)
        .where(
            PricingConfig.service_type == func.coalesce(Product.service_type, "other"),
            PricingConfig.is_active == True,  # noqa: E712
        )
        .limit(1)
        .correlate(Product)
        .scalar_subquery()
    )
    dynamic_override = and_(
        Product.pricing_strategy.is_not(None),
        Product.pricing_strategy != "fixed",
        Product.pricing_params.is_not(None),
        cast(Product.pricing_params, JSONB) != cast("{}", JSONB),
    )
    return case(
        (Product.pricing_strategy == "fixed", true()),
        (dynamic_override, false()),
        else_=func.coalesce(config_strategy, "fixed") == "fixed",
    )


async def resolve_pricing(product: Product, db: AsyncSession) -> tuple[str, dict]:
    """3-tier fallback: product-level -> pricing_configs[service_type] -> fixed.

    Với `fixed`, giá nằm trên ProductVariant chứ không trong JSON params —
    engine tự nạp `params["variants"]` để FixedPricing.validate/quote và
    pricing-options dùng được qua cùng một đường (luồng adapter cho sản phẩm
    fixed: seller_pool, nhà cung cấp catalog `external_stock`). Trước đây
    params rỗng nên mọi quote fixed qua engine đều rớt INVALID_PRODUCT_CONFIG.
    """
    strategy, params = await _resolve_pricing_raw(product, db)
    if strategy == "fixed" and "variants" not in params:
        params = {**params, "variants": await fixed_variant_params(product.id, db)}
    return strategy, params


async def fixed_variant_params(product_id: int, db: AsyncSession) -> list[dict]:
    from src.models.product import ProductVariant

    rows = (await db.execute(
        select(ProductVariant)
        .where(ProductVariant.product_id == product_id, ProductVariant.is_active == True)  # noqa: E712
        .order_by(ProductVariant.sort_order, ProductVariant.id)
    )).scalars()
    return [{"id": v.id, "label": v.name, "price": v.price} for v in rows]


async def _resolve_pricing_raw(product: Product, db: AsyncSession) -> tuple[str, dict]:
    override = product_pricing_override(product)
    if override is not None:
        return override

    service_type = product.service_type or "other"
    result = await db.execute(
        select(PricingConfig).where(
            PricingConfig.service_type == service_type,
            PricingConfig.is_active == True,  # noqa: E712
        )
    )
    config = result.scalars().first()
    if config:
        return config.strategy, config.params

    return "fixed", {}


async def quote_product(product: Product, user_config: dict, db: AsyncSession) -> Quote:
    strategy_name, params = await resolve_pricing(product, db)
    strategy = get_pricing_strategy(strategy_name)
    user_config = strategy.normalize_user_config(params, user_config)
    if not strategy.validate(params, user_config):
        raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST)
    return strategy.quote(params, user_config)
