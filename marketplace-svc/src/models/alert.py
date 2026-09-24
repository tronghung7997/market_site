from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(100), nullable=False)
    severity: Mapped[str] = mapped_column(String(50), nullable=False)
    target_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    href: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    # Incident identity for repeatable operational conditions (see upsert_incident).
    # One-off alerts (e.g. dispute_opened) leave this NULL.
    fingerprint: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Admin inbox state, separate from is_active: resolving a seller/buyer
    # alert in the admin console must not hide it from its owner. A recurring
    # incident (upsert_incident) reopens it.
    admin_resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    admin_resolved_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
