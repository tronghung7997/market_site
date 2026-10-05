"""When each admin last opened the bell; newer alerts show as unread."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class AdminNotificationSeen(Base):
    __tablename__ = "admin_notification_seen"

    account_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True,
    )
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
