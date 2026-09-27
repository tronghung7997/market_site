from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base

QUESTION_STATUSES = ("pending", "answered", "hidden")


class ProductQuestion(Base):
    """A question a signed-in buyer asks on a product page. It stays private
    to the asker and the seller until the seller answers; answered questions
    are public. The seller or an admin can hide one (``hidden_by``)."""
    __tablename__ = "product_questions"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'answered', 'hidden')", name="ck_product_questions_status"),
        CheckConstraint("hidden_by IS NULL OR hidden_by IN ('seller', 'admin')", name="ck_product_questions_hidden_by"),
        Index("ix_product_questions_public", "product_id", "status", "answered_at"),
        Index("ix_product_questions_asker", "asker_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    asker_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    question: Mapped[str] = mapped_column(String(500), nullable=False)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    # Who hid it; a question hidden by an admin cannot be unhidden by the seller.
    hidden_by: Mapped[str | None] = mapped_column(String(16), nullable=True)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
