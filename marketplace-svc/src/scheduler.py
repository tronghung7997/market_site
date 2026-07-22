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


TASK_WEBHOOK_SLA_SECONDS = 48 * 3600


async def task_webhook_sla_job() -> None:
    """Rescue `seller_task_webhook` orders whose seller never calls the
    webhook back. sla_check_job (above) only covers the variant/manual-
    delivery path (looks up variant.sla_hours); provision_sweep_job only
    covers RealApiAdapter's one-shot provision. Neither watches an order that
    went `processing` waiting on an external callback that may just never
    arrive — this is that same class of "adapter fulfillment can go silent"
    gap ManualAdapter has always had too (no timeout there either — an admin
    is expected to notice a stale row in /admin/tasks), just newly reachable
    by an outside party (the seller's own backend) instead of only by staff.

    Timing out a task is done by feeding it back through the SAME
    update_task()/_sync_order_status() path a real webhook would use — a
    stuck task becomes `failed` with an explanatory result_data, and whatever
    completed/partial-refund/full-refund logic already exists for "some tasks
    failed" runs unchanged. No separate refund logic to keep in sync.
    """
    from src.models.product import Product
    from src.models.service_task import ServiceTask, ServiceTaskStatus
    from src.tasks.service import _TERMINAL, update_task

    async with SessionLocal() as db:
        job_id = str(uuid.uuid4())
        deadline_before = datetime.now(timezone.utc) - timedelta(seconds=TASK_WEBHOOK_SLA_SECONDS)

        result = await db.execute(
            select(Order).where(
                Order.status == OrderStatus.processing,
                Order.product_id.isnot(None),
                Order.created_at <= deadline_before,
            )
        )
        stuck_orders = list(result.scalars().all())

        for order in stuck_orders:
            product = await db.get(Product, order.product_id)
            if not product or not product.provider_id:
                continue
            provider = await db.get(Provider, product.provider_id)
            if not provider or provider.adapter_type != "seller_task_webhook":
                continue  # not this job's concern (e.g. ManualAdapter — see docstring)

            tasks_result = await db.execute(select(ServiceTask).where(ServiceTask.order_id == order.id))
            tasks = list(tasks_result.scalars().all())
            pending = [t for t in tasks if t.status not in _TERMINAL]
            if not pending:
                continue  # already terminal, some other race is finishing it

            for task in pending:
                await update_task(
                    task.id,
                    {"status": ServiceTaskStatus.failed, "result_data": "Hết hạn chờ phản hồi từ seller (timeout)"},
                    db,
                )
            await log_event(
                db, "warning", f"Order {order.id}: {len(pending)} task(s) timed out waiting on seller webhook",
                job_id=job_id,
                metadata={"event": "task_webhook_sla_timeout", "order_id": order.id, "task_count": len(pending)},
            )
            await create_alert("task_webhook_timeout", "warning", "order", order.id,
                               f"Đơn #{order.id}: seller không phản hồi webhook trong hạn, {len(pending)} tác vụ đã timeout", db)
            logger.warning("task_webhook_sla_timeout", order_id=order.id, task_count=len(pending))


async def dproxy_reconciliation_job() -> None:
    """Batched health/lifecycle sweep for DProxy allocations (plan Task 7,
    docs/superpowers/specs/2026-07-22-dproxy-integration.md). One
    list_assignments() call per provider, then every active binding for
    that provider is reconciled in memory by external_id — never one list
    request per order.

    Marks bindings expired/missing/error without deleting audit history.
    Never assigns a replacement credential to an already-delivered order —
    a binding whose upstream assignment disappeared before the
    marketplace-side expiry is flagged `error` + alerted, not silently
    re-provisioned. Does not auto-refund; that is an explicit business
    policy decision the plan defers (default: flag + alert only).
    """
    from src.adapters.dproxy import DProxyAdapter, DProxyAuthError, DProxyContractError, DProxyUnavailableError
    from src.adapters.factory import get_adapter
    from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationStatus
    from src.resources.proxy_service import apply_rotated_assignment

    async with SessionLocal() as db:
        now = datetime.now(timezone.utc)

        providers = list((await db.execute(
            select(Provider).where(Provider.adapter_type == "dproxy", Provider.is_active)
        )).scalars().all())

        for provider in providers:
            try:
                adapter = await get_adapter(provider.id, db)
            except ValueError:
                continue
            if not isinstance(adapter, DProxyAdapter):
                continue

            try:
                assignments = await adapter.list_assignments()
            except DProxyAuthError:
                await create_alert("dproxy_auth_error", "critical", "provider", provider.id,
                                   f"Provider {provider.name}: sai thông tin xác thực DProxy", db)
                continue
            except DProxyUnavailableError:
                await create_alert("dproxy_unavailable", "warning", "provider", provider.id,
                                   f"Provider {provider.name}: không kết nối được DProxy", db)
                continue
            except DProxyContractError:
                await create_alert("dproxy_contract_error", "critical", "provider", provider.id,
                                   f"Provider {provider.name}: DProxy trả về dữ liệu không hợp lệ", db)
                continue

            by_external_id: dict[str, object] = {}
            duplicate_count = 0
            for a in assignments:
                if a.external_id in by_external_id:
                    duplicate_count += 1
                by_external_id[a.external_id] = a
            if duplicate_count:
                await create_alert(
                    "dproxy_duplicate_external_id", "warning", "provider", provider.id,
                    f"Provider {provider.name}: {duplicate_count} external_id trùng lặp trong tồn kho", db,
                )

            bindings = list((await db.execute(
                select(ProxyAllocation).where(
                    ProxyAllocation.provider_id == provider.id,
                    ProxyAllocation.status == ProxyAllocationStatus.allocated,
                )
            )).scalars().all())

            for allocation in bindings:
                match = by_external_id.get(allocation.external_id)
                if match is not None:
                    # Metadata refresh only — never touches Order.delivered_data;
                    # only the buyer-triggered rotate endpoint does that.
                    apply_rotated_assignment(allocation, match)
                    continue
                if allocation.expires_at <= now:
                    allocation.status = ProxyAllocationStatus.expired
                else:
                    allocation.status = ProxyAllocationStatus.error
                    order = await db.get(Order, allocation.order_id)
                    order_status = order.status.value if order else "unknown"
                    await create_alert(
                        "dproxy_allocation_disappeared", "critical", "order", allocation.order_id,
                        f"Đơn #{allocation.order_id} (proxy {allocation.external_id}): biến mất khỏi "
                        f"DProxy trước hạn marketplace (order {order_status})", db,
                    )
                    logger.warning("dproxy_allocation_disappeared", order_id=allocation.order_id,
                                   allocation_id=allocation.id, external_id=allocation.external_id)

            logger.info(
                "dproxy_reconciliation", provider_id=provider.id, usable=len(assignments),
                bound=len(bindings), rotation_capable=sum(1 for a in assignments if a.rotation_available),
            )

        await db.commit()
