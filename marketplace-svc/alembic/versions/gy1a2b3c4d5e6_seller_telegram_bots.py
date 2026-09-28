"""seller_telegram_bots / seller_telegram_chats: a seller's own Telegram bot

A seller creates a bot with @BotFather and pastes its token (encrypted at
rest); each chat that sent the one-time link code becomes a delivery target
once the seller confirms it. Delivery reads the seller's notifications and
alerts by id cursor, so no outbox table is needed.

Revision ID: gy1a2b3c4d5e6
Revises: gw1a2b3c4d5e6
Create Date: 2026-09-28
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "gy1a2b3c4d5e6"
down_revision = "gw1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "seller_telegram_bots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("seller_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("bot_id", sa.BigInteger(), nullable=False),
        sa.Column("bot_username", sa.String(64), nullable=False),
        sa.Column("bot_name", sa.String(128), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("paused_reason", sa.String(32), nullable=True),
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fail_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("events", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("link_code_hash", sa.String(64), nullable=True),
        sa.Column("link_code_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("update_offset", sa.BigInteger(), nullable=True),
        sa.Column("last_notification_id", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("last_alert_id", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("chat_watermark_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("chat_digest_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recent_sent", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("retry_after_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("seller_id", name="seller_telegram_bots_seller_id_key"),
        sa.CheckConstraint("status IN ('active', 'paused')", name="ck_seller_telegram_bots_status"),
    )
    op.create_table(
        "seller_telegram_chats",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "bot_row_id", sa.Integer(), sa.ForeignKey("seller_telegram_bots.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("public_key", sa.String(16), nullable=False),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("chat_type", sa.String(16), nullable=False),
        sa.Column("title", sa.String(128), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("fail_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("public_key", name="seller_telegram_chats_public_key_key"),
        sa.UniqueConstraint("bot_row_id", "chat_id", name="uq_seller_telegram_chats_bot_chat"),
        sa.CheckConstraint("status IN ('pending', 'active', 'broken')", name="ck_seller_telegram_chats_status"),
    )
    op.create_index("ix_seller_telegram_chats_bot", "seller_telegram_chats", ["bot_row_id"])


def downgrade() -> None:
    op.drop_index("ix_seller_telegram_chats_bot", table_name="seller_telegram_chats")
    op.drop_table("seller_telegram_chats")
    op.drop_table("seller_telegram_bots")
