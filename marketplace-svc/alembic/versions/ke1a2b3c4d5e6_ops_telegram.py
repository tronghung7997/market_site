"""ops_telegram_config / _outbox / _listed_products: the marketplace's ops bot

One admin-configured Telegram bot (singleton config, token encrypted at rest)
posts operational events to an operators' group and first-time product
listings to a public channel. Messages go through an outbox the dispatcher
fills from alerts, audit log entries and the SePay journal by id cursor (and
that other modules may append to). ``ops_telegram_listed_products`` remembers
which products were already announced (or were public when the channel was
switched on).

Revision ID: ke1a2b3c4d5e6
Revises: ie1a2b3c4d5e6
Create Date: 2026-10-07
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "ke1a2b3c4d5e6"
down_revision = "ie1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ops_telegram_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("bot_token", sa.Text(), nullable=True),
        sa.Column("bot_id", sa.BigInteger(), nullable=True),
        sa.Column("bot_username", sa.String(64), nullable=True),
        sa.Column("ops_chat_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("channel_chat_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("channel_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("channel_interval_minutes", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("events", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("quiet_low_priority", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("paused_reason", sa.String(32), nullable=True),
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("retry_after_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_alert_id", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("last_log_id", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("last_sepay_event_id", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("channel_last_post_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("status IN ('active', 'paused')", name="ck_ops_telegram_config_status"),
    )
    op.create_table(
        "ops_telegram_outbox",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("target", sa.String(16), nullable=False, server_default="ops"),
        sa.Column("kind", sa.String(48), nullable=False),
        sa.Column("level", sa.String(16), nullable=False, server_default="info"),
        sa.Column("low_priority", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("link", sa.String(500), nullable=True),
        sa.Column("dedupe_key", sa.String(120), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_error", sa.String(200), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("target IN ('ops', 'channel')", name="ck_ops_telegram_outbox_target"),
        sa.CheckConstraint(
            "status IN ('pending', 'sent', 'failed', 'skipped')", name="ck_ops_telegram_outbox_status",
        ),
    )
    op.create_index(
        "ix_ops_telegram_outbox_due", "ops_telegram_outbox", ["next_attempt_at", "id"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "uq_ops_telegram_outbox_dedupe", "ops_telegram_outbox", ["dedupe_key"], unique=True,
        postgresql_where=sa.text("dedupe_key IS NOT NULL"),
    )
    op.create_table(
        "ops_telegram_listed_products",
        sa.Column(
            "product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="CASCADE"), primary_key=True,
        ),
        sa.Column("announced", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("ops_telegram_listed_products")
    op.drop_index("uq_ops_telegram_outbox_dedupe", table_name="ops_telegram_outbox")
    op.drop_index("ix_ops_telegram_outbox_due", table_name="ops_telegram_outbox")
    op.drop_table("ops_telegram_outbox")
    op.drop_table("ops_telegram_config")
