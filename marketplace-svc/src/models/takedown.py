"""Link takedown requests, fulfilled by an external partner ("Takedown Module").

One row per link a buyer wants taken down. GMMO is a single member client of
the partner: every request becomes one partner order under GMMO's client key,
so the partner never learns who the buyer is. The partner quotes a cost, an
admin sets the buyer's price, and only an accepted quote turns into money — an
ordinary marketplace order of the internal takedown seller (escrow, refunds
and ledger exactly as for any other order).
"""

import secrets
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base

_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

# Request lifecycle as the buyer sees it (mapped from the partner's statuses in
# src/takedown/lifecycle.py). Terminal states never change again.
TAKEDOWN_STATUSES = (
    "review", "quoted", "started", "processing", "warranty", "warranty_claim",
    "done", "failed", "declined", "rejected", "cancelled",
)
TAKEDOWN_TERMINAL = frozenset({"done", "failed", "declined", "rejected", "cancelled"})


def new_takedown_code() -> str:
    """Public reference shown to buyers: ``TD-`` + 8 unambiguous characters."""
    return "TD-" + "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))


class TakedownRequest(Base):
    __tablename__ = "takedown_requests"
    __table_args__ = (
        CheckConstraint("price IS NULL OR price > 0", name="ck_takedown_requests_price_positive"),
        CheckConstraint("warranty_hours IN (24, 72)", name="ck_takedown_requests_warranty_hours"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False, default=new_takedown_code)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    # Exactly what the buyer pasted (untrusted text, rendered as text only).
    url: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    service: Mapped[str] = mapped_column(String(32), nullable=False)
    platform: Mapped[str] = mapped_column(String(20), nullable=False)
    warranty_hours: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="review", index=True)

    # Partner side. partner_order_id stays NULL until the create call succeeds;
    # the sync job retries creation for such rows.
    partner_order_id: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    partner_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # Partner's quote to GMMO (cost, ledger VND) and GMMO's price to the buyer.
    partner_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    warranty_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    evidence_live_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_dead_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    partner_refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # The marketplace order created when the buyer accepts the quote.
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), unique=True, nullable=True)

    # Sync bookkeeping: a webhook that could not be applied in order, a failed
    # partner call, or a buyer action still to forward sets needs_sync.
    needs_sync: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    sync_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    quoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processing_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TakedownEvent(Base):
    """History of a request: partner webhooks and every action on our side.

    ``partner_event_id`` is the partner's webhook id; its unique index makes a
    redelivered webhook a no-op."""

    __tablename__ = "takedown_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int | None] = mapped_column(ForeignKey("takedown_requests.id"), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False)  # partner | buyer | admin | system
    partner_event_id: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # Partner notes are admin-only; buyer-visible text comes from our own copy.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
