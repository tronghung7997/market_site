import time
import uuid
from datetime import datetime, timedelta, timezone

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


PROVISION_RETRY_AFTER_SECONDS = 120
PROVISION_DEADLINE_SECONDS = 15 * 60


async def provision_sweep_job() -> None:
    """Rescue adapter orders stuck at `pending`.

    Provisioning through RealApiAdapter runs off the request path, so a process
    restart (or a provider outage) can leave an order committed and charged with
    nothing driving it. sla_check_job cannot cover these: it looks up
    order.variant_id, and adapter orders carry product_id instead, so it skips
    them and the buyer's money would sit charged forever.

    Retrying is safe — provision carries a deterministic Idempotency-Key per order
    id, so a duplicate reaching a provider that already fulfilled it cannot
    double-provision. Past the deadline we stop retrying and refund.
    """
    from src.orders.service import provision_pending_order

    async with SessionLocal() as db:
        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        retry_before = now - timedelta(seconds=PROVISION_RETRY_AFTER_SECONDS)
        deadline_before = now - timedelta(seconds=PROVISION_DEADLINE_SECONDS)

        result = await db.execute(
            select(Order).where(
                Order.status == OrderStatus.pending,
                Order.product_id.isnot(None),
                Order.created_at <= retry_before,
            )
        )
        orders = list(result.scalars().all())

        expired = [o for o in orders if o.created_at <= deadline_before]
        # Ids, not ORM objects: the retries run after this session closes.
        retryable_ids = [o.id for o in orders if o.created_at > deadline_before]

        for order in expired:
            await refund_escrow(order.id, order.buyer_id, order.total_amount, db)
            order.status = OrderStatus.cancelled
            await log_event(
                db, "warning", f"Order {order.id} auto-refunded (provision deadline)", job_id=job_id,
                metadata={"event": "provision_deadline_refund", "order_id": order.id},
            )
            await create_alert("provision_stuck", "warning", "order", order.id,
                               f"Đơn #{order.id} huỷ do không provision được trong 15 phút", db)
            logger.warning("provision_deadline_refund", order_id=order.id)
        await db.commit()

    # Retries open their own sessions, so they run after the sweep's own commit.
    for order_id in retryable_ids:
        logger.info("provision_retry", order_id=order_id)
        await provision_pending_order(order_id)


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
