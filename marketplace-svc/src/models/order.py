from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Integer, String, Text, func
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


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_orders_quantity_positive"),
        CheckConstraint("total_amount >= 0", name="ck_orders_total_nonnegative"),
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
    # seeing the seller's real base_url/api_key. Hashed at rest like seller_api_keys.
    gateway_key_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    gateway_key_prefix: Mapped[str | None] = mapped_column(String(24), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Dispute(Base):
    __tablename__ = "disputes"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True, nullable=False)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[DisputeStatus] = mapped_column(Enum(DisputeStatus), default=DisputeStatus.open)
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    seller_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
