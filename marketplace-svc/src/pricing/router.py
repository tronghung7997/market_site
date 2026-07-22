from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.compatibility import ADAPTER_STRATEGY_COMPAT, check_compatibility, setup_status
from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account
from src.models.order import Order, OrderStatus
from src.models.product import Product
from src.models.provider import Provider, ProviderHealth
from src.pricing.engine import quote_product, resolve_pricing
from src.pricing.factory import get_pricing_strategy

from . import schemas

router = APIRouter(tags=["pricing"])


async def _get_product(product_id: int, db: AsyncSession) -> Product:
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm")
    return product


@router.get("/products/{product_id}/pricing-options", response_model=schemas.PricingOptionsResponse)
async def pricing_options(product_id: int, db: AsyncSession = Depends(get_session)):
    product = await _get_product(product_id, db)
    strategy_name, params = await resolve_pricing(product, db)
    strategy = get_pricing_strategy(strategy_name)
    fields = strategy.get_options(params)

    provider = await db.get(Provider, product.provider_id) if product.provider_id else None
    setup = setup_status(provider.adapter_type if provider else None, strategy_name)

    return schemas.PricingOptionsResponse(
        strategy=strategy_name,
        fields=fields,
        base_info=params,
        ready=not setup["needs_setup"],
        not_ready_reason=setup["needs_setup_reason"],
        adapter_type=provider.adapter_type if provider else None,
    )


@router.post("/products/{product_id}/calculate", response_model=schemas.CalculateResponse)
async def calculate(product_id: int, body: schemas.CalculateRequest, db: AsyncSession = Depends(get_session)):
    product = await _get_product(product_id, db)
    q = await quote_product(product, body.user_config, db)
    return schemas.CalculateResponse(
        amount=q.amount,
        original_amount=q.original_amount,
        discount_pct=q.discount_pct,
    )


@router.get("/products/{product_id}/operations")
async def product_operations(product_id: int, db: AsyncSession = Depends(get_session)):
    """Product operations info: provider, pricing, stats."""
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm")

    # Provider info
    provider_info = None
    if product.provider_id:
        provider = await db.get(Provider, product.provider_id)
        if provider:
            # Get latest health
            health_result = await db.execute(
                select(ProviderHealth)
                .where(ProviderHealth.provider_id == provider.id)
                .order_by(ProviderHealth.checked_at.desc())
                .limit(1)
            )
            latest_health = health_result.scalars().first()
            provider_info = {
                "id": provider.id,
                "name": provider.name,
                "adapter_type": provider.adapter_type,
                "health": latest_health.status if latest_health else None,
            }

    # Pricing info (use same fallback logic)
    strategy_name, params = await resolve_pricing(product, db)
    pricing_info = {"strategy": strategy_name, "params": params}
    setup = setup_status(provider_info["adapter_type"] if provider_info else None, strategy_name)

    # Stats from orders
    delivered_statuses = [OrderStatus.delivered, OrderStatus.completed]
    total_orders = await db.scalar(
        select(func.count(Order.id)).where(Order.product_id == product_id)
    ) or 0
    revenue = await db.scalar(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(
            Order.product_id == product_id,
            Order.status.in_(delivered_statuses),
        )
    ) or 0
    success_count = await db.scalar(
        select(func.count(Order.id)).where(
            Order.product_id == product_id,
            Order.status.in_(delivered_statuses),
        )
    ) or 0
    disputes = await db.scalar(
        select(func.count(Order.id)).where(
            Order.product_id == product_id,
            Order.status == OrderStatus.disputed,
        )
    ) or 0

    success_rate = round(success_count / total_orders, 3) if total_orders > 0 else 1.0

    return {
        "provider": provider_info,
        "pricing": pricing_info,
        "needs_setup": setup["needs_setup"],
        "needs_setup_reason": setup["needs_setup_reason"],
        "demo_mode": setup["demo_mode"],
        "stats": {
            "total_orders": total_orders,
            "revenue": revenue,
            "success_rate": success_rate,
            "disputes": disputes,
        },
    }


@router.get("/admin/providers/{provider_id}/products")
async def provider_products(
    provider_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """List products linked to a provider, with order stats."""
    provider = await db.get(Provider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhà cung cấp")

    result = await db.execute(
        select(Product).where(Product.provider_id == provider_id)
    )
    products = result.scalars().all()

    items = []
    delivered_statuses = [OrderStatus.delivered, OrderStatus.completed]
    for p in products:
        order_count = await db.scalar(
            select(func.count(Order.id)).where(Order.product_id == p.id)
        ) or 0
        revenue = await db.scalar(
            select(func.coalesce(func.sum(Order.total_amount), 0)).where(
                Order.product_id == p.id,
                Order.status.in_(delivered_statuses),
            )
        ) or 0
        strategy_name, _ = await resolve_pricing(p, db)
        compat = check_compatibility(provider.adapter_type, strategy_name)
        items.append({
            "id": p.id,
            "title": p.title,
            "service_type": p.service_type,
            "status": p.status.value,
            "pricing_strategy": p.pricing_strategy,
            "pricing_params": p.pricing_params,
            "order_count": order_count,
            "revenue": revenue,
            "compat_level": compat.level,
            "compat_message": compat.message,
        })

    return items


@router.get("/admin/adapter-compatibility")
async def adapter_compatibility(_: Account = Depends(require_role("admin"))):
    """Ma trận adapter_type ↔ pricing_strategy tương thích — nguồn dùng chung
    cho mọi UI admin lọc/annotate lựa chọn provider thay vì mỗi nơi tự đoán."""
    return {
        adapter: sorted(strategies) if strategies is not None else "*"
        for adapter, strategies in ADAPTER_STRATEGY_COMPAT.items()
    }
