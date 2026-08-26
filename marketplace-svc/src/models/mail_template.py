"""Admin-editable transactional mail copy (subject/body per template+locale)."""
from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class MailTemplate(Base):
    __tablename__ = "mail_templates"

    template: Mapped[str] = mapped_column(String(100), primary_key=True)
    locale: Mapped[str] = mapped_column(String(8), primary_key=True)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(nullable=True)
