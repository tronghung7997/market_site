from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.compatibility import setup_status
from src.alerts.admin_view import admin_alert_links, list_admin_open_alerts
from src.alerts.service import list_buyer_alerts, list_seller_alerts
from src.chat.enums import ContextRole
from src.chat.service import helpdesk_waiting_count, unread_message_count
from src.disputes.service import count_seller_open_disputes
from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.alert import Alert
from src.models.config_change_request import ConfigChangeRequest
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.product import Product
from src.models.review import Review
from src.models.provider import Provider
from src.models.service_task import ServiceTask, ServiceTaskStatus
from src.models.usage import OrderBalance
from src.models.wallet import WithdrawRequest, WithdrawStatus
from src.models.pricing_config import PricingConfig
from src.pricing.engine import product_pricing_override
from src.questions.service import seller_pending_count as seller_pending_question_count

from .schemas import ActionItem

_LOW_BALANCE_RATIO = 0.8
_ESCROW_SOON_HOURS = 24

_ALERT_HREF = {
    "sla_breach": "/seller/orders",
    "resource_low": "/seller/inventory",
    "resource_error": "/seller/inventory",
    "provider_out_of_credit": "/seller/providers",
    "provider_down": "/admin/providers",
    "provision_stuck": "/admin/orders",
    "dispute_opened": "/admin/disputes",
    "dispute_marketplace_review": "/admin/support",
    "seller_application_approved": "/seller",
}

# Stable keys so the frontend can i18n known inbox alerts; others stay alert_{id}.
_INBOX_ALERT_KEYS = {
    "seller_application_approved": "seller_application_approved",
    "seller_application_needs_info": "seller_application_needs_info",
}

# Seller-only inbox facts that must not appear in the admin bell.
def _alert_item(alert: Alert, href: str) -> ActionItem:
    return ActionItem(
        key=_INBOX_ALERT_KEYS.get(alert.type, f"alert_{alert.id}"),
        severity=alert.severity, label=alert.message,
        count=1, href=alert.href or href, dismissible=True, alert_id=alert.id,
    )


async def buyer_action_items(buyer_id: int, db: AsyncSession) -> list[ActionItem]:
    items: list[ActionItem] = []

    delivered = (await db.execute(
        select(Order.escrow_expires_at).where(Order.buyer_id == buyer_id, Order.status == OrderStatus.delivered)
    )).scalars().all()
    if delivered:
        # Two disjoint groups, so one order is never counted twice in the bell:
        # the ones about to auto-complete, then the rest still awaiting a check.
        soon_cutoff = datetime.now(timezone.utc) + timedelta(hours=_ESCROW_SOON_HOURS)
        soon = [e for e in delivered if e and e <= soon_cutoff]
        if soon:
            items.append(ActionItem(
                key="buyer_escrow_expiring", severity="critical",
                label=f"{len(soon)} đơn sắp hết hạn xác nhận trong {_ESCROW_SOON_HOURS} giờ",
                count=len(soon), href="/orders?status=delivered",
            ))
        rest = len(delivered) - len(soon)
        if rest:
            items.append(ActionItem(
                key="buyer_delivered_unconfirmed", severity="warning",
                label=f"{rest} đơn cần bạn xác nhận đã nhận hàng",
                count=rest, href="/orders?status=delivered",
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
            count=low_balance, href="/orders?status=active",
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

    unread = await unread_message_count(buyer_id, ContextRole.BUYER, db)
    if unread:
        items.append(ActionItem(
            key="unread_messages", severity="info",
            label=f"{unread} tin nhắn chưa đọc",
            count=unread, href="/messages",
        ))

    for alert in await list_buyer_alerts(buyer_id, db):
        items.append(_alert_item(alert, "/orders"))

    return items


async def _seller_needs_setup_count(seller_id: int, db: AsyncSession) -> int:
    """Same verdict as the product editor (setup_status), in three queries:
    only the strategy name matters here, so the shop-wide pricing configs are
    read once instead of resolving each product's full pricing."""
    rows = (await db.execute(
        select(Product, Provider).outerjoin(Provider, Provider.id == Product.provider_id)
        .where(Product.seller_id == seller_id)
    )).all()
    configs: dict[str, str] = {}
    for config in (await db.execute(
        select(PricingConfig).where(PricingConfig.is_active == True).order_by(PricingConfig.id)  # noqa: E712
    )).scalars():
        configs.setdefault(config.service_type, config.strategy)
    count = 0
    for product, provider in rows:
        override = product_pricing_override(product)
        strategy_name = override[0] if override is not None else configs.get(product.service_type or "other", "fixed")
        setup = setup_status(
            provider.adapter_type if provider else None, strategy_name,
            provider_active=provider.is_active if provider else True,
        )
        if setup["needs_setup"]:
            count += 1
    return count


_REVIEW_REPLY_DAYS = 30


async def _seller_unreplied_reviews(seller_id: int, db: AsyncSession) -> list[tuple[str, int]]:
    """``[(product public key, count)]`` of recent written reviews from real
    buyers the seller has not answered yet."""
    since = datetime.now(timezone.utc) - timedelta(days=_REVIEW_REPLY_DAYS)
    rows = (await db.execute(
        select(Product.public_key, func.count(Review.id))
        .join(Product, Product.id == Review.product_id)
        .where(
            Product.seller_id == seller_id,
            Review.seller_reply.is_(None),
            Review.comment.is_not(None), Review.comment != "",
            Review.is_hidden.is_(False), Review.is_auto.is_(False), Review.is_seeded.is_(False),
            Review.created_at >= since,
        )
        .group_by(Product.public_key)
        .order_by(func.count(Review.id).desc())
    )).all()
    return [(key, int(count)) for key, count in rows]


async def seller_action_items(seller_id: int, db: AsyncSession) -> list[ActionItem]:
    items: list[ActionItem] = []

    # Only the pending count is shown here: get_seller_stats runs five.
    pending_orders = int(await db.scalar(select(func.count(Order.id)).where(
        Order.seller_id == seller_id, Order.is_seeded.is_(False), Order.status == OrderStatus.pending,
    )) or 0)
    if pending_orders:
        items.append(ActionItem(
            key="seller_pending_orders", severity="warning",
            label=f"{pending_orders} orders need confirmation",
            count=pending_orders, href="/seller/orders?tab=action_required",
        ))

    open_disputes = await count_seller_open_disputes(seller_id, db)
    if open_disputes:
        items.append(ActionItem(
            key="seller_open_disputes", severity="critical",
            label=f"{open_disputes} disputes need your response",
            count=open_disputes, href="/seller/orders?tab=disputed",
        ))

    for alert in await list_seller_alerts(seller_id, db):
        items.append(_alert_item(alert, _ALERT_HREF.get(alert.type, "/seller")))

    unanswered = await seller_pending_question_count(seller_id, db)
    if unanswered:
        items.append(ActionItem(
            key="seller_unanswered_questions", severity="info",
            label=f"{unanswered} buyer questions waiting for an answer",
            count=unanswered, href="/seller/questions",
        ))

    unreplied = await _seller_unreplied_reviews(seller_id, db)
    if unreplied:
        total = sum(count for _, count in unreplied)
        href = f"/seller/products/{unreplied[0][0]}?tab=reviews" if len(unreplied) == 1 else "/seller/products"
        items.append(ActionItem(
            key="seller_unreplied_reviews", severity="info",
            label=f"{total} đánh giá chưa được trả lời",
            count=total, href=href,
        ))

    needs_setup = await _seller_needs_setup_count(seller_id, db)
    if needs_setup:
        items.append(ActionItem(
            key="seller_needs_setup", severity="warning",
            label=f"{needs_setup} products are not fully configured",
            count=needs_setup, href="/seller/products",
        ))

    rejected = int(await db.scalar(select(func.count(WithdrawRequest.id)).where(
        WithdrawRequest.account_id == seller_id, WithdrawRequest.status == WithdrawStatus.rejected,
    )) or 0)
    if rejected:
        items.append(ActionItem(
            key="seller_withdrawals_rejected", severity="warning",
            label=f"{rejected} withdrawal requests were rejected — fix and resubmit",
            count=rejected, href="/seller/withdrawals",
        ))

    unread = await unread_message_count(seller_id, ContextRole.SELLER, db)
    if unread:
        items.append(ActionItem(
            key="unread_messages", severity="info",
            label=f"{unread} tin nhắn chưa đọc",
            count=unread, href="/messages",
        ))

    return items


async def account_action_items(account: Account, db: AsyncSession) -> list[ActionItem]:
    """Buyer inbox plus seller inbox when the account has the seller role."""
    items = [item for item in await buyer_action_items(account.id, db) if item.key != "unread_messages"]
    if "seller" in (account.roles or []):
        items.extend(
            item for item in await seller_action_items(account.id, db) if item.key != "unread_messages"
        )
    unread = await unread_message_count(account.id, None, db)
    if unread:
        items.append(ActionItem(
            key="unread_messages", severity="info",
            label=f"{unread} tin nhắn chưa đọc",
            count=unread, href="/messages",
        ))
    return items


async def admin_action_items(db: AsyncSession) -> list[ActionItem]:
    # Chỉ cần ĐẾM — không đi qua các list_*() vì chúng enrich từng row
    # (N+1) cho nhu cầu hiển thị chi tiết mà ở đây không dùng đến.
    items: list[ActionItem] = []

    pending_apps, apps_since = (await db.execute(
        select(func.count(SellerApplication.id), func.min(SellerApplication.created_at))
        .where(SellerApplication.status == ApplicationStatus.pending)
    )).one()
    if pending_apps:
        items.append(ActionItem(
            key="admin_pending_applications", severity="warning",
            label=f"{pending_apps} seller applications awaiting review",
            count=pending_apps, href="/admin/seller-applications", since=apps_since,
        ))

    open_disputes, disputes_since = (await db.execute(
        select(func.count(Dispute.id), func.min(Dispute.created_at)).where(Dispute.status == DisputeStatus.open)
    )).one()
    if open_disputes:
        items.append(ActionItem(
            key="admin_open_disputes", severity="critical",
            label=f"{open_disputes} open disputes",
            count=open_disputes, href="/admin/disputes", since=disputes_since,
        ))

    marketplace_review = await db.scalar(
        select(func.count(Dispute.id)).where(
            Dispute.status == DisputeStatus.open,
            Dispute.review_requested_at.is_not(None),
        )
    ) or 0
    if marketplace_review:
        items.append(ActionItem(
            key="admin_marketplace_review", severity="warning",
            label=f"{marketplace_review} dispute chats waiting on Marketplace",
            count=marketplace_review, href="/admin/support",
        ))

    helpdesk_waiting = await helpdesk_waiting_count(db)
    if helpdesk_waiting:
        items.append(ActionItem(
            key="admin_helpdesk_waiting", severity="warning",
            label=f"{helpdesk_waiting} support chats waiting for a reply",
            count=helpdesk_waiting, href="/admin/support",
        ))

    pending_withdrawals, withdrawals_since = (await db.execute(
        select(func.count(WithdrawRequest.id), func.min(WithdrawRequest.created_at))
        .where(WithdrawRequest.status == WithdrawStatus.pending)
    )).one()
    if pending_withdrawals:
        items.append(ActionItem(
            key="admin_pending_withdrawals", severity="warning",
            label=f"{pending_withdrawals} withdrawal requests awaiting approval",
            count=pending_withdrawals, href="/admin/withdrawals", since=withdrawals_since,
        ))

    # Approved is not done: the money stays locked until an admin transfers it.
    to_pay, to_pay_since = (await db.execute(
        select(func.count(WithdrawRequest.id), func.min(WithdrawRequest.created_at))
        .where(WithdrawRequest.status == WithdrawStatus.approved)
    )).one()
    if to_pay:
        items.append(ActionItem(
            key="admin_withdrawals_to_pay", severity="warning",
            label=f"{to_pay} approved withdrawals awaiting transfer",
            count=to_pay, href="/admin/withdrawals?status=approved", since=to_pay_since,
        ))

    pending_tasks, tasks_since = (await db.execute(
        select(func.count(ServiceTask.id), func.min(ServiceTask.created_at))
        .where(ServiceTask.status == ServiceTaskStatus.pending)
    )).one()
    if pending_tasks:
        items.append(ActionItem(
            key="admin_pending_tasks", severity="warning",
            label=f"{pending_tasks} tasks awaiting processing",
            count=pending_tasks, href="/admin/tasks", since=tasks_since,
        ))

    # Settings changes waiting for a second admin (src/config_approval); the
    # requester sees their own too, so the count is the same for everyone.
    pending_changes, changes_since = (await db.execute(
        select(func.count(ConfigChangeRequest.id), func.min(ConfigChangeRequest.requested_at))
        .where(ConfigChangeRequest.status == "pending", ConfigChangeRequest.expires_at > func.now())
    )).one()
    if pending_changes:
        items.append(ActionItem(
            key="admin_config_changes_pending", severity="warning",
            label=f"{pending_changes} settings changes awaiting approval",
            count=pending_changes, href="/admin/config-changes", since=changes_since,
        ))

    open_alerts = await list_admin_open_alerts(db)
    links = await admin_alert_links(db, open_alerts)
    for alert in open_alerts:
        # Admin links point at the concrete record; the stored href is the
        # seller/buyer page and means nothing to an operator.
        items.append(ActionItem(
            key=_INBOX_ALERT_KEYS.get(alert.type, f"alert_{alert.id}"),
            severity=alert.severity, label=alert.message, count=1,
            href=links.get(alert.id) or "/admin/alerts", dismissible=True, alert_id=alert.id,
        ))

    return items
