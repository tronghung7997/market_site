from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.compatibility import setup_status
from src.alerts.service import list_active_alerts, list_seller_alerts
from src.disputes.service import list_seller_open_disputes
from src.models.account import ApplicationStatus, SellerApplication
from src.models.alert import Alert
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.product import Product
from src.models.provider import Provider
from src.models.service_task import ServiceTask, ServiceTaskStatus
from src.models.usage import OrderBalance
from src.models.wallet import WithdrawRequest, WithdrawStatus
from src.pricing.engine import resolve_pricing
from src.products.service import get_seller_stats
from src.wallet.service import list_withdrawals_for_account

from .schemas import ActionItem

_LOW_BALANCE_RATIO = 0.8
_ESCROW_SOON_HOURS = 24

_ALERT_HREF = {
    "sla_breach": "/seller/orders",
    "resource_low": "/seller/inventory",
    "resource_error": "/seller/inventory",
    "provider_down": "/admin/providers",
    "provision_stuck": "/admin/orders",
    "dispute_opened": "/admin/disputes",
}


def _alert_item(alert: Alert, href: str) -> ActionItem:
    return ActionItem(
        key=f"alert_{alert.id}", severity=alert.severity, label=alert.message,
        count=1, href=href, dismissible=True, alert_id=alert.id,
    )


async def buyer_action_items(buyer_id: int, db: AsyncSession) -> list[ActionItem]:
    items: list[ActionItem] = []

    delivered = (await db.execute(
        select(Order.escrow_expires_at).where(Order.buyer_id == buyer_id, Order.status == OrderStatus.delivered)
    )).scalars().all()
    if delivered:
        items.append(ActionItem(
            key="buyer_delivered_unconfirmed", severity="warning",
            label=f"{len(delivered)} đơn cần bạn xác nhận đã nhận hàng",
            count=len(delivered), href="/orders?status=delivered",
        ))
        soon_cutoff = datetime.now(timezone.utc) + timedelta(hours=_ESCROW_SOON_HOURS)
        soon = [e for e in delivered if e and e <= soon_cutoff]
        if soon:
            items.append(ActionItem(
                key="buyer_escrow_expiring", severity="critical",
                label=f"{len(soon)} đơn sắp hết hạn xác nhận trong {_ESCROW_SOON_HOURS} giờ",
                count=len(soon), href="/orders?status=delivered",
            ))

    low_balance = await db.scalar(
        select(func.count(OrderBalance.id)).select_from(OrderBalance)
        .join(Order, Order.id == OrderBalance.order_id)
        .where(Order.buyer_id == buyer_id, OrderBalance.units_used >= OrderBalance.units_total * _LOW_BALANCE_RATIO)
    ) or 0
    if low_balance:
        items.append(ActionItem(
            key="buyer_low_balance", severity="warning",
            label=f"{low_balance} đơn sắp hết hạn mức sử dụng",
            count=low_balance, href="/orders",
        ))

    seller_responded = await db.scalar(
        select(func.count(Dispute.id)).select_from(Dispute)
        .where(Dispute.buyer_id == buyer_id, Dispute.status == DisputeStatus.open, Dispute.seller_note.is_not(None))
    ) or 0
    if seller_responded:
        items.append(ActionItem(
            key="buyer_dispute_seller_responded", severity="info",
            label=f"{seller_responded} khiếu nại vừa có phản hồi từ người bán, đang chờ admin xử lý",
            count=seller_responded, href="/orders?status=disputed",
        ))

    return items


async def _seller_needs_setup_count(seller_id: int, db: AsyncSession) -> int:
    products = (await db.execute(select(Product).where(Product.seller_id == seller_id))).scalars().all()
    count = 0
    for product in products:
        provider = await db.get(Provider, product.provider_id) if product.provider_id else None
        strategy_name, _ = await resolve_pricing(product, db)
        setup = setup_status(
            provider.adapter_type if provider else None, strategy_name,
            provider_active=provider.is_active if provider else True,
        )
        if setup["needs_setup"]:
            count += 1
    return count


async def seller_action_items(seller_id: int, db: AsyncSession) -> list[ActionItem]:
    items: list[ActionItem] = []

    stats = await get_seller_stats(seller_id, db)
    if stats["pending_orders"]:
        items.append(ActionItem(
            key="seller_pending_orders", severity="warning",
            label=f"{stats['pending_orders']} đơn hàng mới cần xác nhận",
            count=stats["pending_orders"], href="/seller/orders",
        ))

    open_disputes = await list_seller_open_disputes(seller_id, db)
    if open_disputes:
        items.append(ActionItem(
            key="seller_open_disputes", severity="critical",
            label=f"{len(open_disputes)} khiếu nại cần bạn phản hồi",
            count=len(open_disputes), href="/seller/orders",
        ))

    for alert in await list_seller_alerts(seller_id, db):
        items.append(_alert_item(alert, _ALERT_HREF.get(alert.type, "/seller")))

    needs_setup = await _seller_needs_setup_count(seller_id, db)
    if needs_setup:
        items.append(ActionItem(
            key="seller_needs_setup", severity="warning",
            label=f"{needs_setup} sản phẩm chưa cấu hình xong",
            count=needs_setup, href="/seller/products",
        ))

    withdrawals = await list_withdrawals_for_account(seller_id, db)
    rejected = [w for w in withdrawals if w["status"] == WithdrawStatus.rejected]
    if rejected:
        items.append(ActionItem(
            key="seller_withdrawals_rejected", severity="warning",
            label=f"{len(rejected)} yêu cầu rút tiền bị từ chối — cần sửa và gửi lại",
            count=len(rejected), href="/seller/withdrawals",
        ))

    return items


async def admin_action_items(db: AsyncSession) -> list[ActionItem]:
    # Chỉ cần ĐẾM — không đi qua các list_*() vì chúng enrich từng row
    # (N+1) cho nhu cầu hiển thị chi tiết mà ở đây không dùng đến.
    items: list[ActionItem] = []

    pending_apps = await db.scalar(
        select(func.count(SellerApplication.id))
        .where(SellerApplication.status == ApplicationStatus.pending)
    ) or 0
    if pending_apps:
        items.append(ActionItem(
            key="admin_pending_applications", severity="warning",
            label=f"{pending_apps} đơn đăng ký bán chờ duyệt",
            count=pending_apps, href="/admin/seller-applications",
        ))

    open_disputes = await db.scalar(
        select(func.count(Dispute.id)).where(Dispute.status == DisputeStatus.open)
    ) or 0
    if open_disputes:
        items.append(ActionItem(
            key="admin_open_disputes", severity="critical",
            label=f"{open_disputes} khiếu nại đang mở",
            count=open_disputes, href="/admin/disputes",
        ))

    pending_withdrawals = await db.scalar(
        select(func.count(WithdrawRequest.id))
        .where(WithdrawRequest.status == WithdrawStatus.pending)
    ) or 0
    if pending_withdrawals:
        items.append(ActionItem(
            key="admin_pending_withdrawals", severity="warning",
            label=f"{pending_withdrawals} yêu cầu rút tiền chờ duyệt",
            count=pending_withdrawals, href="/admin/withdrawals",
        ))

    pending_tasks = await db.scalar(
        select(func.count(ServiceTask.id))
        .where(ServiceTask.status == ServiceTaskStatus.pending)
    ) or 0
    if pending_tasks:
        items.append(ActionItem(
            key="admin_pending_tasks", severity="warning",
            label=f"{pending_tasks} tác vụ chờ xử lý",
            count=pending_tasks, href="/admin/tasks",
        ))

    for alert in await list_active_alerts(db):
        items.append(_alert_item(alert, _ALERT_HREF.get(alert.type, "/admin/alerts")))

    return items
