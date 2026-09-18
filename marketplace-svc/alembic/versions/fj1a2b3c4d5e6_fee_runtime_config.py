"""fee_runtime_config (Settings › Fees & holds) + withdraw fee columns

Revision ID: fj1a2b3c4d5e6
Revises: fi1a2b3c4d5e6
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "fj1a2b3c4d5e6"
down_revision = "fi1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fee_runtime_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("platform_fee_percent", sa.Float(), nullable=False, server_default="0"),
        sa.Column("category_fee_percent", postgresql.JSON(), nullable=False, server_default="{}"),
        sa.Column("escrow_default_days", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("escrow_min_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("category_escrow_min_days", postgresql.JSON(), nullable=False, server_default="{}"),
        sa.Column("withdraw_min_amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("withdraw_fee_fixed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("withdraw_fee_percent", sa.Float(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )
    op.add_column("withdraw_requests", sa.Column("fee_amount", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("withdraw_requests", sa.Column("net_amount", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("withdraw_requests", "net_amount")
    op.drop_column("withdraw_requests", "fee_amount")
    op.drop_table("fee_runtime_config")
