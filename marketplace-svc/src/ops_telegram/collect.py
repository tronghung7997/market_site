"""Turn rows the marketplace already writes into ops outbox messages.

Sources, each walked by an id cursor on ``ops_telegram_config``:

- ``alerts``: disputes opened / sent to the marketplace / refunded because
  the seller timed out, deposit anomalies (FX drift, amount mismatch, late or
  double payment…), and every operator-facing system alert (supplier
  failures and breaker, out-of-stock suppliers, provider credit, ledger
  mismatch, stuck provisioning…). Alerts addressed to a buyer's or seller's
  own inbox are theirs (the seller bot sends those), not the operators'.
- ``log_entries`` (the audit log): new withdrawal requests, seller
  applications (new or answered), maintenance/kill-switch flips.
- ``sepay_webhook_events``: incoming transfers nothing credited (the admin
  "unmatched" queue), once they are ``SETTLE`` old.
- Products: the first time a product is public it is queued for the channel,
  at most one post per ``channel_interval_minutes``.

Ids are allocated before commit, so a row can appear after a higher id was
seen. A cursor only passes rows older than ``SETTLE``; rows above it are
looked at again on the next tick and the outbox ``dedupe_key`` keeps them from
being queued twice. Every write here happens in the dispatcher's transaction
together with the cursor move.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import structlog
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.alerts.admin_view import USER_NOTIFICATION_TYPES, USER_TARGETS
from src.alerts.service import fp_deposit
from src.i18n.slug import canonical_path
from src.mail.runtime import load_runtime
from src.mail.service import frontend_url
from src.models.account import Account, SellerApplication
from src.models.alert import Alert
from src.models.category import Category
from src.models.log_entry import LogEntry
from src.models.ops_telegram import OpsTelegramConfig, OpsTelegramListedProduct
from src.models.order import Dispute, Order
from src.models.product import Product, ProductStatus, ProductVariant
from src.models.wallet import WithdrawRequest
from src.payments.service import unmatched_transfers_after

from . import texts
from .service import PAUSED_ALERT_TYPE, account_emails, add_outbox, enabled_events, masked_account

logger = structlog.get_logger()

SETTLE = timedelta(minutes=5)
BATCH = 100
CHANNEL_PRODUCTS_PER_POST = 10

# Notices for an end user's own inbox, never for operators.
_NOT_FOR_OPS = set(USER_NOTIFICATION_TYPES) | {
    "seller_application_needs_info", "product_question_answered", "seller_tier_changed", PAUSED_ALERT_TYPE,
}
_DISPUTE_OPEN = {"dispute_opened": "Khiếu nại mới", "dispute_marketplace_review": "Khiếu nại chuyển sàn xử lý"}
_UNMATCHED_FP = fp_deposit(0, "unmatched_transfer")
_LEVEL_OF_SEVERITY = {"critical": "urgent", "error": "urgent", "warning": "action"}
_LOG_EVENTS = {
    "withdraw_requested": "withdrawal_requested",
    "seller_application_submitted": "seller_application",
    "seller_application_resubmitted": "seller_application",
    "site_runtime_config_changed": "site_switch",
}


def alert_event(type_: str, target_type: str, fingerprint: str | None) -> str | None:
    """Which ops switch an alert belongs to (None = not for the ops group)."""
    if type_ in _NOT_FOR_OPS or target_type in USER_TARGETS:
        return None
    if type_ in _DISPUTE_OPEN:
        return "dispute_opened"
    if type_ == "dispute_seller_timeout":
        return "dispute_timeout"
    if type_ == "deposit_anomaly":
        # Each unmatched transfer comes from the SePay journal instead.
        return None if fingerprint == _UNMATCHED_FP else "deposit_anomaly"
    return "system_alert"


def _advance(cursor: int, floor: int, last_seen: int | None, full: bool) -> int:
    """Past every settled row, never past rows not examined yet."""
    target = floor
    if full and last_seen is not None:
        target = min(target, last_seen)
    return max(cursor, target)


async def _floor(db: AsyncSession, id_col, created_col, settled: datetime) -> int:
    # Backward walk of the primary key, stopping at the first settled row.
    return int(await db.scalar(select(func.coalesce(func.max(id_col), 0)).where(created_col < settled)) or 0)


# ── alerts ──────────────────────────────────────────────────────────────────

async def _collect_alerts(db: AsyncSession, cfg: OpsTelegramConfig, events: dict, settled: datetime) -> int:
    rows = list((await db.scalars(
        select(Alert).where(Alert.id > cfg.last_alert_id).order_by(Alert.id).limit(BATCH)
    )).all())
    wanted = [(a, ev) for a in rows if (ev := alert_event(a.type, a.target_type, a.fingerprint)) and events[ev]]
    order_ids = {a.target_id for a, _ in wanted if a.target_type == "order"}
    codes = dict((await db.execute(select(Order.id, Order.order_code).where(Order.id.in_(order_ids)))).all()) \
        if order_ids else {}
    disputes: dict[int, int] = {}
    if order_ids:
        for order_id, dispute_id in (await db.execute(
            select(Dispute.order_id, func.max(Dispute.id)).where(Dispute.order_id.in_(order_ids))
            .group_by(Dispute.order_id)
        )).all():
            disputes[order_id] = dispute_id
    queued = 0
    for alert, event in wanted:
        code = codes.get(alert.target_id) if alert.target_type == "order" else None
        if event in {"dispute_opened", "dispute_timeout"}:
            dispute_id = disputes.get(alert.target_id)
            link = alert.href if (alert.href or "").startswith("/admin/disputes") else (
                f"/admin/disputes?dispute={dispute_id}" if dispute_id else "/admin/disputes"
            )
            title = _DISPUTE_OPEN.get(alert.type) or "Khiếu nại tự hoàn tiền: người bán quá hạn phản hồi"
            level, low = "action", False
        else:
            link = alert.href if (alert.href or "").startswith("/admin") else "/admin/alerts"
            label = texts.ALERT_TYPE_LABEL.get(alert.type, alert.type)
            title = label if event == "deposit_anomaly" else f"Cảnh báo hệ thống · {label}"
            level = _LEVEL_OF_SEVERITY.get(alert.severity, "info")
            low = level == "info" or (event == "system_alert" and alert.severity == "warning")
        queued += await add_outbox(
            db, target="ops", kind=event, level=level, title=title,
            body_html=texts.body(alert.message, f"Mã đơn: {code}" if code else ""),
            link=link, dedupe_key=f"alert:{alert.id}", low_priority=low,
        )
    floor = await _floor(db, Alert.id, Alert.created_at, settled)
    cfg.last_alert_id = _advance(cfg.last_alert_id, floor, rows[-1].id if rows else None, len(rows) == BATCH)
    return queued


# ── audit log ───────────────────────────────────────────────────────────────

def _switch_changes(changed) -> list[tuple[str, bool]]:
    out = []
    for key in texts.SWITCH_LABEL:
        pair = (changed or {}).get(key)
        if isinstance(pair, (list, tuple)) and len(pair) == 2 and bool(pair[0]) != bool(pair[1]):
            out.append((key, bool(pair[1])))
    return out


async def _collect_log(db: AsyncSession, cfg: OpsTelegramConfig, events: dict, settled: datetime) -> int:
    event_col = LogEntry.metadata_["event"].as_string()
    rows = (await db.execute(
        select(LogEntry.id, LogEntry.metadata_).where(LogEntry.id > cfg.last_log_id, event_col.in_(list(_LOG_EVENTS)))
        .order_by(LogEntry.id).limit(BATCH)
    )).all()
    wanted = [(row_id, meta or {}) for row_id, meta in rows if events[_LOG_EVENTS[(meta or {}).get("event")]]]

    withdraw_ids = {int(m["withdraw_id"]) for _, m in wanted if m.get("event") == "withdraw_requested" and m.get("withdraw_id")}
    withdrawals = {w.id: w for w in (await db.scalars(
        select(WithdrawRequest).where(WithdrawRequest.id.in_(withdraw_ids))
    )).all()} if withdraw_ids else {}
    app_ids = {int(m["application_id"]) for _, m in wanted if m.get("application_id")}
    applications = {a.id: a for a in (await db.scalars(
        select(SellerApplication).where(SellerApplication.id.in_(app_ids))
    )).all()} if app_ids else {}
    people = {int(m["actor_id"]) for _, m in wanted if m.get("actor_id")}
    people |= {w.account_id for w in withdrawals.values()}
    people |= {a.account_id for a in applications.values()}
    emails = await account_emails(db, people)

    queued = 0
    for row_id, meta in wanted:
        event = meta.get("event")
        key = f"log:{row_id}"
        if event == "withdraw_requested":
            w = withdrawals.get(int(meta.get("withdraw_id") or 0))
            if w is None:
                continue
            net = w.net_amount if w.net_amount is not None else w.amount - (w.fee_amount or 0)
            bank = " ".join(p for p in (w.bank_name or "", texts.mask_tail(w.bank_account_number)) if p)
            queued += await add_outbox(
                db, target="ops", kind="withdrawal_requested", level="action",
                title=f"Yêu cầu rút tiền mới · {texts.money(w.amount)}",
                body_html=texts.body(
                    f"Thực chuyển: {texts.money(net)} (phí {texts.money(w.fee_amount)})",
                    f"Người rút: {masked_account(emails.get(w.account_id), w.account_id)}",
                    "Nguồn: Hoa hồng affiliate" if w.source == "affiliate_commission" else "",
                    f"Nhận tại: {bank}" if bank else "",
                ),
                link="/admin/withdrawals?status=pending", dedupe_key=key,
            )
        elif event == "site_runtime_config_changed":
            flips = _switch_changes(meta.get("changed"))
            if not flips:
                continue
            on = any(value for _, value in flips)
            actor = int(meta.get("actor_id") or 0)
            queued += await add_outbox(
                db, target="ops", kind="site_switch", level="urgent" if on else "action",
                title="Công tắc hệ thống vừa đổi",
                body_html=texts.body(
                    *(f"{texts.SWITCH_LABEL[k]}: {'BẬT' if v else 'TẮT'}" for k, v in flips),
                    f"Người đổi: {emails.get(actor, '')} (#{actor})" if actor else "",
                ),
                link="/admin/display-settings?tab=system", dedupe_key=key,
            )
        else:
            app = applications.get(int(meta.get("application_id") or 0))
            if app is None:
                continue
            again = event == "seller_application_resubmitted"
            queued += await add_outbox(
                db, target="ops", kind="seller_application", level="action",
                title="Hồ sơ người bán bổ sung, chờ duyệt lại" if again else "Đăng ký người bán mới chờ duyệt",
                body_html=texts.body(
                    f"Shop: {app.business_name}",
                    f"Tài khoản: {masked_account(emails.get(app.account_id), app.account_id)}",
                ),
                link="/admin/seller-applications", dedupe_key=key, low_priority=True,
            )
    floor = await _floor(db, LogEntry.id, LogEntry.created_at, settled)
    cfg.last_log_id = _advance(cfg.last_log_id, floor, rows[-1][0] if rows else None, len(rows) == BATCH)
    return queued


# ── SePay journal ───────────────────────────────────────────────────────────

async def _collect_unmatched(db: AsyncSession, cfg: OpsTelegramConfig, events: dict, settled: datetime) -> int:
    transfers, last = await unmatched_transfers_after(
        db, after_id=cfg.last_sepay_event_id, received_before=settled, limit=BATCH,
    )
    queued = 0
    if events["deposit_unmatched"]:
        for item in transfers:
            queued += await add_outbox(
                db, target="ops", kind="deposit_unmatched", level="action",
                title=f"Tiền vào chưa khớp lệnh nạp · {texts.money(item['amount'])}",
                body_html=texts.body(
                    f"Mã nạp: {item['payment_code']}" if item.get("payment_code") else "Không có mã nạp hợp lệ",
                    f"Tham chiếu ngân hàng: {item['reference']}" if item.get("reference") else "",
                    f"Nhận lúc: {texts.when(item['received_at'])}",
                ),
                link="/admin/deposits", dedupe_key=f"sepay:{item['id']}",
            )
    cfg.last_sepay_event_id = max(cfg.last_sepay_event_id, last)
    return queued


# ── channel ─────────────────────────────────────────────────────────────────

def public_products_not_listed():
    """Public catalogue products (active, shop not a seeded test account,
    not hidden by an admin) that were never posted nor baselined."""
    return select(Product.id).where(
        Product.status == ProductStatus.active,
        Product.admin_hidden.is_(False),
        ~exists().where(Account.id == Product.seller_id, Account.is_seeded.is_(True)),
        ~exists().where(OpsTelegramListedProduct.product_id == Product.id),
    )


async def _collect_channel(db: AsyncSession, cfg: OpsTelegramConfig, now: datetime) -> int:
    if not (cfg.channel_enabled and cfg.channel_chat_id):
        return 0
    interval = timedelta(minutes=int(cfg.channel_interval_minutes or 30))
    if cfg.channel_last_post_at and now - cfg.channel_last_post_at < interval:
        return 0
    ids = list((await db.scalars(
        public_products_not_listed().order_by(Product.id).limit(CHANNEL_PRODUCTS_PER_POST)
    )).all())
    if not ids:
        return 0
    min_price = (
        select(ProductVariant.product_id, func.min(ProductVariant.price).label("price"))
        .where(ProductVariant.product_id.in_(ids), ProductVariant.is_active.is_(True), ProductVariant.price > 0)
        .group_by(ProductVariant.product_id).subquery()
    )
    rows = (await db.execute(
        select(Product.id, Product.title, Product.slug, Product.public_key, Product.i18n, Category.name,
               min_price.c.price)
        .join(Category, Category.id == Product.category_id)
        .outerjoin(min_price, min_price.c.product_id == Product.id)
        .where(Product.id.in_(ids)).order_by(Product.id)
    )).all()
    lines = []
    links = []
    for _, title, slug, key, i18n, category, price in rows:
        name = ((i18n or {}).get("vi") or {}).get("title") or title
        url = frontend_url("vi", canonical_path("/products", slug, key))
        links.append(url)
        detail = " · ".join(p for p in (category, f"giá từ {texts.money(price)}" if price else "") if p)
        lines.append(f'• <a href="{texts.esc(url)}">{texts.esc(texts.clip(name, 120))}</a>'
                     + (f" — {texts.esc(detail)}" if detail else ""))
    brand = (await load_runtime(db)).mail_from_name
    single = len(rows) == 1
    queued = await add_outbox(
        db, target="channel", kind="product_listed", level="info",
        title=f"Sản phẩm mới trên {brand}" if not single else f"Mới lên {brand}",
        body_html="\n".join(lines), link=links[0] if single else None,
        dedupe_key=f"products:{ids[0]}-{ids[-1]}:{len(ids)}",
    )
    for product_id in ids:
        db.add(OpsTelegramListedProduct(product_id=product_id, announced=True))
    cfg.channel_last_post_at = now
    return queued


async def _isolated(db: AsyncSession, source: str, run) -> int:
    """Run one source in a savepoint: a row it cannot read costs that source
    this tick (logged, retried next tick), never the other sources or the
    delivery of what is already queued."""
    try:
        async with db.begin_nested():
            return await run()
    except Exception:  # noqa: BLE001 - one bad source must not stop the bot
        logger.exception("ops_telegram_collect_failed", source=source)
        return 0


async def collect(db: AsyncSession, cfg: OpsTelegramConfig, now: datetime) -> int:
    """Queue everything new for this tick; the caller commits."""
    events = enabled_events(cfg)
    settled = now - SETTLE
    queued = 0
    if cfg.ops_chat_id:
        queued += await _isolated(db, "alerts", lambda: _collect_alerts(db, cfg, events, settled))
        queued += await _isolated(db, "log", lambda: _collect_log(db, cfg, events, settled))
        queued += await _isolated(db, "unmatched", lambda: _collect_unmatched(db, cfg, events, settled))
    queued += await _isolated(db, "channel", lambda: _collect_channel(db, cfg, now))
    return queued
