from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class OrderStatus(str, PyEnum):
    pending = "pending"
    processing = "processing"
    delivered = "delivered"
    completed = "completed"
    disputed = "disputed"
    refunded = "refunded"
    cancelled = "cancelled"


class DisputeStatus(str, PyEnum):
    open = "open"
    resolved_refund = "resolved_refund"
    resolved_reject = "resolved_reject"
    resolved_partial_refund = "resolved_partial_refund"
    resolved_replace = "resolved_replace"
    resolved_extend_warranty = "resolved_extend_warranty"
    resolved_timeout = "resolved_timeout"
    withdrawn_by_buyer = "withdrawn_by_buyer"
    resolved_abandoned = "resolved_abandoned"


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_orders_quantity_positive"),
        CheckConstraint("total_amount >= 0", name="ck_orders_total_nonnegative"),
        CheckConstraint(
            "refunded_amount >= 0 AND refunded_amount <= total_amount",
            name="ck_orders_refunded_amount_range",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    seller_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    variant_id: Mapped[int | None] = mapped_column(ForeignKey("product_variants.id"), nullable=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    # Snapshot of the provider that actually fulfilled this order (set in
    # orders/service.py::_apply_provision_result, after fallback resolution).
    # The gateway router resolves through THIS, not product.provider_id —
    # reassigning the product's provider later must not silently redirect a
    # buyer's already-sold gateway key to a different seller.
    provider_id: Mapped[int | None] = mapped_column(ForeignKey("providers.id"), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    total_amount: Mapped[int] = mapped_column(Integer, nullable=False)
    refunded_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Display-only: VND per 1 USD at order creation. NULL for pre-rollout
    # orders → FE uses immutable legacy rate 26_000 (not current rate).
    display_fx_rate_snapshot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus), default=OrderStatus.pending)
    escrow_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Lý do huỷ WHITE-LABEL cho buyer đọc (hết hàng / không cấp phát được…),
    # luôn kèm trấn an đã hoàn tiền. Chi tiết kỹ thuật vẫn ở log_entries (admin).
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Product options the buyer picked (type/network/days/platform/...). Persisted
    # because provisioning now runs after the request returns: both the background
    # task and the stuck-order sweeper need to replay it. Never holds credentials.
    user_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Platform-minted token for the `seller_gateway` adapter (strategy=credit) —
    # buyer calls POST/GET /gw/{plaintext}/{endpoint} with this instead of ever
    # seeing the seller's real base_url/api_key. Hashed at rest.
    gateway_key_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    gateway_key_prefix: Mapped[str | None] = mapped_column(String(24), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Dispute(Base):
    __tablename__ = "disputes"
    __table_args__ = (
        Index(
            "uq_disputes_one_open_case_per_order",
            "order_id",
            unique=True,
            postgresql_where=text("status = 'open'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[DisputeStatus] = mapped_column(Enum(DisputeStatus), default=DisputeStatus.open)
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    seller_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Set only after a seller has made a concrete response/remedy offer. Buyer
    # activity clears both fields, preventing a stale offer from auto-settling.
    resolution_offered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DisputeClaimResource(Base):
    __tablename__ = "dispute_claim_resources"
    __table_args__ = (
        UniqueConstraint(
            "dispute_id",
            "resource_id",
            name="uq_dispute_claim_resources_dispute_resource",
        ),
        Index("ix_dispute_claim_resources_batch", "dispute_id", "batch_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    dispute_id: Mapped[int] = mapped_column(ForeignKey("disputes.id"), nullable=False)
    resource_id: Mapped[int] = mapped_column(ForeignKey("resources.id"), nullable=False)
    batch_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DisputeResourceAction(Base):
    """Immutable buyer-visible record of a seller's resource-level remedy."""

    __tablename__ = "dispute_resource_actions"
    __table_args__ = (
        CheckConstraint("action IN ('replace', 'refund')", name="ck_dispute_resource_action_type"),
        CheckConstraint("refund_amount >= 0", name="ck_dispute_resource_refund_nonnegative"),
        UniqueConstraint("dispute_id", "original_resource_id", name="uq_dispute_resource_action_original"),
        UniqueConstraint(
            "dispute_id",
            "idempotency_key",
            "original_resource_id",
            name="uq_dispute_resource_actions_idempotent_item",
        ),
        Index("ix_dispute_resource_actions_dispute_created", "dispute_id", "created_at"),
        Index("ix_dispute_resource_actions_idempotency", "dispute_id", "idempotency_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    dispute_id: Mapped[int] = mapped_column(ForeignKey("disputes.id"), nullable=False)
    original_resource_id: Mapped[int] = mapped_column(ForeignKey("resources.id"), nullable=False)
    replacement_resource_id: Mapped[int | None] = mapped_column(ForeignKey("resources.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    refund_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DisputeMessage(Base):
    """Append-only case conversation entry used by the buyer-visible timeline."""

    __tablename__ = "dispute_messages"
    __table_args__ = (
        CheckConstraint("actor_role IN ('buyer', 'seller', 'admin')", name="ck_dispute_messages_actor_role"),
        Index("ix_dispute_messages_case_time", "dispute_id", "created_at"),
        Index(
            "uq_dispute_messages_idempotency",
            "dispute_id",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    dispute_id: Mapped[int] = mapped_column(ForeignKey("disputes.id"), nullable=False)
    actor_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(20), nullable=False)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
