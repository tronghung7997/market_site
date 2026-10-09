"""Maker-checker queue for admin settings (src/config_approval).

One row per proposed change to a config section (fee_config, site_status, …):
the validated PATCH body, the before → after diff computed when it was made,
and a fingerprint of the section at that moment. A second admin approves
(the change is applied through the section's own update function) or rejects
it; the requester may cancel. At most one pending request per section.
"""
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base

CHANGE_STATUSES = ("pending", "approved", "rejected", "cancelled", "superseded", "expired")


class ConfigChangeRequest(Base):
    __tablename__ = "config_change_requests"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'cancelled', 'superseded', 'expired')",
            name="ck_config_change_requests_status",
        ),
        # One open proposal per section: a second one would be stale the
        # moment the first is approved.
        Index(
            "uq_config_change_requests_pending_section", "section",
            unique=True, postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_config_change_requests_status_id", "status", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # Registry key (src/config_approval/sections.py); a plain string so a new
    # section needs no migration.
    section: Mapped[str] = mapped_column(String(48), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="pending")
    # The PATCH body as validated JSON; re-validated and applied on approval.
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # {field: [old, new]} (per-row sections: {row: {field: [old, new]}}).
    diff: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # Display context frozen at request time (e.g. category names).
    context: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Section values when the request was made, and their sha256; approval is
    # refused if the section no longer matches.
    base_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    base_version: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    requested_by_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts.id"), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    decided_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("accounts.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
