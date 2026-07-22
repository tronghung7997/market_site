from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class ProxyAllocationStatus(str, PyEnum):
    allocated = "allocated"
    # Present upstream but temporarily unusable (inactive/offline) — a
    # RECOVERABLE state, distinct from `error`. Reconciliation
    # (src/scheduler.py::dproxy_reconciliation_job) queries allocated+offline
    # together so a proxy that comes back online returns to `allocated`
    # instead of being stuck the moment it flickers. See review fixes
    # docs/superpowers/plans/2026-07-22-dproxy-review-fixes.md Blocker 2.
    offline = "offline"
    expired = "expired"
    released = "released"
    error = "error"


class ProxyAllocation(Base):
    """Exclusive binding between one DProxy upstream assignment and one
    order. See docs/superpowers/specs/2026-07-22-dproxy-integration.md Task 2
    — src/resources/proxy_service.py owns all writes to this table."""

    __tablename__ = "proxy_allocations"
    __table_args__ = (
        # Prevents cross-order double delivery of the same upstream assignment.
        UniqueConstraint("provider_id", "external_id", name="uq_proxy_allocations_provider_external"),
        # One DProxy assignment per order in this phase (see plan Decisions).
        UniqueConstraint("order_id", name="uq_proxy_allocations_order"),
        Index("ix_proxy_allocations_provider_status_expiry", "provider_id", "status", "expires_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), nullable=False)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(100), nullable=False)
    external_proxy_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[ProxyAllocationStatus] = mapped_column(
        Enum(ProxyAllocationStatus), default=ProxyAllocationStatus.allocated,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Metadata only, never authorization — every use must independently
    # re-validate against expected_rotate_path(external_id) (src/adapters/dproxy.py).
    rotate_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    rotation_available: Mapped[bool] = mapped_column(default=False)
    cooldown_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_public_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Consecutive reconciliation runs where this external_id was entirely
    # absent from the supplier's list response — a grace counter so one bad
    # /list response can't flip an allocation straight to `error` (see
    # dproxy_reconciliation_job's MISSING_GRACE_ROUNDS). Reset to 0 the
    # moment the assignment reappears in any state (online, offline, or
    # expired — "present" is what matters here, not usability).
    consecutive_misses: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
