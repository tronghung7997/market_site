from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import BigInteger, Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class DepositIntentStatus(str, PyEnum):
    pending = "pending"
    paid = "paid"
    cancelled = "cancelled"
    expired = "expired"


class DepositIntent(Base):
    """Một lệnh nạp tiền qua PayOS. `id` đồng thời là `orderCode` gửi PayOS —
    map 1-1 ngay từ lúc tạo link nên webhook trả về orderCode là tra thẳng ra
    lệnh nạp, không có bài toán match memo (xem
    docs/superpowers/specs/2026-07-23-bank-payment-design.md §1)."""

    __tablename__ = "deposit_intents"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[DepositIntentStatus] = mapped_column(
        Enum(DepositIntentStatus), default=DepositIntentStatus.pending, nullable=False,
    )
    payment_link_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    checkout_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    qr_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Số tiền THỰC nhận theo webhook — nguồn sự thật khi lệch với `amount`.
    paid_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payos_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
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
