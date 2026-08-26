"""Singleton runtime config for transactional mail.

Secrets (RESEND_API_KEY, SMTP password) stay in env only.
This table holds operational knobs admin can change without redeploy.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class MailRuntimeConfig(Base):
    __tablename__ = "mail_runtime_config"

    # Singleton: always id=1.
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    mail_from: Mapped[str] = mapped_column(String(255), nullable=False, server_default="")
    mail_from_name: Mapped[str] = mapped_column(String(80), nullable=False, server_default="Proxora")
    worker_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true",
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
