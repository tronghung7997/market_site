import time
import uuid
from datetime import datetime, timezone

import httpx
import structlog
from sqlalchemy import select

from src.alerts.service import create_alert
from src.audit.service import log_event
from src.database import SessionLocal
from src.models.account import Account
from src.models.order import Order, OrderStatus
from src.models.product import ProductVariant
from src.models.provider import Provider, ProviderHealth
from src.models.resource import Resource, ResourceStatus
from src.providers.service import apply_scores
from src.sellers.tiers import platform_fee_percent
from src.wallet.service import refund_escrow, release_escrow

logger = structlog.get_logger()


async def escrow_release_job() -> None:
    async with SessionLocal() as db:
        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(Order).where(
                Order.status == OrderStatus.delivered,
                Order.escrow_expires_at <= now,
            )
        )
        orders = list(result.scalars().all())
        for order in orders:
            seller = await db.get(Account, order.seller_id)
            fee_percent = platform_fee_percent(seller.seller_tier if seller else "new")
            platform_fee = int(order.total_amount * fee_percent / 100)
            await release_escrow(order.id, order.seller_id, order.total_amount, platform_fee, db)
            order.status = OrderStatus.completed
            from src.affiliate.service import apply_affiliate_commission
            await apply_affiliate_commission(order, db)
            await log_event(db, "info", f"Escrow released for order {order.id}", job_id=job_id,
                            metadata={"event": "escrow_released", "order_id": order.id, "amount": order.total_amount})
            logger.info("escrow_released", order_id=order.id)
        await db.commit()


async def sla_check_job() -> None:
    async with SessionLocal() as db:
        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(Order).where(Order.status == OrderStatus.pending)
        )
        orders = list(result.scalars().all())
        for order in orders:
            variant = await db.get(ProductVariant, order.variant_id)
            if not variant:
                continue
            from datetime import timedelta
            deadline = order.created_at + timedelta(hours=variant.sla_hours)
            if now > deadline:
                await refund_escrow(order.id, order.buyer_id, order.total_amount, db)
                order.status = OrderStatus.cancelled
                await log_event(db, "warning", f"Order {order.id} auto-refunded (SLA breach)", job_id=job_id,
                                metadata={"event": "sla_refund", "order_id": order.id, "seller_id": order.seller_id})
                await create_alert("sla_breach", "warning", "seller", order.seller_id,
                                   f"Đơn #{order.id} đã huỷ do nhà bán không giao đúng hạn", db)
                logger.warning("sla_breach", order_id=order.id, seller_id=order.seller_id)
        await db.commit()


async def health_check_job() -> None:
    async with SessionLocal() as db:
        job_id = str(uuid.uuid4())
        result = await db.execute(select(Provider).where(Provider.is_active))
        providers = list(result.scalars().all())
        for provider in providers:
            endpoint = provider.config.get("health_endpoint", "")
            status_str = "healthy"
            latency_ms = None
            try:
                if endpoint:
                    start = time.monotonic()
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        resp = await client.get(endpoint)
                        latency_ms = int((time.monotonic() - start) * 1000)
                        status_str = "healthy" if resp.status_code < 400 else "unhealthy"
                else:
                    latency_ms = 0
            except Exception:
                status_str = "error"

            health = ProviderHealth(
                provider_id=provider.id, latency_ms=latency_ms,
                success_rate=1.0 if status_str == "healthy" else 0.0,
                status=status_str,
            )
            db.add(health)

            if status_str == "error":
                recent = await db.execute(
                    select(ProviderHealth)
                    .where(ProviderHealth.provider_id == provider.id)
                    .order_by(ProviderHealth.checked_at.desc()).limit(3)
                )
                recent_list = list(recent.scalars().all())
                if len(recent_list) >= 3 and all(h.status == "error" for h in recent_list):
                    provider.is_active = False
                    await log_event(db, "critical", f"Provider {provider.name} marked down", job_id=job_id,
                                    metadata={"event": "provider_down", "provider_id": provider.id})
                    await create_alert("provider_down", "critical", "provider", provider.id,
                                       f"Nhà cung cấp {provider.name} ngừng hoạt động (3 lần kiểm tra liên tiếp thất bại)", db)
        await db.commit()


async def resource_expire_job() -> None:
    async with SessionLocal() as db:
        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(Resource).where(
                Resource.status == ResourceStatus.assigned,
                Resource.expires_at <= now,
            )
        )
        resources = list(result.scalars().all())
        affected_variants: set[int] = set()
        for r in resources:
            r.status = ResourceStatus.expired
            if r.variant_id:
                affected_variants.add(r.variant_id)
            await log_event(db, "info", f"Resource {r.id} expired", job_id=job_id,
                            metadata={"event": "resource_expired", "resource_id": r.id, "order_id": r.order_id})
            logger.info("resource_expired", resource_id=r.id, order_id=r.order_id)

        for vid in affected_variants:
            available = await db.execute(
                select(Resource).where(Resource.variant_id == vid, Resource.status == ResourceStatus.available)
            )
            count = len(list(available.scalars().all()))
            if count <= 3:
                variant = await db.get(ProductVariant, vid)
                seller_id = variant.product.seller_id if variant and hasattr(variant, "product") else 0
                await create_alert("resource_low", "warning", "seller", seller_id or vid,
                                   f"Gói #{vid} chỉ còn {count} tài nguyên sẵn sàng", db)

        await db.commit()


async def provider_scoring_job() -> None:
    async with SessionLocal() as db:
        updated = await apply_scores(db)
        await db.commit()
        logger.info("provider_scoring", updated=updated)
