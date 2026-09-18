"""site_runtime_config: maintenance mode, money kill-switches, announcement bar

Revision ID: ff1a2b3c4d5e6
Revises: fe1a2b3c4d5e6
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa

revision = "ff1a2b3c4d5e6"
down_revision = "fe1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "site_runtime_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("maintenance_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("maintenance_message_vi", sa.Text(), nullable=False, server_default=""),
        sa.Column("maintenance_message_en", sa.Text(), nullable=False, server_default=""),
        sa.Column("maintenance_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdrawals_frozen", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deposits_frozen", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("orders_frozen", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("freeze_reason", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("announcement_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("announcement_level", sa.String(length=8), nullable=False, server_default="info"),
        sa.Column("announcement_text_vi", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("announcement_text_en", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("announcement_link_url", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("announcement_starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("announcement_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("announcement_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("site_runtime_config")
