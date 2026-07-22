from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class Provider(Base):
    __tablename__ = "providers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(100), nullable=False)
    config: Mapped[dict] = mapped_column(JSON, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(default=True)
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    adapter_type: Mapped[str] = mapped_column(String(50), default="mock")
    fallback_provider_id: Mapped[int | None] = mapped_column(
        ForeignKey("providers.id"), nullable=True
    )
    # NULL = admin-owned platform infrastructure (topproxy/scrapecreators/mock/
    # seller_pool/manual) — unchanged from before, shared across sellers.
    # Set = a seller registered their own backend; only usable on THEIR OWN
    # products, and only once approved.
    seller_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True, index=True)
    review_status: Mapped[str] = mapped_column(String(20), default="approved")
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class ProviderHealth(Base):
    __tablename__ = "provider_health"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), nullable=False)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    success_rate: Mapped[float] = mapped_column(Float, default=1.0)
    status: Mapped[str] = mapped_column(String(50), nullable=False)


class ProviderCallLog(Base):
    """One row per HTTP attempt against an external provider.

    Metadata only — no request/response bodies. A provision response carries the
    credential handed to the buyer, so persisting bodies would create a second
    plaintext copy of it here.

    Written on its own session (see adapters/call_log.py) so a row survives the
    caller's transaction rolling back. That is also why order_id carries no FK:
    the order is flushed but uncommitted when the provision call runs, so it is
    invisible to another session and an FK would fail on insert.
    """

    __tablename__ = "provider_call_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), nullable=False, index=True)
    order_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    operation: Mapped[str] = mapped_column(String(50), nullable=False)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(255), nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
