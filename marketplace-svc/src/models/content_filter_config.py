"""Singleton admin-tunable rules for the off-platform contact filter.

Buyer/seller chat and dispute text pass through this before being stored so
"zalo", "telegram", phone numbers … cannot be used to move the deal off the
marketplace (and its fee). The list is data, not code: admin edits it in
Settings › Content filter.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class ContentFilterConfig(Base):
    __tablename__ = "content_filter_config"

    # Singleton: always id=1.
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # "block" rejects the message with an error; "mask" stores it with the
    # matched fragments replaced by `mask_char`.
    action: Mapped[str] = mapped_column(String(8), nullable=False, default="block", server_default="block")
    # Lower-cased, unaccented keywords. Matched as substrings of the folded
    # text and of the text with separators removed ("z.a.l.o").
    keywords: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    block_phone_numbers: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    block_links: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    mask_char: Mapped[str] = mapped_column(String(1), nullable=False, default="*", server_default="*")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )
    updated_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
