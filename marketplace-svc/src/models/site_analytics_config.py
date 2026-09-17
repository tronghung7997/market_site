"""Singleton admin-tunable third-party analytics tags.

Holds the public project ids the storefront injects at render time (Microsoft
Clarity today) so an admin can turn tracking on/off from the settings page
without a rebuild or a compose change.
"""
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class SiteAnalyticsConfig(Base):
    __tablename__ = "site_analytics_config"

    # Singleton: always id=1.
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Microsoft Clarity project id (public — it ships in page source). NULL = tag off.
    clarity_project_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
