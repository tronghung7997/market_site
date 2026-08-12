"""deposit_rail_config singleton for admin-tunable deposit rails

Revision ID: cp1a2b3c4d5e6
Revises: co1a2b3c4d5e6
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa

revision = "cp1a2b3c4d5e6"
down_revision = "co1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "deposit_rail_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("payos_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("nowpayments_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deposit_min_amount", sa.Integer(), nullable=False, server_default="10000"),
        sa.Column("deposit_max_amount", sa.Integer(), nullable=False, server_default="100000000"),
        sa.Column("deposit_expire_minutes", sa.Integer(), nullable=False, server_default="30"),
        sa.Column(
            "deposit_reconcile_retention_hours",
            sa.Integer(),
            nullable=False,
            server_default="48",
        ),
        sa.Column("deposit_usdt_min_vnd", sa.Integer(), nullable=False, server_default="50000"),
        sa.Column("deposit_usdt_max_vnd", sa.Integer(), nullable=False, server_default="50000000"),
        sa.Column(
            "deposit_usdt_local_window_minutes",
            sa.Integer(),
            nullable=False,
            server_default="60",
        ),
        sa.Column(
            "deposit_usdt_reconcile_retention_hours",
            sa.Integer(),
            nullable=False,
            server_default="192",
        ),
        sa.Column(
            "nowpayments_default_pay_currency",
            sa.String(length=32),
            nullable=False,
            server_default="usdtbsc",
        ),
        sa.Column(
            "nowpayments_allowed_pay_currencies",
            sa.String(length=256),
            nullable=False,
            server_default="usdtbsc",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("deposit_rail_config")
