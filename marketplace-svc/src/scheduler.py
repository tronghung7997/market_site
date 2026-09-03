import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import structlog
from sqlalchemy import select

from src.alerts.service import emit_incident, fp_order, fp_provider, fp_variant, upsert_incident
from src.audit.service import log_event
from src.database import SessionLocal
from src.audit.service import purge_operational_logs
from src.gateway.call_history import purge_old_gateway_call_logs
from src.models.account import Account
from src.models.order import Dispute, DisputeResourceAction, DisputeStatus, Order, OrderStatus
from src.models.product import Product, ProductVariant
from src.models.provider import Provider, ProviderHealth
from src.models.resource import Resource, ResourceStatus
from src.providers.service import apply_scores
from src.sellers.tiers import platform_fee_percent
from src.wallet.service import escrow_settlement, refund_escrow, release_escrow
from src.disputes.service import resolve_abandoned_dispute, resolve_dispute_after_response_timeout

logger = structlog.get_logger()


async def escrow_release_job() -> None:
    async with SessionLocal() as db:
        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        # skip_locked + re-check status: confirm/dispute may settle the same
        # delivered row in another session. Without the lock the job would
        # credit the seller after a refund (purchase_release and refund use
        # different ledger types, so the unique (type, reference_id) index
        # does not collide).
        result = await db.execute(
            select(Order).where(
                Order.status == OrderStatus.delivered,
                Order.escrow_expires_at <= now,
                ~select(Dispute.id).where(
                    Dispute.order_id == Order.id,
                    Dispute.status == DisputeStatus.open,
                ).exists(),
            ).with_for_update(skip_locked=True)
        )
        orders = list(result.scalars().all())
        for order in orders:
            try:
                if order.status != OrderStatus.delivered:
                    continue
                seller = await db.get(Account, order.seller_id)
                fee_percent = platform_fee_percent(seller.seller_tier if seller else "new")
                remaining_amount, platform_fee = escrow_settlement(
                    order.total_amount, order.refunded_amount, fee_percent
                )
                if remaining_amount:
                    await release_escrow(order.id, order.seller_id, remaining_amount, platform_fee, db)
                order.status = OrderStatus.completed
                from src.affiliate.service import apply_affiliate_commission
                await apply_affiliate_commission(order, db)
                await log_event(db, "info", f"Escrow released for order {order.id}", job_id=job_id,
                                metadata={"event": "escrow_released", "order_id": order.id, "amount": remaining_amount})
                await db.commit()
                logger.info("escrow_released", order_id=order.id)
            except Exception as e:
                # Một đơn lỗi (vd seller chưa có ví — Account seed thẳng vào DB
                # không qua register_account() thì thiếu Wallet đi kèm) KHÔNG
                # được chặn release của các đơn khác trong batch. Trước đây
                # exception ở đây văng thẳng ra ngoài job, commit() cuối hàm
                # không bao giờ chạy tới nên MỌI đơn tới hạn (kể cả đơn đã xử
                # lý xong trong vòng lặp) bị rollback và kẹt vĩnh viễn mỗi 30
                # phút — đây chính là nguyên nhân đơn #52 kẹt theo đơn #55.
                await db.rollback()
                logger.error("escrow_release_failed", order_id=order.id, error=str(e))
                await log_event(db, "error", f"Escrow release failed for order {order.id}: {e}", job_id=job_id,
                                metadata={"event": "escrow_release_failed", "order_id": order.id, "seller_id": order.seller_id})
                await upsert_incident(
                    db,
                    fingerprint=fp_order(order.id, "escrow_release_failed"),
                    type_="escrow_release_failed",
                    severity="error",
                    target_type="order",
                    target_id=order.id,
                    message=(
                        f"Đơn #{order.id} không tự release được escrow — "
                        f"cần admin kiểm tra ví seller #{order.seller_id}"
                    ),
                )
                await db.commit()


async def dispute_resolution_timeout_job() -> None:
    """Apply seller offers unanswered past the configured buyer-response window."""
    async with SessionLocal() as db:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(Order)
            .join(Dispute, Dispute.order_id == Order.id)
            .where(
                Dispute.status == DisputeStatus.open,
                Dispute.resolution_deadline_at.is_not(None),
                Dispute.resolution_deadline_at <= now,
            )
            .with_for_update(skip_locked=True)
        )
        orders = list(result.scalars().all())
        for order in orders:
            order_id = order.id
            try:
                dispute = await db.scalar(
                    select(Dispute)
                    .where(
                        Dispute.order_id == order.id,
                        Dispute.status == DisputeStatus.open,
                    )
                    .with_for_update()
                )
                if not dispute:
                    continue
                await resolve_dispute_after_response_timeout(dispute, order, db, now=now)
                await db.commit()
                logger.info("dispute_resolution_timeout", dispute_id=dispute.id, order_id=order_id)
            except Exception as e:
                await db.rollback()
                logger.error(
                    "dispute_resolution_timeout_failed",
                    order_id=order_id,
                    error=str(e),
                )


async def dispute_abandonment_job() -> None:
    """Close untouched open cases after escrow expiry plus buyer silence."""
    async with SessionLocal() as db:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(Order)
            .join(Dispute, Dispute.order_id == Order.id)
            .where(
                Dispute.status == DisputeStatus.open,
                Dispute.resolution_deadline_at.is_(None),
                ~select(DisputeResourceAction.id).where(
                    DisputeResourceAction.dispute_id == Dispute.id,
                ).exists(),
                Order.escrow_expires_at.is_not(None),
                Order.escrow_expires_at <= now,
            )
            .with_for_update(skip_locked=True)
        )
        orders = list(result.scalars().all())
        for order in orders:
            order_id = order.id
            try:
                dispute = await db.scalar(
                    select(Dispute)
                    .where(
                        Dispute.order_id == order.id,
                        Dispute.status == DisputeStatus.open,
                    )
                    .with_for_update()
                )
                if not dispute:
                    continue
                await resolve_abandoned_dispute(dispute, order, db, now=now)
                await db.commit()
                logger.info("dispute_abandoned", dispute_id=dispute.id, order_id=order_id)
            except ValueError:
                await db.rollback()
            except Exception as e:
                await db.rollback()
                logger.error(
                    "dispute_abandonment_failed",
                    order_id=order_id,
                    error=str(e),
                )


async def sla_check_job() -> None:
    async with SessionLocal() as db:
        job_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(Order).where(Order.status == OrderStatus.pending).with_for_update(skip_locked=True)
        )
        orders = list(result.scalars().all())
        for order in orders:
            if order.status != OrderStatus.pending:
                continue
            variant = await db.get(ProductVariant, order.variant_id)
            if not variant:
                continue
            from datetime import timedelta
            deadline = order.created_at + timedelta(hours=variant.sla_hours)
            if now <= deadline:
                continue
            try:
                await refund_escrow(order.id, order.buyer_id, order.total_amount, db)
                order.status = OrderStatus.cancelled
                order.cancel_reason = "Người bán không giao hàng đúng hạn nên đơn đã được huỷ. Toàn bộ số tiền đã được hoàn về ví của bạn."
                await log_event(db, "warning", f"Order {order.id} auto-refunded (SLA breach)", job_id=job_id,
                                metadata={"event": "sla_refund", "order_id": order.id, "seller_id": order.seller_id})
                await upsert_incident(
                    db,
                    fingerprint=fp_order(order.id, "sla_breach"),
                    type_="sla_breach",
                    severity="warning",
                    target_type="seller",
                    target_id=order.seller_id,
                    message=f"Đơn #{order.id} đã huỷ do nhà bán không giao đúng hạn",
                )
                await db.commit()
                logger.warning("sla_breach", order_id=order.id, seller_id=order.seller_id)
            except Exception as e:
                # Cùng lỗi thiết kế như escrow_release_job: 1 đơn refund lỗi
                # (buyer chưa có ví) không được chặn refund/huỷ của các đơn
                # SLA-breach khác trong batch.
                await db.rollback()
                logger.error("sla_refund_failed", order_id=order.id, error=str(e))
                await log_event(db, "error", f"SLA auto-refund failed for order {order.id}: {e}", job_id=job_id,
                                metadata={"event": "sla_refund_failed", "order_id": order.id})
                await upsert_incident(
                    db,
                    fingerprint=fp_order(order.id, "sla_refund_failed"),
                    type_="sla_refund_failed",
                    severity="error",
                    target_type="order",
                    target_id=order.id,
                    message=f"Đơn #{order.id} quá hạn SLA nhưng không tự hoàn tiền được — cần admin kiểm tra",
                )
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

        # skip_locked: một provision đang in-flight (background task của
        # create_order_with_adapter, hoặc sweep của WORKER KHÁC — mỗi uvicorn
        # worker chạy một APScheduler riêng) đang giữ FOR UPDATE trên order.
        # Không có skip_locked thì UPDATE của nhánh refund bên dưới sẽ đứng
        # chờ lock, rồi ghi đè `cancelled` + refund lên một đơn vừa được
        # provision xong — buyer vừa được hoàn tiền vừa cầm proxy, Xu đã tiêu.
        # Postgres re-check WHERE sau khi có lock nên đơn đã rời `pending`
        # cũng không lọt vào đây.
        result = await db.execute(
            select(Order).where(
                Order.status == OrderStatus.pending,
                Order.product_id.isnot(None),
                Order.variant_id.is_(None),
                Order.created_at <= retry_before,
            ).with_for_update(skip_locked=True)
        )
        orders = list(result.scalars().all())

        expired = [o for o in orders if o.created_at <= deadline_before]
        # Ids, not ORM objects: the retries run after this session closes.
        retryable_ids = [o.id for o in orders if o.created_at > deadline_before]

        for order in expired:
            try:
                await refund_escrow(order.id, order.buyer_id, order.total_amount, db)
                order.status = OrderStatus.cancelled
                order.cancel_reason = "Rất tiếc, đơn không thể cấp phát tự động nên đã được huỷ. Toàn bộ số tiền đã được hoàn về ví của bạn."
                await log_event(
                    db, "warning", f"Order {order.id} auto-refunded (provision deadline)", job_id=job_id,
                    metadata={"event": "provision_deadline_refund", "order_id": order.id},
                )
                alert_message = f"Đơn #{order.id} huỷ do không provision được trong 15 phút"
                # Đơn TopProxy tĩnh: lệnh mua mang marker ở username có thể ĐÃ
                # thành công (Xu đã trừ, proxy nằm trong tài khoản) dù mọi retry
                # đều chết trước khi bind — chỉ hướng dẫn đối soát thì admin mới
                # biết đường cứu bằng scripts/recover_topproxy_orders.py.
                product = await db.get(Product, order.product_id) if order.product_id else None
                provider = await db.get(Provider, product.provider_id) if product and product.provider_id else None
                if provider is not None and provider.adapter_type == "topproxy":
                    from src.config import settings
                    alert_message += (
                        f" — kiểm tra listproxy TopProxy xem có proxy mang marker "
                        f"{settings.topproxy_marker_prefix}{order.id} không (nếu có: Xu đã trừ, "
                        f"cứu bằng scripts/recover_topproxy_orders.py)"
                    )
                await upsert_incident(
                    db,
                    fingerprint=fp_order(order.id, "provision_stuck"),
                    type_="provision_stuck",
                    severity="warning",
                    target_type="order",
                    target_id=order.id,
                    message=alert_message,
                )
                await db.commit()
                logger.warning("provision_deadline_refund", order_id=order.id)
            except Exception as e:
                # Cùng lỗi thiết kế như escrow_release_job/sla_check_job: 1 đơn
                # refund lỗi (buyer chưa có ví) không được chặn refund của các
                # đơn expired khác trong batch.
                await db.rollback()
                logger.error("provision_deadline_refund_failed", order_id=order.id, error=str(e))
                await log_event(db, "error", f"Provision deadline refund failed for order {order.id}: {e}", job_id=job_id,
                                metadata={"event": "provision_deadline_refund_failed", "order_id": order.id})
                await upsert_incident(
                    db,
                    fingerprint=fp_order(order.id, "provision_stuck"),
                    type_="provision_stuck",
                    severity="error",
                    target_type="order",
                    target_id=order.id,
                    message=f"Đơn #{order.id} quá hạn provision nhưng không tự hoàn tiền được — cần admin kiểm tra",
                )
                await db.commit()

    # Retries open their own sessions, so they run after the sweep's own commit.
    for order_id in retryable_ids:
        logger.info("provision_retry", order_id=order_id)
        await provision_pending_order(order_id)


async def health_check_job() -> None:
    """Chấm sức khoẻ mọi provider đang bật, và tắt provider hỏng 3 lần liên tiếp.

    Ưu tiên `adapter.check_health()` — với nhà cung cấp thật (TopProxy, DProxy)
    đó là lệnh list read-only mang đúng API key, nên nó phát hiện được "sai API
    key" và "hết Xu", những thứ một GET vào `health_endpoint` không bao giờ
    thấy. Trước đây job chỉ biết `config["health_endpoint"]`; provider thật
    không khai field đó nên rơi vào nhánh `else: latency_ms = 0` và LUÔN được
    ghi `healthy` — cơ chế tự tắt provider hỏng chưa từng chạy cho TopProxy,
    và `check_health()` chỉ được gọi khi admin bấm tay ở /admin/providers.

    `health_endpoint` vẫn là đường dự phòng cho provider không có adapter thật
    (hoặc adapter dựng lỗi).
    """
    from src.adapters.factory import get_adapter

    async with SessionLocal() as db:
        job_id = str(uuid.uuid4())
        result = await db.execute(select(Provider).where(Provider.is_active))
        providers = list(result.scalars().all())
        for provider in providers:
            endpoint = provider.config.get("health_endpoint", "")
            status_str = "healthy"
            latency_ms = None
            checked_via_adapter = False
            try:
                start = time.monotonic()
                adapter = await get_adapter(provider.id, db)
                health_result = await adapter.check_health()
                latency_ms = int((time.monotonic() - start) * 1000)
                # "warning" KHÔNG phải hỏng: ManualAdapter dùng nó cho backlog
                # cao, SellerPoolAdapter cho tồn kho thấp — cả hai vẫn bán được
                # bình thường. Gộp chúng vào "unhealthy" là tự tắt provider của
                # một seller chỉ vì kho còn dưới 5 món. Ghi nguyên trạng thái
                # để admin thấy, và chỉ "unhealthy" mới tính vào ngưỡng tắt.
                raw = (health_result or {}).get("status", "healthy")
                status_str = raw if raw in ("healthy", "warning") else "unhealthy"
                checked_via_adapter = True
            except Exception:
                # Adapter không dựng được / chưa hỗ trợ → thử health_endpoint.
                checked_via_adapter = False

            if not checked_via_adapter:
                try:
                    if endpoint:
                        start = time.monotonic()
                        async with httpx.AsyncClient(timeout=5.0) as client:
                            resp = await client.get(endpoint)
                            latency_ms = int((time.monotonic() - start) * 1000)
                            status_str = "healthy" if resp.status_code < 400 else "unhealthy"
                    else:
                        latency_ms = 0
                        status_str = "healthy"
                except Exception:
                    status_str = "error"

            health = ProviderHealth(
                provider_id=provider.id, latency_ms=latency_ms,
                success_rate=1.0 if status_str == "healthy" else 0.0,
                status=status_str,
            )
            db.add(health)

            # Điều kiện tự tắt tính trên "không healthy", không chỉ "error":
            # với adapter thật, sai API key trả về `unhealthy` chứ không phải
            # `error`, mà đó đúng là ca cần tắt nhất — mỗi đơn đi qua provider
            # hỏng là một vòng trừ tiền → cấp phát fail → hoàn tiền cho buyer.
            # Vẫn giữ ngưỡng 3 lần liên tiếp nên một cú mạng chập không đủ tắt.
            if status_str != "healthy":
                recent = await db.execute(
                    select(ProviderHealth)
                    .where(ProviderHealth.provider_id == provider.id)
                    .order_by(ProviderHealth.checked_at.desc()).limit(3)
                )
                recent_list = list(recent.scalars().all())
                if len(recent_list) >= 3 and all(h.status != "healthy" for h in recent_list):
                    provider.is_active = False
                    await log_event(db, "critical", f"Provider {provider.name} marked down", job_id=job_id,
                                    metadata={"event": "provider_down", "provider_id": provider.id})
                    await upsert_incident(
                        db,
                        fingerprint=fp_provider(provider.id, "provider_down"),
                        type_="provider_down",
                        severity="critical",
                        target_type="provider",
                        target_id=provider.id,
                        message=(
                            f"Nhà cung cấp {provider.name} ngừng hoạt động "
                            f"(3 lần kiểm tra liên tiếp thất bại)"
                        ),
                    )
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
                seller_id = 0
                if variant is not None:
                    product = await db.get(Product, variant.product_id) if variant.product_id else None
                    seller_id = product.seller_id if product else 0
                await upsert_incident(
                    db,
                    fingerprint=fp_variant(vid, "resource_low"),
                    type_="resource_low",
                    severity="warning",
                    target_type="seller",
                    target_id=seller_id or vid,
                    message=f"Gói #{vid} chỉ còn {count} tài nguyên sẵn sàng",
                )

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
            await upsert_incident(
                db,
                fingerprint=fp_order(order.id, "task_webhook_timeout"),
                type_="task_webhook_timeout",
                severity="warning",
                target_type="order",
                target_id=order.id,
                message=(
                    f"Đơn #{order.id}: seller không phản hồi webhook trong hạn, "
                    f"{len(pending)} tác vụ đã timeout"
                ),
            )
            # update_task already committed domain state; persist audit + incident.
            await db.commit()
            logger.warning("task_webhook_sla_timeout", order_id=order.id, task_count=len(pending))


# Consecutive reconciliation runs an allocation's external_id can be absent
# from the supplier's list response before it's flagged `error` + alerted.
# Matches health_check_job's existing "3 consecutive failures" convention
# above — one bad /list response (a supplier hiccup, not the assignment
# actually being gone) must not immediately destroy a recoverable binding.
DPROXY_MISSING_GRACE_ROUNDS = 3


async def dproxy_reconciliation_job() -> None:
    """Batched health/lifecycle sweep for DProxy allocations (plan Task 7,
    docs/superpowers/specs/2026-07-22-dproxy-integration.md; state machine
    per docs/superpowers/plans/2026-07-22-dproxy-review-fixes.md Blocker 2).
    One list_assignments() call per provider, then every allocated OR
    offline binding for that provider is reconciled in memory by
    external_id — never one list request per order.

    `list_assignments()` now returns the FULL inventory (online and
    offline/inactive/expired alike — see src/adapters/dproxy.py). For each
    bound allocation:
      - present + expired: `expired` (terminal, not recoverable).
      - present + online + unexpired: `allocated` (covers both "still fine"
        and "recovered from offline").
      - present + offline/inactive: `offline` — recoverable, included in
        next run's query, rotate disabled meanwhile via
        src/resources/proxy_router.py's `status == allocated` gate.
      - absent entirely: bump `consecutive_misses`; only flip to `error` +
        alert once DPROXY_MISSING_GRACE_ROUNDS is reached, so a single bad
        supplier response can't destroy a binding that's actually still
        there.

    Never assigns a replacement credential to an already-delivered order.
    Does not auto-refund; that is an explicit business policy decision the
    plan defers (default: flag + alert only).
    """
    from src.adapters.dproxy import DProxyAdapter, DProxyAuthError, DProxyContractError, DProxyUnavailableError
    from src.adapters.factory import get_adapter
    from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationStatus
    from src.resources.proxy_service import _apply_assignment

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
                await upsert_incident(
                    db,
                    fingerprint=fp_provider(provider.id, "dproxy_auth_error"),
                    type_="dproxy_auth_error",
                    severity="critical",
                    target_type="provider",
                    target_id=provider.id,
                    message=f"Provider {provider.name}: sai thông tin xác thực DProxy",
                )
                continue
            except DProxyUnavailableError:
                await upsert_incident(
                    db,
                    fingerprint=fp_provider(provider.id, "dproxy_unavailable"),
                    type_="dproxy_unavailable",
                    severity="warning",
                    target_type="provider",
                    target_id=provider.id,
                    message=f"Provider {provider.name}: không kết nối được DProxy",
                )
                continue
            except DProxyContractError:
                await upsert_incident(
                    db,
                    fingerprint=fp_provider(provider.id, "dproxy_contract_error"),
                    type_="dproxy_contract_error",
                    severity="critical",
                    target_type="provider",
                    target_id=provider.id,
                    message=f"Provider {provider.name}: DProxy trả về dữ liệu không hợp lệ",
                )
                continue

            by_external_id: dict[str, object] = {}
            duplicate_count = 0
            for a in assignments:
                if a.external_id in by_external_id:
                    duplicate_count += 1
                by_external_id[a.external_id] = a
            if duplicate_count:
                await upsert_incident(
                    db,
                    fingerprint=fp_provider(provider.id, "dproxy_duplicate_external_id"),
                    type_="dproxy_duplicate_external_id",
                    severity="warning",
                    target_type="provider",
                    target_id=provider.id,
                    message=(
                        f"Provider {provider.name}: {duplicate_count} external_id "
                        f"trùng lặp trong tồn kho"
                    ),
                )

            bindings = list((await db.execute(
                select(ProxyAllocation).where(
                    ProxyAllocation.provider_id == provider.id,
                    ProxyAllocation.status.in_(
                        [ProxyAllocationStatus.allocated, ProxyAllocationStatus.offline],
                    ),
                )
            )).scalars().all())

            for allocation in bindings:
                match = by_external_id.get(allocation.external_id)

                if match is None:
                    allocation.consecutive_misses += 1
                    if allocation.expires_at <= now:
                        allocation.status = ProxyAllocationStatus.expired
                    elif allocation.consecutive_misses >= DPROXY_MISSING_GRACE_ROUNDS:
                        allocation.status = ProxyAllocationStatus.error
                        order = await db.get(Order, allocation.order_id)
                        order_status = order.status.value if order else "unknown"
                        await upsert_incident(
                            db,
                            fingerprint=fp_order(allocation.order_id, "dproxy_allocation_disappeared"),
                            type_="dproxy_allocation_disappeared",
                            severity="critical",
                            target_type="order",
                            target_id=allocation.order_id,
                            message=(
                                f"Đơn #{allocation.order_id} (proxy {allocation.external_id}): "
                                f"biến mất khỏi DProxy {allocation.consecutive_misses} lần liên tiếp, "
                                f"trước hạn marketplace (order {order_status})"
                            ),
                        )
                        logger.warning("dproxy_allocation_disappeared", order_id=allocation.order_id,
                                       allocation_id=allocation.id, external_id=allocation.external_id)
                    # else: still within grace — leave status as-is (allocated
                    # or offline), just recorded the miss and move on.
                    continue

                # Present — reset the miss counter regardless of state below.
                allocation.consecutive_misses = 0
                _apply_assignment(allocation, match)
                if match.expires_at <= now:
                    allocation.status = ProxyAllocationStatus.expired
                elif match.online:
                    was_offline = allocation.status == ProxyAllocationStatus.offline
                    allocation.status = ProxyAllocationStatus.allocated
                    if was_offline:
                        logger.info("dproxy_allocation_recovered", order_id=allocation.order_id,
                                   allocation_id=allocation.id, external_id=allocation.external_id)
                else:
                    allocation.status = ProxyAllocationStatus.offline

            logger.info(
                "dproxy_reconciliation", provider_id=provider.id, total=len(assignments),
                usable=sum(1 for a in assignments if a.is_usable(now=now)), bound=len(bindings),
                rotation_capable=sum(1 for a in assignments if a.rotation_available),
            )

        await db.commit()


async def provider_credit_low_job() -> None:
    """Cảnh báo TRƯỚC khi tài khoản nhà cung cấp trả trước cạn tiền.

    Đây là nửa "dự báo" của cơ chế; nửa "phản ứng" nằm ở
    src/providers/credit.py::report_out_of_credit (gặp mã 102 thì đã muộn —
    một đơn của khách đã hỏng rồi).

    Chỉ xét provider đã BẬT theo dõi (`credit_balance_xu` khác NULL). Incident
    fingerprint per provider so a 15-minute poll only bumps occurrence_count.
    """
    from src.providers.credit import ALERT_LOW_CREDIT, DEFAULT_LOW_THRESHOLD_XU

    async with SessionLocal() as db:
        providers = list((await db.execute(
            select(Provider).where(Provider.credit_balance_xu.isnot(None))
        )).scalars().all())

        for provider in providers:
            threshold = provider.credit_low_threshold_xu or DEFAULT_LOW_THRESHOLD_XU
            if provider.credit_balance_xu > threshold:
                continue
            await upsert_incident(
                db,
                fingerprint=fp_provider(provider.id, ALERT_LOW_CREDIT),
                type_=ALERT_LOW_CREDIT,
                severity="warning",
                target_type="provider",
                target_id=provider.id,
                message=(
                    f"Nhà cung cấp {provider.name} sắp hết tiền: còn khoảng "
                    f"{provider.credit_balance_xu:,} Xu (ngưỡng {threshold:,}). "
                    f"Nạp thêm rồi cập nhật số dư ở /admin/providers.".replace(",", ".")
                ),
            )
            logger.warning(
                "provider_credit_low",
                provider_id=provider.id, balance_xu=provider.credit_balance_xu, threshold=threshold,
            )
        await db.commit()


async def deposit_reconcile_job() -> None:
    """Bù miss-webhook cho lệnh nạp multi-provider.

    SePay: API v2 transaction search; NOW: GET /v1/payment/{id}.
    Legacy PayOS intents are still checked while old credentials remain.
    Cùng apply_deposit_paid + FOR UPDATE — không credit đôi.

    Retention: bank rails use deposit_reconcile_retention_hours; NOW uses
    deposit_usdt_reconcile_retention_hours (dài hơn — provider TTL ≠ local UI window).
    """
    from src.models.payment import DepositIntent, DepositIntentStatus, DepositProvider
    from src.payments import nowpayments_client, payos_client, rail_config, sepay_client
    from src.payments.service import reconcile_intent

    secrets_sepay = sepay_client.is_reconciliation_configured()
    legacy_payos = payos_client.is_configured()
    secrets_now = nowpayments_client.is_configured()
    if not secrets_sepay and not legacy_payos and not secrets_now:
        return

    async with SessionLocal() as db:
        rail = await rail_config.ensure_seeded(db)
        sepay_on = bool(rail.sepay_enabled) and secrets_sepay
        now_on = bool(rail.nowpayments_enabled) and secrets_now
        if not sepay_on and not legacy_payos and not now_on:
            return

        now = datetime.now(timezone.utc)
        pending_cutoff = now - timedelta(minutes=10)
        bank_retention = now - timedelta(hours=rail.deposit_reconcile_retention_hours)
        now_retention = now - timedelta(hours=rail.deposit_usdt_reconcile_retention_hours)

        intent_ids: list[int] = []

        bank_providers: list[str] = []
        if sepay_on:
            bank_providers.append(DepositProvider.sepay.value)
        if legacy_payos:
            bank_providers.append(DepositProvider.payos.value)
        if bank_providers:
            pending_rows = await db.execute(
                select(DepositIntent.id).where(
                    DepositIntent.provider.in_(bank_providers),
                    DepositIntent.status == DepositIntentStatus.pending,
                    DepositIntent.paid_at.is_(None),
                    DepositIntent.created_at <= pending_cutoff,
                ).order_by(DepositIntent.created_at).limit(30)
            )
            retention_rows = await db.execute(
                select(DepositIntent.id).where(
                    DepositIntent.provider.in_(bank_providers),
                    DepositIntent.status.in_([DepositIntentStatus.expired, DepositIntentStatus.cancelled]),
                    DepositIntent.paid_at.is_(None),
                    DepositIntent.created_at >= bank_retention,
                ).order_by(DepositIntent.created_at.desc()).limit(20)
            )
            intent_ids.extend(r for (r,) in pending_rows.all())
            intent_ids.extend(r for (r,) in retention_rows.all())

        if now_on:
            # NOW: pending + local expired/cancelled unpaid within longer retention.
            now_pending = await db.execute(
                select(DepositIntent.id).where(
                    DepositIntent.provider == DepositProvider.nowpayments.value,
                    DepositIntent.status == DepositIntentStatus.pending,
                    DepositIntent.paid_at.is_(None),
                    DepositIntent.created_at <= pending_cutoff,
                ).order_by(DepositIntent.created_at).limit(30)
            )
            now_retention_rows = await db.execute(
                select(DepositIntent.id).where(
                    DepositIntent.provider == DepositProvider.nowpayments.value,
                    DepositIntent.status.in_([DepositIntentStatus.expired, DepositIntentStatus.cancelled]),
                    DepositIntent.paid_at.is_(None),
                    DepositIntent.created_at >= now_retention,
                ).order_by(DepositIntent.created_at.desc()).limit(20)
            )
            intent_ids.extend(r for (r,) in now_pending.all())
            intent_ids.extend(r for (r,) in now_retention_rows.all())

        # Dedupe while preserving order
        seen: set[int] = set()
        unique_ids: list[int] = []
        for i in intent_ids:
            if i not in seen:
                seen.add(i)
                unique_ids.append(i)
        intent_ids = unique_ids

    for intent_id in intent_ids:
        async with SessionLocal() as db:
            try:
                await reconcile_intent(intent_id, db)
            except Exception as e:
                logger.error("deposit_reconcile_error", intent_id=intent_id, error=str(e))


async def deposit_expire_job() -> None:
    """Chốt ``expired`` sau local QR/checkout window plus a 5-minute buffer.

    SePay and NOWPayments can still report a real payment later; their handlers
    credit an otherwise-valid late transfer and raise an operations alert.
    """
    from src.models.payment import DepositIntent, DepositIntentStatus

    async with SessionLocal() as db:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
        rows = await db.execute(
            select(DepositIntent).where(
                DepositIntent.status == DepositIntentStatus.pending,
                DepositIntent.expires_at <= cutoff,
            ).with_for_update(skip_locked=True)
        )
        intents = list(rows.scalars().all())
        for intent in intents:
            intent.status = DepositIntentStatus.expired
        if intents:
            await log_event(
                db, "info",
                f"{len(intents)} lệnh nạp quá hạn được chốt expired: {[i.id for i in intents]}",
                job_id=str(uuid.uuid4()),
                metadata={"event": "deposit_expired_sweep", "intent_ids": [i.id for i in intents]},
            )
            await db.commit()
            logger.info("deposit_expire_swept", count=len(intents))


async def operational_log_cleanup_job() -> None:
    """Purge gateway/provider call logs, aged log_entries, and resolved alerts.

    Replaces the gateway-only cleanup: one job, bounded batches, ledger-safe.
    """
    try:
        counts = await purge_operational_logs()
        logger.info("operational_log_cleanup_done", **counts)
    except Exception as e:
        logger.error("operational_log_cleanup_failed", error=str(e))


async def gateway_call_log_cleanup_job() -> None:
    """Backward-compatible name — delegates to operational_log_cleanup_job."""
    await operational_log_cleanup_job()
