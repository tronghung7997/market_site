"""Singleton operational switches: maintenance mode, money kill-switches and
the storefront announcement bar. Admin-edited (Settings › System), cached
per process, every change audited."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class SiteRuntimeConfig(Base):
    __tablename__ = "site_runtime_config"

    # Singleton: always id=1.
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Maintenance: storefront/seller API answer 503 MAINTENANCE for everyone
    # except admins; money-moving scheduler jobs pause.
    maintenance_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    maintenance_message_vi: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    maintenance_message_en: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    maintenance_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Kill-switches, each independent. Reason is internal (audit log only).
    withdrawals_frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    deposits_frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    orders_frozen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    freeze_reason: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")

    # Announcement bar.
    announcement_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # info | warn | danger
    announcement_level: Mapped[str] = mapped_column(String(8), nullable=False, default="info", server_default="info")
    announcement_text_vi: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    announcement_text_en: Mapped[str] = mapped_column(String(300), nullable=False, default="", server_default="")
    announcement_link_url: Mapped[str] = mapped_column(String(500), nullable=False, default="", server_default="")
    announcement_starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    announcement_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Bumped whenever the text changes so a visitor's "dismissed" flag resets.
    announcement_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
