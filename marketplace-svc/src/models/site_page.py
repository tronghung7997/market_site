"""Admin-editable footer/legal pages (markdown, bilingual, one row per slug)."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class SitePage(Base):
    __tablename__ = "site_pages"

    # URL segment under /legal/{slug}. Immutable after creation.
    slug: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Footer ordering, ascending. Ties break on slug.
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100, server_default="100")
    # Hidden pages stay reachable by URL but are not linked from the footer.
    show_in_footer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    title_vi: Mapped[str] = mapped_column(String(160), nullable=False)
    # Empty string = fall back to the vi copy on the storefront.
    title_en: Mapped[str] = mapped_column(String(160), nullable=False, default="", server_default="")
    body_vi: Mapped[str] = mapped_column(Text, nullable=False)
    body_en: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
