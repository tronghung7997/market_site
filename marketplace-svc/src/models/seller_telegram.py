"""A seller's own Telegram bot and the chats it posts shop notifications to.

The seller creates the bot with @BotFather and pastes its token; the token is
encrypted at rest and only decrypted inside ``src.seller_telegram``. What gets
sent is read from the seller's ``notifications`` and ``alerts`` rows by id
cursor (``last_notification_id`` / ``last_alert_id``), so a rolled-back domain
change never reaches Telegram and nothing has to be written twice.
"""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.models.resource import EncryptedText

BOT_STATUSES = ("active", "paused")
CHAT_STATUSES = ("pending", "active", "broken")


class SellerTelegramBot(Base):
    __tablename__ = "seller_telegram_bots"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'paused')", name="ck_seller_telegram_bots_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    seller_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), unique=True, nullable=False,
    )
    # Fernet under ENCRYPTION_KEY; never returned by the API, never logged.
    token: Mapped[str] = mapped_column(EncryptedText, nullable=False)
    bot_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    bot_username: Mapped[str] = mapped_column(String(64), nullable=False)
    bot_name: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")
    # token_rejected (401 from Telegram) · no_chats (every chat blocked the bot)
    paused_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fail_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # {event_key: bool}; a key that is absent means "on" (the default).
    events: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))

    # Linking a chat: sha256 of the one-time code and the getUpdates offset
    # taken when the code was issued (older updates are never read).
    link_code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    link_code_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    update_offset: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    # Delivery cursors.
    last_notification_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    last_alert_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    # Buyer chat messages newer than this are still to be summarised.
    chat_watermark_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    chat_digest_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Ids already sent that the cursors have not passed yet:
    # {"n": [notification ids], "a": [alert ids]} (see dispatch).
    recent_sent: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"),
    )
    # Telegram asked us to slow down (429 retry_after).
    retry_after_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False,
    )


class SellerTelegramChat(Base):
    __tablename__ = "seller_telegram_chats"
    __table_args__ = (
        UniqueConstraint("bot_row_id", "chat_id", name="uq_seller_telegram_chats_bot_chat"),
        CheckConstraint("status IN ('pending', 'active', 'broken')", name="ck_seller_telegram_chats_status"),
        Index("ix_seller_telegram_chats_bot", "bot_row_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    bot_row_id: Mapped[int] = mapped_column(
        ForeignKey("seller_telegram_bots.id", ondelete="CASCADE"), nullable=False,
    )
    # Addresses the chat in seller URLs/API paths instead of the row id.
    public_key: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    chat_type: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(128), nullable=False, default="", server_default="")
    # pending = the code arrived, the seller has not confirmed it is theirs yet.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    fail_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
