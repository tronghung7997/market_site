from datetime import datetime
from decimal import Decimal
from enum import Enum as PyEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class DepositIntentStatus(str, PyEnum):
    pending = "pending"
    paid = "paid"
    cancelled = "cancelled"
    expired = "expired"


class DepositProvider(str, PyEnum):
    payos = "payos"
    nowpayments = "nowpayments"


class DepositIntent(Base):
    """Lệnh nạp ví — multi-provider (PayOS VND | NOWPayments USDT).

    PayOS: `id` == orderCode map 1-1.
    NOW: order_id = DEP-{id}; credit target VND = amount khi finished validated.
    """

    __tablename__ = "deposit_intents"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[DepositIntentStatus] = mapped_column(
        Enum(DepositIntentStatus), default=DepositIntentStatus.pending, nullable=False,
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default=DepositProvider.payos.value)

    # --- PayOS ---
    payment_link_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    checkout_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    qr_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Số tiền VND đã credit (PayOS = thực nhận; NOW = target amount khi finished).
    paid_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payos_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # --- NOWPayments / crypto ---
    now_invoice_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    pay_currency: Mapped[str | None] = mapped_column(String(32), nullable=True)
    now_payment_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    pay_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    pay_amount: Mapped[Decimal | None] = mapped_column(Numeric(24, 8), nullable=True)
    quoted_usd_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 6), nullable=True)
    vnd_per_usd_snapshot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    paid_crypto_amount: Mapped[Decimal | None] = mapped_column(Numeric(24, 8), nullable=True)
    outcome_amount: Mapped[Decimal | None] = mapped_column(Numeric(24, 8), nullable=True)
    outcome_currency: Mapped[str | None] = mapped_column(String(32), nullable=True)
    external_reference: Mapped[str | None] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PayosWebhookEvent(Base):
    """Sổ thô immutable mọi webhook PayOS đã nhận. UNIQUE(payment_link_id,
    reference) là chốt idempotency: PayOS retry cùng một giao dịch bao nhiêu
    lần cũng chỉ ghi (và credit) đúng một lần."""

    __tablename__ = "payos_webhook_events"
    __table_args__ = (
        UniqueConstraint("payment_link_id", "reference", name="uq_payos_events_link_reference"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    payment_link_id: Mapped[str] = mapped_column(String(64), nullable=False)
    order_code: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reference: Mapped[str] = mapped_column(String(100), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False)
    signature_valid: Mapped[bool] = mapped_column(Boolean, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class NowpaymentsIpnEvent(Base):
    """Audit journal for NOWPayments IPNs. Credit idempotency is still
    intent.paid + FOR UPDATE; this table stops reprocessing identical payloads."""

    __tablename__ = "nowpayments_ipn_events"
    __table_args__ = (
        UniqueConstraint(
            "payment_id", "payment_status", "payload_hash",
            name="uq_nowpayments_ipn_payment_status_hash",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    payment_id: Mapped[str] = mapped_column(String(64), nullable=False)
    payment_status: Mapped[str] = mapped_column(String(32), nullable=False)
    order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    signature_valid: Mapped[bool] = mapped_column(Boolean, nullable=False)
    raw: Mapped[dict] = mapped_column(JSONB, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
