"""Buyer API keys and idempotency records for the public sales API (/v1)."""
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class ApiKey(Base):
    """A buyer's key for the public API. Only the sha256 of the full key is
    stored; `prefix` is the public part shown in lists (`pk_live_<prefix>_…`)."""

    __tablename__ = "api_keys"
    __table_args__ = (
        Index("ix_api_keys_account_active", "account_id", "revoked_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    scopes: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False)
    # NULL = any IP. Entries are single IPs or CIDRs.
    allowed_ips: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    # VND per Vietnam day across this key's orders; NULL = no key-level cap.
    daily_spend_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ApiIdempotency(Base):
    """One `POST /v1/orders` per (key, Idempotency-Key). `status_code` NULL
    means the request is still in flight; `reserved_amount` holds the order's
    expected total against the key's daily limit until the order exists."""

    __tablename__ = "api_idempotency"
    __table_args__ = (
        UniqueConstraint("api_key_id", "idem_key", name="uq_api_idempotency_key"),
        Index("ix_api_idempotency_key_created", "api_key_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    api_key_id: Mapped[int] = mapped_column(ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False)
    idem_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    reserved_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
