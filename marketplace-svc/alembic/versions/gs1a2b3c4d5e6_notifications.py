"""notifications: per-account notification history with read state

Revision ID: gs1a2b3c4d5e6
Revises: gr1a2b3c4d5e6
Create Date: 2026-09-27
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "gs1a2b3c4d5e6"
down_revision = "gr1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column("kind", sa.String(48), nullable=False),
        sa.Column("params", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("href", sa.String(300), nullable=True),
        sa.Column("collapse_key", sa.String(80), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("category IN ('order', 'wallet', 'message', 'system')", name="ck_notifications_category"),
    )
    op.create_index("ix_notifications_account_created", "notifications", ["account_id", "id"])
    op.create_index(
        "uq_notifications_unread_collapse", "notifications", ["account_id", "collapse_key"],
        unique=True, postgresql_where=sa.text("read_at IS NULL AND collapse_key IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_notifications_unread_collapse", table_name="notifications")
    op.drop_index("ix_notifications_account_created", table_name="notifications")
    op.drop_table("notifications")
