"""Per-attempt login history so admins can trace which IPs touched an account.

One row per login attempt against an existing account (success or wrong
password) and per admin lock/unlock, kept separate from `log_entries` so the
account page can page through it cheaply by `(account_id, created_at)`.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class LoginEvent(Base):
    __tablename__ = "login_events"
    __table_args__ = (
        Index("ix_login_events_account_created", "account_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    # login | admin_login | locked | unlocked
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # success | invalid_credentials | inactive
    outcome: Mapped[str] = mapped_column(String(24), nullable=False)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Admin who locked/unlocked; NULL for the account's own logins.
    actor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
