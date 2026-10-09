import time
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone

import httpx
import structlog
from sqlalchemy import Interval, func, literal, literal_column, or_, select, update

from src.alerts.service import emit_incident, fp_order, fp_provider, fp_variant, upsert_incident
from src.audit.service import log_event
from src.database import SessionLocal, id_in
from src.audit.service import purge_operational_logs
from src.gateway.call_history import purge_old_gateway_call_logs
from src.models.account import Account
from src.models.order import Dispute, DisputeProxyAction, DisputeResourceAction, DisputeStatus, Order, OrderStatus
from src.models.product import Product, ProductVariant
from src.models.provider import Provider, ProviderHealth
from src.models.resource import Resource, ResourceStatus
from src.providers.service import apply_scores
from src.fees.service import order_fee_percent
from src.orders.manual_stock import release_manual_stock
from src.wallet.service import escrow_settlement, refund_escrow, release_escrow
from src.disputes.service import resolve_abandoned_dispute, resolve_dispute_after_response_timeout
from src.chat.retention import CHAT_RETENTION_BATCH_SIZE, purge_expired_messages
from src.media.service import collect_garbage as collect_media_garbage

logger = structlog.get_logger()


# Settlement jobs pick due orders by id in small batches and settle each one in
# its own session under a fresh row lock whose WHERE repeats the whole due
# condition. Locking a batch up front does not hold: the first per-order commit
# releases every lock in the batch, and a buyer confirmation, a new dispute or a
# background provision can change the remaining rows before the loop gets there.
_DUE_BATCH_SIZE = 200


def _status_is(column, value):
    """`column = value` with the enum literal written into the SQL, not bound.

    asyncpg prepares every statement, and after five runs Postgres may keep a
    generic plan. That plan cannot see a bound status, assumes every status
    holds an even share of the table (1/7 of `orders`) and answers
    `status = $1 AND id > $2 ORDER BY id LIMIT 200` by walking the primary key
    and filtering, which reads the whole table whenever nothing is due. With
    the literal every plan reads the real frequency from the column statistics
    and takes ix_orders_status_id. Only enum members come through here."""
    return column == literal(value, column.type, literal_execute=True)


async def _due_order_ids(*conditions) -> AsyncIterator[int]:
    last_id = 0
    while True:
        async with SessionLocal() as db:
            ids = list((await db.scalars(
                select(Order.id)
                .where(Order.id > last_id, *conditions)
                .order_by(Order.id)
                .limit(_DUE_BATCH_SIZE)
            )).all())
        for order_id in ids:
            yield order_id
        if len(ids) < _DUE_BATCH_SIZE:
            return
        last_id = ids[-1]


async def _lock_due_order(db, order_id: int, *conditions) -> Order | None:
    """The order, locked, if it still matches `conditions`; None when it no
    longer does or another session holds it."""
    return await db.scalar(
        select(Order)
        .where(Order.id == order_id, *conditions)
        .with_for_update(of=Order, skip_locked=True)
    )


async def escrow_release_job() -> None:
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    # Each order is re-locked with the full due condition (skip_locked):
    # confirm/dispute may settle or freeze the same delivered row in another
    # session. Without the lock the job would credit the seller after a refund
    # (purchase_release and refund use different ledger types, so the unique
    # (type, reference_id) index does not collide).
    due = (
        _status_is(Order.status, OrderStatus.delivered),
        Order.escrow_expires_at <= now,
        ~select(Dispute.id).where(
            Dispute.order_id == Order.id,
            _status_is(Dispute.status, DisputeStatus.open),
        ).exists(),
    )
    async for order_id in _due_order_ids(*due):
        async with SessionLocal() as db:
            order = await _lock_due_order(db, order_id, *due)
            if order is None:
                continue
            seller_id = order.seller_id
            try:
                seller = await db.get(Account, seller_id)
                fee_percent = await order_fee_percent(order, seller.seller_tier if seller else "new", db)
                remaining_amount, platform_fee = escrow_settlement(
                    order.total_amount, order.refunded_amount, fee_percent
                )
                if remaining_amount:
                    await release_escrow(order.id, seller_id, remaining_amount, platform_fee, db)
                order.status = OrderStatus.completed
                from src.affiliate.service import apply_affiliate_commission
                await apply_affiliate_commission(order, db)
                from src.buyer_tiers.cashback import apply_buyer_cashback
                await apply_buyer_cashback(order, db)
                await log_event(db, "info", f"Escrow released for order {order_id}", job_id=job_id,
                                metadata={"event": "escrow_released", "order_id": order_id, "amount": remaining_amount})
                await db.commit()
                logger.info("escrow_released", order_id=order_id)
            except Exception as e:
                # Một đơn lỗi (vd seller chưa có ví — Account seed thẳng vào DB
                # không qua register_account() thì thiếu Wallet đi kèm) KHÔNG
                # được chặn release của các đơn khác. Trước đây exception ở đây
                # văng thẳng ra ngoài job, commit() cuối hàm không bao giờ chạy
                # tới nên MỌI đơn tới hạn (kể cả đơn đã xử lý xong trong vòng
                # lặp) bị rollback và kẹt vĩnh viễn mỗi 30 phút — đây chính là
                # nguyên nhân đơn #52 kẹt theo đơn #55. Sau rollback chỉ dùng id
                # đã giữ sẵn: đọc attribute của object đã expire là lazy-load.
                await db.rollback()
                logger.error("escrow_release_failed", order_id=order_id, error=str(e))
                await log_event(db, "error", f"Escrow release failed for order {order_id}: {e}", job_id=job_id,
                                metadata={"event": "escrow_release_failed", "order_id": order_id, "seller_id": seller_id})
                await upsert_incident(
                    db,
                    fingerprint=fp_order(order_id, "escrow_release_failed"),
                    type_="escrow_release_failed",
                    severity="error",
                    target_type="order",
                    target_id=order_id,
                    message=(
                        f"Đơn #{order_id} không tự release được escrow — "
                        f"cần admin kiểm tra ví seller #{seller_id}"
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
                Dispute.review_requested_at.is_(None),
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


async def dispute_seller_timeout_job() -> None:
    """Refund cases the seller ignored past their response deadline (A4.5)."""
    from src.disputes.service import resolve_dispute_after_seller_timeout
    async with SessionLocal() as db:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(Order)
            .join(Dispute, Dispute.order_id == Order.id)
            .where(
                Dispute.status == DisputeStatus.open,
                Dispute.review_requested_at.is_(None),
                Dispute.seller_responded_at.is_(None),
                Dispute.seller_deadline_at.is_not(None),
                Dispute.seller_deadline_at <= now,
            )
            .with_for_update(skip_locked=True)
        )
        orders = list(result.scalars().all())
        for order in orders:
            order_id = order.id
            try:
                dispute = await db.scalar(
                    select(Dispute)
                    .where(Dispute.order_id == order.id, Dispute.status == DisputeStatus.open)
                    .with_for_update()
                )
                if not dispute:
                    continue
                amount = await resolve_dispute_after_seller_timeout(dispute, order, db, now=now)
                await db.commit()
                logger.info("dispute_seller_timeout", dispute_id=dispute.id, order_id=order_id, amount=amount)
            except ValueError:
                await db.rollback()
            except Exception as e:
                await db.rollback()
                logger.error("dispute_seller_timeout_failed", order_id=order_id, error=str(e))


async def dispute_abandonment_job() -> None:
    """Close untouched open cases after escrow expiry plus buyer silence."""
    async with SessionLocal() as db:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(Order)
            .join(Dispute, Dispute.order_id == Order.id)
            .where(
                Dispute.status == DisputeStatus.open,
                Dispute.review_requested_at.is_(None),
                Dispute.resolution_deadline_at.is_(None),
                ~select(DisputeResourceAction.id).where(
                    DisputeResourceAction.dispute_id == Dispute.id,
                ).exists(),
                ~select(DisputeProxyAction.id).where(
                    DisputeProxyAction.dispute_id == Dispute.id,
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
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    # Deadline in SQL: only pending variant orders past `sla_hours` are read and
    # locked, not every pending order (adapter orders have no variant and are
    # left to provision_sweep_job).
    sla_deadline = Order.created_at + ProductVariant.sla_hours * literal_column("interval '1 hour'", Interval)
    breached = (
        _status_is(Order.status, OrderStatus.pending),
        select(ProductVariant.id).where(
            ProductVariant.id == Order.variant_id,
            sla_deadline < now,
        ).exists(),
    )
    async for order_id in _due_order_ids(*breached):
        async with SessionLocal() as db:
            order = await _lock_due_order(db, order_id, *breached)
            if order is None:
                continue
            try:
                await refund_escrow(order.id, order.buyer_id, order.total_amount, db)
                await release_manual_stock(order, db)
                order.status = OrderStatus.cancelled
                order.cancel_reason = "Người bán không giao hàng đúng hạn nên đơn đã được huỷ. Toàn bộ số tiền đã được hoàn về ví của bạn."
                await log_event(db, "warning", f"Order {order_id} auto-refunded (SLA breach)", job_id=job_id,
                                metadata={"event": "sla_refund", "order_id": order_id, "seller_id": order.seller_id})
                await upsert_incident(
                    db,
                    fingerprint=fp_order(order_id, "sla_breach"),
                    type_="sla_breach",
                    severity="warning",
                    target_type="seller",
                    target_id=order.seller_id,
                    message=f"Đơn {order.order_code} đã huỷ do nhà bán không giao đúng hạn",
                )
                await db.commit()
                logger.warning("sla_breach", order_id=order_id, seller_id=order.seller_id)
            except Exception as e:
                # Cùng lỗi thiết kế như escrow_release_job: 1 đơn refund lỗi
                # (buyer chưa có ví) không được chặn refund/huỷ của các đơn
                # SLA-breach khác.
                await db.rollback()
                logger.error("sla_refund_failed", order_id=order_id, error=str(e))
                await log_event(db, "error", f"SLA auto-refund failed for order {order_id}: {e}", job_id=job_id,
                                metadata={"event": "sla_refund_failed", "order_id": order_id})
                await upsert_incident(
                    db,
                    fingerprint=fp_order(order_id, "sla_refund_failed"),
                    type_="sla_refund_failed",
                    severity="error",
                    target_type="order",
                    target_id=order_id,
                    message=f"Đơn #{order_id} quá hạn SLA nhưng không tự hoàn tiền được — cần admin kiểm tra",
                )
                await db.commit()


PROVISION_RETRY_AFTER_SECONDS = 120
PROVISION_DEADLINE_SECONDS = 15 * 60


async def _dispute_dproxy_deadline_order(order: Order, provider: Provider, db) -> str:
    """Xếp partner-dispute cho đơn DProxy quá hạn provision, CÙNG transaction
    hoàn tiền (upstream_revocation_job gửi sau commit — không gọi HTTP khi
    đang giữ FOR UPDATE trên đơn). Trả về đoạn nối vào alert message."""
    from src.adapters.dproxy import DProxyAdapter
    from src.adapters.factory import get_binding_adapter
    from src.pricing.engine import resolve_pricing
    from src.resources.proxy_service import enqueue_upstream_revocation, list_order_allocations

    try:
        adapter = await get_binding_adapter(provider.id, db)
    except Exception as e:  # noqa: BLE001
        return f" — không dựng được adapter DProxy để thu hồi ({e})"
    if not isinstance(adapter, DProxyAdapter):
        return ""
    strategy_name, _ = await resolve_pricing(await db.get(Product, order.product_id), db)
    if not adapter.is_purchase_config({**(order.user_config or {}), "pricing_strategy": strategy_name}):
        return ""
    # Mỗi proxy của đơn là một lệnh mua riêng (partner_order_id theo dòng):
    # dòng đã bind dùng id đã chốt, dòng chưa bind — lệnh mua có thể đã tới
    # DProxy — dùng id deterministic của dòng đó.
    bound = {a.line_no: a for a in await list_order_allocations(order.id, db)}
    partner_order_ids = []
    for line_no in range(1, max(order.quantity or 1, max(bound, default=0)) + 1):
        allocation = bound.get(line_no)
        partner_order_ids.append(
            allocation.partner_order_id if allocation is not None and allocation.partner_order_id
            else adapter.partner_order_id_for(order.id, line_no)
        )
    for partner_order_id in partner_order_ids:
        await enqueue_upstream_revocation(provider.id, order.id, partner_order_id, "provision_deadline", db)
    if len(partner_order_ids) == 1:
        return f" — đã xếp partner-dispute partner_order_id={partner_order_ids[0]} (outbox upstream_revocations)"
    return (
        f" — đã xếp partner-dispute {len(partner_order_ids)} dòng, partner_order_id="
        f"{partner_order_ids[0]} … {partner_order_ids[-1]} (outbox upstream_revocations)"
    )


async def provision_sweep_job() -> None:
    """Rescue adapter orders stuck at `pending`.

    Provisioning through an adapter runs off the request path, so a process
    restart (or a provider outage) can leave an order committed and charged with
    nothing driving it. Covered: adapter orders without a variant, and orders
    bought from a catalog supplier (igbm) — those carry a variant_id for
    display, and waiting for sla_check_job would hold the buyer's money for the
    package's sla_hours.

    Retrying is safe for providers that take a deterministic Idempotency-Key per
    order id. Catalog suppliers take none, so an order is retried only while it
    has no `purchase_dispatched` marker (written before the request leaves,
    call_log.PURCHASE_DISPATCHED_OPERATION); one with a marker is never bought
    again and is refunded at the deadline with a critical reconciliation alert.
    Past the deadline we stop retrying and refund.
    """
    from src.adapters.call_log import PURCHASE_DISPATCHED_OPERATION
    from src.adapters.registry import catalog_supplier_adapter_types
    from src.models.provider import ProviderCallLog
    from src.orders.service import provision_pending_order

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    retry_before = now - timedelta(seconds=PROVISION_RETRY_AFTER_SECONDS)
    deadline_before = now - timedelta(seconds=PROVISION_DEADLINE_SECONDS)
    catalog_order = (
        select(Provider.id)
        .join(Product, Product.provider_id == Provider.id)
        .where(Product.id == Order.product_id, Provider.adapter_type.in_(catalog_supplier_adapter_types()))
        .exists()
    )
    purchase_dispatched = (
        select(ProviderCallLog.id)
        .where(ProviderCallLog.order_id == Order.id, ProviderCallLog.operation == PURCHASE_DISPATCHED_OPERATION)
        .exists()
    )
    stuck = (
        _status_is(Order.status, OrderStatus.pending),
        Order.product_id.isnot(None),
        or_(Order.variant_id.is_(None), catalog_order),
    )
    expired = (*stuck, Order.created_at <= deadline_before)

    # skip_locked: một provision đang in-flight (background task của
    # create_order_with_adapter, hoặc sweep của WORKER KHÁC — mỗi uvicorn
    # worker chạy một APScheduler riêng) đang giữ FOR UPDATE trên order.
    # Không có skip_locked thì UPDATE của nhánh refund bên dưới sẽ đứng
    # chờ lock, rồi ghi đè `cancelled` + refund lên một đơn vừa được
    # provision xong — buyer vừa được hoàn tiền vừa cầm proxy, Xu đã tiêu.
    # Mỗi đơn được khoá lại riêng với điều kiện `pending`, nên đơn đã rời
    # `pending` (kể cả trong lúc job đang chạy) không lọt vào nhánh refund.
    async for order_id in _due_order_ids(*expired):
        async with SessionLocal() as db:
            order = await _lock_due_order(db, order_id, *expired)
            if order is None:
                continue
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
                elif provider is not None and provider.adapter_type == "dproxy":
                    # Đơn M2M: mọi retry đều timeout/5xx không có nghĩa là DProxy
                    # CHƯA cấp node — timeout sau khi họ fulfill là hoàn toàn có
                    # thể. Buyer đã được hoàn tiền nên gửi partner-dispute để
                    # DProxy thu node + hoàn credit; 404 = họ không có đơn này.
                    alert_message += await _dispute_dproxy_deadline_order(order, provider, db)
                severity = "warning"
                dispatched = await db.scalar(
                    select(ProviderCallLog.id).where(
                        ProviderCallLog.order_id == order.id,
                        ProviderCallLog.operation == PURCHASE_DISPATCHED_OPERATION,
                    ).limit(1)
                )
                if dispatched is not None:
                    # Nguồn catalog không có idempotency key: lệnh mua đã rời
                    # hệ thống nhưng đơn không bao giờ được ghi nhận (process
                    # chết / rollback). Có thể nguồn ĐÃ trừ tiền — không mua lại,
                    # admin đối soát tay trong lịch sử đơn của nhà cung cấp.
                    severity = "critical"
                    alert_message += (
                        " — lệnh mua ĐÃ được gửi tới nhà cung cấp nhưng đơn không được ghi nhận; "
                        "buyer đã được hoàn tiền. Đối soát tay trong lịch sử đơn/số dư của nhà cung "
                        "cấp (Nguồn cung → nhật ký gọi API của đơn này) xem nguồn đã trừ tiền chưa."
                    )
                await upsert_incident(
                    db,
                    fingerprint=fp_order(order.id, "provision_stuck"),
                    type_="provision_stuck",
                    severity=severity,
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
                logger.error("provision_deadline_refund_failed", order_id=order_id, error=str(e))
                await log_event(db, "error", f"Provision deadline refund failed for order {order_id}: {e}", job_id=job_id,
                                metadata={"event": "provision_deadline_refund_failed", "order_id": order_id})
                await upsert_incident(
                    db,
                    fingerprint=fp_order(order_id, "provision_stuck"),
                    type_="provision_stuck",
                    severity="error",
                    target_type="order",
                    target_id=order_id,
                    message=f"Đơn #{order_id} quá hạn provision nhưng không tự hoàn tiền được — cần admin kiểm tra",
                )
                await db.commit()

    # Retries open their own sessions; provision_pending_order skips an order
    # another provision is already holding.
    retryable = (
        *stuck, Order.created_at <= retry_before, Order.created_at > deadline_before, ~purchase_dispatched,
    )
    retryable_ids = [order_id async for order_id in _due_order_ids(*retryable)]
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
            # "warning" cố ý KHÔNG tính vào ngưỡng tắt (xem comment trên) —
            # so sánh với "healthy" thôi là 3 lần "kho thấp" liên tiếp cũng
            # tắt provider, đúng thứ comment nói không được làm.
            if status_str not in ("healthy", "warning"):
                recent = await db.execute(
                    select(ProviderHealth)
                    .where(ProviderHealth.provider_id == provider.id)
                    .order_by(ProviderHealth.checked_at.desc()).limit(3)
                )
                recent_list = list(recent.scalars().all())
                if len(recent_list) >= 3 and all(h.status not in ("healthy", "warning") for h in recent_list):
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


_EXPIRE_BATCH_SIZE = 1000


async def resource_expire_job() -> None:
    """Mark assigned resources past `expires_at` as expired, a bounded batch per
    transaction (the due rows locked, skipping rows another session holds, then
    one UPDATE ... RETURNING re-checking `assigned`), then warn sellers whose
    package runs low."""
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    affected_variants: set[int] = set()
    while True:
        async with SessionLocal() as db:
            # Earliest expiry first, so ix_resources_status_expires_at returns
            # the batch in order and the LIMIT stops the scan; ordered by id the
            # planner walked the primary key through every resource. The ids go
            # to the UPDATE as one array: as an IN (subquery) the planner sized
            # the batch at the LIMIT and hash-joined it against every assigned row.
            due_ids = list((await db.scalars(
                select(Resource.id)
                .where(Resource.status == ResourceStatus.assigned, Resource.expires_at <= now)
                .order_by(Resource.expires_at, Resource.id)
                .limit(_EXPIRE_BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )).all())
            rows = (await db.execute(
                update(Resource)
                .where(id_in(Resource.id, due_ids), Resource.status == ResourceStatus.assigned)
                .values(status=ResourceStatus.expired)
                .returning(Resource.id, Resource.order_id, Resource.variant_id)
                .execution_options(synchronize_session=False)
            )).all() if due_ids else []
            for resource_id, order_id, variant_id in rows:
                if variant_id:
                    affected_variants.add(variant_id)
                await log_event(db, "info", f"Resource {resource_id} expired", job_id=job_id,
                                metadata={"event": "resource_expired", "resource_id": resource_id, "order_id": order_id})
                logger.info("resource_expired", resource_id=resource_id, order_id=order_id)
            await db.commit()
        if len(due_ids) < _EXPIRE_BATCH_SIZE:
            break

    if not affected_variants:
        return
    async with SessionLocal() as db:
        available = dict((await db.execute(
            select(Resource.variant_id, func.count(Resource.id))
            .where(
                Resource.variant_id.in_(affected_variants),
                Resource.status == ResourceStatus.available,
                Resource.order_id.is_(None),
                Resource.is_archived == False,  # noqa: E712
            )
            .group_by(Resource.variant_id)
        )).all())
        for vid in affected_variants:
            count = available.get(vid, 0)
            if count <= 3:
                variant = await db.get(ProductVariant, vid)
                seller_id = 0
                product = None
                if variant is not None:
                    product = await db.get(Product, variant.product_id) if variant.product_id else None
                    seller_id = product.seller_id if product else 0
                # Sellers see package names and keys, never variant row ids.
                label = f"{product.title} · {variant.name}" if product and variant else (variant.name if variant else "?")
                await upsert_incident(
                    db,
                    fingerprint=fp_variant(vid, "resource_low"),
                    type_="resource_low",
                    severity="warning",
                    target_type="seller",
                    target_id=seller_id or vid,
                    message=f"Gói {label} chỉ còn {count} tài nguyên sẵn sàng",
                    href=f"/seller/inventory/{variant.public_key}" if variant else None,
                )
        await db.commit()


async def provider_scoring_job() -> None:
    async with SessionLocal() as db:
        updated = await apply_scores(db)
        await db.commit()
        logger.info("provider_scoring", updated=updated)


async def takedown_sync_job() -> None:
    """Polling safety net for takedown requests: the partner retries a webhook
    only 4 times within ~30 seconds, so missed or reordered events, failed
    creates and buyer accepts not yet confirmed are re-read here."""
    from src.takedown.client import is_configured
    from src.takedown.service import sync_due_requests

    if not is_configured():
        return
    count = await sync_due_requests()
    if count:
        logger.info("takedown_sync", requests=count)


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
    from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationSource, ProxyAllocationStatus
    from src.resources.proxy_service import _apply_assignment

    async with SessionLocal() as db:
        now = datetime.now(timezone.utc)

        # Hết hạn theo đồng hồ cho node MUA qua M2M chạy TRƯỚC và cho MỌI
        # provider DProxy, kể cả provider đang tắt (hết credit / rollback) và
        # khi lệnh list bên dưới hỏng — không thì đơn đã hết hạn cứ hiện "còn
        # hạn" cho tới khi provider được bật lại.
        dproxy_ids = select(Provider.id).where(Provider.adapter_type == "dproxy")
        expired_purchases = list((await db.execute(
            select(ProxyAllocation).where(
                ProxyAllocation.provider_id.in_(dproxy_ids),
                ProxyAllocation.source == ProxyAllocationSource.purchase.value,
                ProxyAllocation.status.in_([ProxyAllocationStatus.allocated, ProxyAllocationStatus.offline]),
                ProxyAllocation.expires_at <= now,
            )
        )).scalars().all())
        for allocation in expired_purchases:
            allocation.status = ProxyAllocationStatus.expired
        await db.commit()

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

            # Commit before the inventory download (retried, up to minutes):
            # no pooled connection and no row lock of the previous provider's
            # updates is held while waiting on DProxy.
            await db.commit()
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

            # Binding MUA qua M2M: node có trong /proxies/user dưới đúng
            # assignment_id (live 2026-09-23) → làm mới IP/đổi IP/online. Bản
            # ghi cũ giữ order UUID thì không bao giờ khớp — vắng mặt KHÔNG
            # được đếm là "mất tích" (không flip `error`), chỉ hết hạn theo
            # đồng hồ ở đầu job.
            purchased_live = list((await db.execute(
                select(ProxyAllocation).where(
                    ProxyAllocation.provider_id == provider.id,
                    ProxyAllocation.source == ProxyAllocationSource.purchase.value,
                    ProxyAllocation.status.in_([ProxyAllocationStatus.allocated, ProxyAllocationStatus.offline]),
                )
            )).scalars().all())
            for allocation in purchased_live:
                match = by_external_id.get(allocation.external_id)
                if match is None:
                    continue
                _apply_assignment(allocation, match)
                allocation.consecutive_misses = 0
                if match.expires_at <= now:
                    allocation.status = ProxyAllocationStatus.expired
                elif match.online:
                    allocation.status = ProxyAllocationStatus.allocated
                else:
                    allocation.status = ProxyAllocationStatus.offline

            bindings = list((await db.execute(
                select(ProxyAllocation).where(
                    ProxyAllocation.provider_id == provider.id,
                    ProxyAllocation.source != ProxyAllocationSource.purchase.value,
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
                purchased_refreshed=sum(1 for a in purchased_live if a.external_id in by_external_id),
                rotation_capable=sum(1 for a in assignments if a.rotation_available),
            )
            await db.commit()

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


# A NOWPayments intent that expired or was cancelled locally can still be paid
# on the provider for days (docs/superpowers/specs/2026-08-12-nowpayments-api-
# contract-verification.md), so reconcile keeps it for
# deposit_usdt_reconcile_retention_hours (192 h by default). The IPN is the
# primary credit path; this sweep only covers a missed one. Checking such an
# intent every 5 minutes for 8 days cost an auth + payment-list round trip
# (~1 s) on every run, so it is re-checked less often as it ages. Pending
# intents and the first hours after creation are still checked every run.
# Each step is (age below which it applies, minimum seconds between checks).
_NOW_STALE_RECHECK_STEPS: tuple[tuple[timedelta, float], ...] = (
    (timedelta(hours=3), 0.0),
    (timedelta(hours=24), 30 * 60.0),
)
_NOW_STALE_RECHECK_MAX_SECONDS = 2 * 3600.0
# Runs drift by up to the 60 s job jitter; do not let that push a check one
# whole run later.
_NOW_STALE_RECHECK_SLACK_SECONDS = 90.0
# Intent id → time.monotonic() of its last completed provider check. Process
# memory on purpose: the scheduler runs on one leader process, and a restart
# only means every stale intent is checked once more right away.
_now_stale_last_checked: dict[int, float] = {}


def _now_stale_recheck_due(intent_id: int, created_at: datetime, now: datetime) -> bool:
    age = now - created_at
    interval = _NOW_STALE_RECHECK_MAX_SECONDS
    for limit, step_interval in _NOW_STALE_RECHECK_STEPS:
        if age < limit:
            interval = step_interval
            break
    last = _now_stale_last_checked.get(intent_id)
    if last is None or interval <= 0:
        return True
    return time.monotonic() - last + _NOW_STALE_RECHECK_SLACK_SECONDS >= interval


async def deposit_reconcile_job() -> None:
    """Bù miss-webhook cho lệnh nạp multi-provider.

    SePay: API v2 transaction search; NOW: GET /v1/payment/{id} or, for a
    hosted invoice, GET /v1/payment/?invoiceId= (needs a POST /v1/auth token).
    Legacy PayOS intents are still checked while old credentials remain.
    Cùng apply_deposit_paid + FOR UPDATE — không credit đôi.

    Retention: bank rails use deposit_reconcile_retention_hours; NOW uses
    deposit_usdt_reconcile_retention_hours (dài hơn — provider TTL ≠ local UI window).
    Locally expired/cancelled NOW intents back off with age, see
    ``_NOW_STALE_RECHECK_STEPS``. Nothing to check → no provider call at all.
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
        stale_now_ids: set[int] = set()

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
                select(DepositIntent.id, DepositIntent.created_at).where(
                    DepositIntent.provider == DepositProvider.nowpayments.value,
                    DepositIntent.status.in_([DepositIntentStatus.expired, DepositIntentStatus.cancelled]),
                    DepositIntent.paid_at.is_(None),
                    DepositIntent.created_at >= now_retention,
                ).order_by(DepositIntent.created_at.desc()).limit(20)
            )
            intent_ids.extend(r for (r,) in now_pending.all())
            stale_rows = now_retention_rows.all()
            stale_now_ids = {intent_id for intent_id, _ in stale_rows}
            # Forget intents that left the window (paid, aged out, or reopened).
            for intent_id in list(_now_stale_last_checked):
                if intent_id not in stale_now_ids:
                    del _now_stale_last_checked[intent_id]
            intent_ids.extend(
                intent_id for intent_id, created_at in stale_rows
                if _now_stale_recheck_due(intent_id, created_at, now)
            )
        else:
            _now_stale_last_checked.clear()

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
                outcome = await reconcile_intent(intent_id, db)
            except Exception as e:
                logger.error("deposit_reconcile_error", intent_id=intent_id, error=str(e), exc_info=True)
                continue
        # A provider error is retried on the next run, not after the back-off.
        if intent_id in stale_now_ids and outcome.get("reconcile_result") != "provider_error":
            _now_stale_last_checked[intent_id] = time.monotonic()


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


async def chat_message_retention_job() -> None:
    try:
        deleted = 0
        async with SessionLocal() as db:
            while deleted < 20_000:
                batch = await purge_expired_messages(db)
                deleted += batch
                if batch < CHAT_RETENTION_BATCH_SIZE:
                    break
        logger.info("chat_message_retention_done", deleted=deleted)
    except Exception as e:
        logger.error("chat_message_retention_failed", error=str(e))


async def notification_retention_job() -> None:
    """Read notifications older than the retention window; unread ones stay."""
    from src.notifications.history import purge_old

    try:
        async with SessionLocal() as db:
            deleted = await purge_old(db)
        logger.info("notification_retention_done", deleted=deleted)
    except Exception as e:
        logger.error("notification_retention_failed", error=str(e))


async def media_gc_job() -> None:
    """Delete abandoned uploads (pending > 1 day) and detached images past grace."""
    try:
        deleted = await collect_media_garbage()
        if deleted:
            logger.info("media_gc_done", deleted=deleted)
    except Exception as e:
        logger.error("media_gc_failed", error=str(e))


async def auto_review_job() -> None:
    """Automatic 5★ for orders the buyer never rated (admin-configurable delay)."""
    from src.reviews.service import auto_review_stale_orders

    async with SessionLocal() as db:
        try:
            reviewed = await auto_review_stale_orders(db)
            if reviewed:
                logger.info("auto_review_applied", count=len(reviewed))
        except Exception as e:
            await db.rollback()
            logger.error("auto_review_failed", error=str(e))


async def ledger_reconcile_job() -> None:
    """Nightly books check (A3.4): recompute every balance from the
    transaction log and raise `ledger_mismatch` incidents for anything that
    does not add up. Read-mostly; safe to run during maintenance."""
    from src.ledger.service import run_and_record
    try:
        async with SessionLocal() as db:
            await run_and_record(db, trigger="schedule")
    except Exception as e:  # noqa: BLE001
        logger.error("ledger_reconcile_failed", error=str(e))


UPSTREAM_REVOKE_MAX_ATTEMPTS = 10
UPSTREAM_REVOKE_MAX_BACKOFF_MINUTES = 60


async def upstream_revocation_job() -> None:
    """Gửi các lệnh partner-dispute đã xếp trong outbox `upstream_revocations`
    (hoàn tiền dispute, huỷ đơn quá hạn provision, DProxy giao sai).

    Mỗi dòng một transaction ngắn, lock SKIP LOCKED — nhiều worker cùng chạy
    không gửi trùng. Kết quả:
    - revoked / not_found → done (not_found = DProxy không có đơn, ví dụ lệnh
      mua chưa từng tới được họ);
    - rejected (4xx) → failed + alert critical ngay, admin đối soát tay;
    - lỗi mạng/5xx/auth → thử lại với backoff lũy thừa, quá
      UPSTREAM_REVOKE_MAX_ATTEMPTS → failed + alert critical.
    """
    from src.adapters.dproxy import DProxyAdapter
    from src.adapters.factory import get_binding_adapter
    from src.models.proxy_allocation import UpstreamRevocation, UpstreamRevocationStatus

    async with SessionLocal() as db:
        now = datetime.now(timezone.utc)
        ids = list((await db.execute(
            select(UpstreamRevocation.id).where(
                UpstreamRevocation.status == UpstreamRevocationStatus.pending.value,
                UpstreamRevocation.next_attempt_at <= now,
            ).order_by(UpstreamRevocation.id).limit(50)
        )).scalars().all())

    for row_id in ids:
        async with SessionLocal() as db:
            row = await db.scalar(
                select(UpstreamRevocation).where(
                    UpstreamRevocation.id == row_id,
                    UpstreamRevocation.status == UpstreamRevocationStatus.pending.value,
                ).with_for_update(skip_locked=True)
            )
            if row is None:
                continue
            row.attempts += 1
            outcome: str | None = None
            error: str | None = None
            try:
                adapter = await get_binding_adapter(row.provider_id, db)
                if not isinstance(adapter, DProxyAdapter):
                    raise ValueError(f"provider {row.provider_id} không phải DProxy")
                outcome = await adapter.dispute_purchase(row.partner_order_id, reason=row.reason)
            except Exception as e:  # noqa: BLE001 — mọi lỗi đều là "thử lại sau"
                error = f"{type(e).__name__}: {e}"[:255]

            now = datetime.now(timezone.utc)
            row.outcome = outcome or "error"
            row.last_error = error
            failed_message: str | None = None
            if outcome in ("revoked", "not_found"):
                row.status = UpstreamRevocationStatus.done.value
                row.done_at = now
                if outcome == "not_found":
                    logger.warning("upstream_revocation_not_found", order_id=row.order_id,
                                   partner_order_id=row.partner_order_id, reason=row.reason)
            elif outcome == "rejected":
                row.status = UpstreamRevocationStatus.failed.value
                failed_message = "DProxy từ chối partner-dispute"
            elif row.attempts >= UPSTREAM_REVOKE_MAX_ATTEMPTS:
                row.status = UpstreamRevocationStatus.failed.value
                failed_message = f"hết {row.attempts} lần thử ({error})"
            else:
                backoff = min(2 ** row.attempts, UPSTREAM_REVOKE_MAX_BACKOFF_MINUTES)
                row.next_attempt_at = now + timedelta(minutes=backoff)

            if failed_message:
                await upsert_incident(
                    db,
                    # One incident per revoked line: an order of several proxies
                    # revokes each line under its own partner_order_id.
                    fingerprint=fp_order(row.order_id, f"upstream_revoke_failed:{row.partner_order_id}"),
                    type_="upstream_revoke_failed",
                    severity="critical",
                    target_type="order",
                    target_id=row.order_id,
                    message=(
                        f"Đơn #{row.order_id}: KHÔNG thu hồi được proxy ở DProxy ({failed_message}). "
                        f"Buyer đã được hoàn tiền — dispute tay partner_order_id={row.partner_order_id} "
                        f"và kiểm tra credit-summary."
                    ),
                )
            await db.commit()
            logger.info("upstream_revocation_attempt", revocation_id=row_id, outcome=row.outcome,
                        status=row.status, attempts=row.attempts)


DPROXY_DEFAULT_LOW_CREDIT_USD = 10.0


async def dproxy_credit_check_job() -> None:
    """Theo dõi hạn mức trả sau của từng tài khoản DProxy (credit-summary).

    - `available_spending_usd` <= 0 hoặc `is_credit_active` = false → không
      lệnh mua nào thành công được nữa: tắt provider + alert critical
      (report_out_of_credit), giống TopProxy hết Xu.
    - dưới `config.low_credit_usd` (mặc định 10 USD) → alert warning để nạp /
      thanh toán công nợ trước khi chạm đáy.
    Provider đang tắt vẫn được kiểm để admin thấy số liệu khi quyết định bật lại.
    """
    from src.adapters.dproxy import DProxyAdapter
    from src.adapters.factory import get_binding_adapter
    from src.providers.credit import ALERT_LOW_CREDIT, report_out_of_credit

    async with SessionLocal() as db:
        providers = list((await db.execute(
            select(Provider).where(Provider.adapter_type == "dproxy")
        )).scalars().all())
        for provider in providers:
            try:
                adapter = await get_binding_adapter(provider.id, db)
                if not isinstance(adapter, DProxyAdapter):
                    continue
                credit = await adapter.credit_summary()
            except Exception as e:  # noqa: BLE001 — health/reconciliation báo lỗi kết nối
                logger.info("dproxy_credit_check_skipped", provider_id=provider.id, error=str(e))
                continue
            available = credit["available_spending_usd"]
            try:
                threshold = float((provider.config or {}).get("low_credit_usd") or DPROXY_DEFAULT_LOW_CREDIT_USD)
            except (TypeError, ValueError):
                threshold = DPROXY_DEFAULT_LOW_CREDIT_USD
            if provider.is_active and (available <= 0 or not credit["is_credit_active"]):
                await report_out_of_credit(provider.id, db)
                continue
            if available < threshold:
                await upsert_incident(
                    db,
                    fingerprint=fp_provider(provider.id, ALERT_LOW_CREDIT),
                    type_=ALERT_LOW_CREDIT,
                    severity="warning",
                    target_type="provider",
                    target_id=provider.id,
                    message=(
                        f"Nhà cung cấp {provider.name}: hạn mức DProxy còn {available:.2f} USD "
                        f"(ngưỡng {threshold:.2f} USD, công nợ {credit.get('current_debt_usd') or 0:.2f} USD) — "
                        f"thanh toán công nợ / nâng hạn mức trước khi hết."
                    ),
                )
                await db.commit()
