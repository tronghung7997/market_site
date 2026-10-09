"""money rules follow-ups: hold floor, commission withdrawals, open-ended fee promos

- ``fee_runtime_config.escrow_floor_hours`` (default 24): the platform hold
  floor no hold goes under (product hold, tier reduction, category floor),
  replacing the hard-coded one-day tier floor and 1 h minimum.
- ``withdraw_requests.source``: ``seller_balance`` (every existing row) or
  ``affiliate_commission`` — an account that is not a seller withdrawing only
  its earned affiliate commission.
- ``seller_fee_promos.ends_at`` nullable: NULL = an open-ended per-seller fee.

Revision ID: ki1a2b3c4d5e6
Revises: kg1a2b3c4d5e6
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op

revision = "ki1a2b3c4d5e6"
down_revision = "kg1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "fee_runtime_config",
        sa.Column("escrow_floor_hours", sa.Integer(), nullable=False, server_default="24"),
    )
    op.add_column(
        "withdraw_requests",
        sa.Column("source", sa.String(length=30), nullable=False, server_default="seller_balance"),
    )
    op.create_check_constraint(
        "ck_withdraw_requests_source", "withdraw_requests",
        "source IN ('seller_balance', 'affiliate_commission')",
    )
    op.alter_column("seller_fee_promos", "ends_at", existing_type=sa.DateTime(timezone=True), nullable=True)


def downgrade() -> None:
    # An open-ended promo gets the longest dated term the API allows (10 years).
    op.execute(
        "UPDATE seller_fee_promos SET ends_at = starts_at + interval '3650 days' WHERE ends_at IS NULL"
    )
    op.alter_column("seller_fee_promos", "ends_at", existing_type=sa.DateTime(timezone=True), nullable=False)
    op.drop_constraint("ck_withdraw_requests_source", "withdraw_requests", type_="check")
    op.drop_column("withdraw_requests", "source")
    op.drop_column("fee_runtime_config", "escrow_floor_hours")
