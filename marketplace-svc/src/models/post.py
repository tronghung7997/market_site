"""Blog posts (guides and marketplace news), written by admins in vi/en."""
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base

POST_CATEGORIES = ("guide", "news")
POST_STATUSES = ("draft", "published")


class Post(Base):
    __tablename__ = "posts"
    __table_args__ = (
        CheckConstraint("category IN ('guide', 'news')", name="ck_posts_category"),
        CheckConstraint("status IN ('draft', 'published')", name="ck_posts_status"),
        CheckConstraint("status = 'draft' OR published_at IS NOT NULL", name="ck_posts_published_at"),
        Index("ix_posts_public", "status", "published_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # URL segment under /blog/{slug}.
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # PublicImage snapshot (media purpose post_cover) or None.
    cover: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # {"vi": {"title", "excerpt", "body"}, "en": {...}}; en falls back to vi.
    i18n: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    author_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
