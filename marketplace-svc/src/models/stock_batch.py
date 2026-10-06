from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.i18n.slug import new_public_key

# Longest format line / login note a batch keeps.
STOCK_FORMAT_MAX_LENGTH = 500
STOCK_NOTE_MAX_LENGTH = 500


class StockBatch(Base):
    """One upload of stock lines ("lô") and how to read them: `format` names the
    columns, `|`-separated like the lines (`UID|PASS|2FA|MAIL`), and
    `login_note` says how to sign in. Buyers see both above the lines they
    received. A batch that has delivered lines is never edited in place (see
    `resources.batches.update_batch`), so an order always shows the format its
    lines were sold with."""

    __tablename__ = "stock_batches"
    __table_args__ = (CheckConstraint("field_count >= 1", name="ck_stock_batches_field_count"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # What seller URLs, filters and file names use instead of the row id.
    public_key: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, default=new_public_key)
    variant_id: Mapped[int] = mapped_column(ForeignKey("product_variants.id", ondelete="CASCADE"), nullable=False, index=True)
    seller_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    format: Mapped[str] = mapped_column(String(STOCK_FORMAT_MAX_LENGTH), nullable=False)
    field_count: Mapped[int] = mapped_column(Integer, nullable=False)
    login_note: Mapped[str | None] = mapped_column(String(STOCK_NOTE_MAX_LENGTH), nullable=True)
    # upload (paste/file) · assign (format given to older stock) · split (edited copy of a sold batch)
    source: Mapped[str] = mapped_column(String(20), nullable=False, server_default="upload", default="upload")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
