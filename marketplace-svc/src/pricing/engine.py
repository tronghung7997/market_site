"""Pricing engine — điểm tính giá duy nhất cho preview lẫn order.

Mọi caller (endpoint /calculate, orders service) đều đi qua quote_product
nên giá xem trước và giá trừ ví không thể lệch nhau.
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.pricing_config import PricingConfig
from src.models.product import Product

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


async def resolve_pricing(product: Product, db: AsyncSession) -> tuple[str, dict]:
    """3-tier fallback: product-level -> pricing_configs[service_type] -> fixed."""
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
    if not strategy.validate(params, user_config):
        raise HTTPException(status_code=400, detail="Cấu hình không hợp lệ")
    return strategy.quote(params, user_config)
