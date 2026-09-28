"""Per-account notification history (the bell's "Thông báo" list).

A row is written inside the transaction that caused it, so it rolls back with
the domain change. The text is not stored: ``kind`` + ``params`` are rendered
by the client in the reader's language. Order status changes are captured by
the session hooks below, so every path that moves an order (buyer confirm,
seller delivery, scheduler, dispute outcome, admin case) notifies alike;
other events call ``src.notifications.history.notify`` explicitly.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, event, func, inspect, text, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Session, mapped_column

from src.database import Base
from src.models.order import Order, OrderStatus

NOTIFICATION_CATEGORIES = ("order", "wallet", "message", "system")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "category IN ('order', 'wallet', 'message', 'system')", name="ck_notifications_category",
        ),
        Index("ix_notifications_account_created", "account_id", "id"),
        # Unread rows that stand for a thread (one per chat): a new message
        # bumps the row instead of adding another.
        Index(
            "uq_notifications_unread_collapse", "account_id", "collapse_key",
            unique=True, postgresql_where=text("read_at IS NULL AND collapse_key IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    kind: Mapped[str] = mapped_column(String(48), nullable=False)
    # Public identifiers and amounts only (order code, payment code, shop name).
    params: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    href: Mapped[str | None] = mapped_column(String(300), nullable=True)
    collapse_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _status(value) -> str:
    return value.value if hasattr(value, "value") else str(value)


def order_notifications(order_code: str, buyer_id: int, seller_id: int, old: str | None, new: str) -> list[Notification]:
    """What an order status change tells the buyer and the seller. ``old`` is
    None for a new order."""
    buyer_href, seller_href = f"/orders/{order_code}", f"/seller/orders/{order_code}"
    params = {"order_code": order_code}
    rows: list[Notification] = []

    def add(account_id: int, kind: str, href: str, **extra) -> None:
        rows.append(Notification(account_id=account_id, category="order", kind=kind, params={**params, **extra}, href=href))

    if old is None:
        # An instant order arrives already delivered from stock: the seller
        # has nothing to hand over, only to know it sold.
        if new == OrderStatus.delivered.value:
            add(seller_id, "order_new", seller_href, auto=True)
        else:
            add(seller_id, "order_new", seller_href)
    if new == old:
        return rows
    if new == OrderStatus.delivered.value:
        add(buyer_id, "order_delivered", buyer_href)
    elif new == OrderStatus.completed.value and old is not None:
        add(seller_id, "order_completed", seller_href)
    elif new in {OrderStatus.cancelled.value, OrderStatus.refunded.value} and old is not None:
        add(buyer_id, f"order_{new}", buyer_href)
        add(seller_id, f"order_{new}", seller_href)
    return rows


_PENDING = "order_notifications"
# Set on an Order by code that tells the outcome itself (a dispute decision),
# so the status change it causes is not announced twice.
SKIP_ATTR = "_status_told_elsewhere"


def skip_order_status_notification(order: Order) -> None:
    setattr(order, SKIP_ATTR, True)


@event.listens_for(Session, "after_flush")
def _collect_order_changes(session: Session, flush_context) -> None:  # noqa: ANN001
    # Attribute history is still the pre-flush one here. Rows are written at
    # commit, once the caller had its chance to mark the order as told.
    pending = session.info.setdefault(_PENDING, [])
    for obj in session.new:
        if isinstance(obj, Order) and not obj.is_seeded:
            pending.append((obj, (obj.order_code, obj.buyer_id, obj.seller_id, None, _status(obj.status))))
    for obj in session.dirty:
        if not isinstance(obj, Order) or obj.is_seeded:
            continue
        history = inspect(obj).attrs.status.history
        if history.deleted and history.added:
            old, new = _status(history.deleted[0]), _status(history.added[0])
            if old != new:
                pending.append((obj, (obj.order_code, obj.buyer_id, obj.seller_id, old, new)))


_SETTLED = {OrderStatus.completed.value, OrderStatus.refunded.value, OrderStatus.cancelled.value}


@event.listens_for(Session, "before_commit")
def _write_order_notifications(session: Session) -> None:
    # before_commit fires ahead of commit()'s own final flush: flush here so a
    # status set just before commit() is collected (after_flush) and told now.
    session.flush()
    pending = session.info.pop(_PENDING, None)
    for order, change in pending or ():
        if not getattr(order, SKIP_ATTR, False):
            session.add_all(order_notifications(*change))
        code, buyer_id, _, _, new = change
        if new in _SETTLED:
            # "Delivered — check it" has nothing left to act on once the order settles.
            session.execute(
                update(Notification)
                .where(
                    Notification.account_id == buyer_id,
                    Notification.kind == "order_delivered",
                    Notification.read_at.is_(None),
                    Notification.params["order_code"].astext == code,
                )
                .values(read_at=func.now())
            )


@event.listens_for(Session, "after_rollback")
def _drop_pending(session: Session) -> None:
    session.info.pop(_PENDING, None)
