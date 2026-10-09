"""The marketplace's own Telegram bot for operators (Settings › Bot vận hành).

One admin-configured bot (singleton ``ops_telegram_config``, id=1) posts to an
operators' group (withdrawals, disputes, unmatched deposits, kill-switch flips,
system alerts, seller applications) and, optionally, to a public channel
(products listed for the first time). The token is encrypted at rest, never
returned by the API and never logged.

Every message goes through ``ops_telegram_outbox``. The dispatcher fills it
from rows the marketplace already writes (alerts, audit log entries, the SePay
journal) by id cursor, and any module may add a row with
``src.ops_telegram.service.enqueue_ops_message`` in its own transaction.
"""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.models.resource import EncryptedText

OUTBOX_TARGETS = ("ops", "channel")
OUTBOX_STATUSES = ("pending", "sent", "failed", "skipped")


class OpsTelegramConfig(Base):
    __tablename__ = "ops_telegram_config"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'paused')", name="ck_ops_telegram_config_status"),
    )

    # Singleton: always id=1.
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Fernet under ENCRYPTION_KEY; write-only through the API (only a hint is shown).
    bot_token: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    bot_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    bot_username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Telegram chat ids ("-100…") or a public "@channel" handle.
    ops_chat_id: Mapped[str] = mapped_column(String(64), nullable=False, default="", server_default="")
    channel_chat_id: Mapped[str] = mapped_column(String(64), nullable=False, default="", server_default="")
    channel_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # At most one channel post per this many minutes; products listed in
    # between are combined into that post.
    channel_interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=30, server_default="30")
    # {event_key: bool}; an absent key means "on".
    events: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb"))
    # Low-priority messages arrive without sound (Telegram disable_notification).
    quiet_low_priority: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    # Delivery state. paused = Telegram refused the token or a target chat;
    # nothing is collected or sent until an admin resumes it.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")
    # token_rejected · ops_chat_unreachable · channel_unreachable
    paused_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Telegram asked us to slow down (429 retry_after).
    retry_after_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Source cursors (highest row id already turned into outbox rows or passed).
    last_alert_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    last_log_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    last_sepay_event_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    channel_last_post_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)


class OpsTelegramOutbox(Base):
    __tablename__ = "ops_telegram_outbox"
    __table_args__ = (
        CheckConstraint("target IN ('ops', 'channel')", name="ck_ops_telegram_outbox_target"),
        CheckConstraint(
            "status IN ('pending', 'sent', 'failed', 'skipped')", name="ck_ops_telegram_outbox_status",
        ),
        # The dispatcher's due scan.
        Index(
            "ix_ops_telegram_outbox_due", "next_attempt_at", "id",
            postgresql_where=text("status = 'pending'"),
        ),
        Index(
            "uq_ops_telegram_outbox_dedupe", "dedupe_key", unique=True,
            postgresql_where=text("dedupe_key IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    target: Mapped[str] = mapped_column(String(16), nullable=False, default="ops", server_default="ops")
    # Event key (see service.EVENT_KEYS) or a caller's own kind.
    kind: Mapped[str] = mapped_column(String(48), nullable=False)
    # urgent · action · info
    level: Mapped[str] = mapped_column(String(16), nullable=False, default="info", server_default="info")
    low_priority: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # Plain text (escaped when rendered); first line is the title.
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    # Site path (/admin/…, /products/…) or absolute https URL for the button.
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending", server_default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    last_error: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class OpsTelegramListedProduct(Base):
    """Products already announced (or present when the channel was switched
    on): a product is posted to the channel once, the first time it is public."""

    __tablename__ = "ops_telegram_listed_products"

    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), primary_key=True,
    )
    # False = baseline (already public when the channel was switched on).
    announced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
