"""Singleton admin-tunable sign-up / sign-in policy."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class AuthRuntimeConfig(Base):
    __tablename__ = "auth_runtime_config"

    # Singleton: always id=1.
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # When on, buying, depositing and withdrawing need a verified email.
    # Browsing and signing in never do.
    require_email_verification: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # Lifetime of the link mailed at sign-up / on resend.
    verification_link_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=24, server_default="24")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
