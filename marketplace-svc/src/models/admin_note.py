"""Internal admin notes pinned to an account or a seller application.

Never shown to the subject; admin console only.
"""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base

ADMIN_NOTE_SUBJECTS = ("account", "seller_application")


class AdminNote(Base):
    __tablename__ = "admin_notes"
    __table_args__ = (
        CheckConstraint("subject_type IN ('account', 'seller_application')", name="ck_admin_notes_subject_type"),
        Index("ix_admin_notes_subject", "subject_type", "subject_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    subject_type: Mapped[str] = mapped_column(String(32), nullable=False)
    subject_id: Mapped[int] = mapped_column(Integer, nullable=False)
    author_id: Mapped[int] = mapped_column(Integer, nullable=False)
    body: Mapped[str] = mapped_column(String(2000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
