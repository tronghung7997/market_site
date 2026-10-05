"""Admin changelog: one row per release, plus each admin's read marker."""
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class ChangelogRelease(Base):
    __tablename__ = "changelog_releases"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'published')", name="ck_changelog_releases_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Shown as-is ("v1.42"); unique so two releases never share a label.
    version: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    released_on: Mapped[date] = mapped_column(Date, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # [{"kind": "new"|"improved"|"fixed", "text": str, "audience": [str]}]
    items: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # Commits, migrations, manual steps — the collapsible dev section.
    dev_notes: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", server_default="draft")
    # Set on first publish; drives the unread dot.
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )


class ChangelogSeen(Base):
    __tablename__ = "changelog_seen"

    account_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True,
    )
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
