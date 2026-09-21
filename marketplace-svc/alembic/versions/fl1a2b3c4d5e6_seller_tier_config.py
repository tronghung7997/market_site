"""seller_tier_config: admin-tunable levers per seller tier

Revision ID: fl1a2b3c4d5e6
Revises: fk1a2b3c4d5e6
Create Date: 2026-09-21
"""
from alembic import op
import sqlalchemy as sa

revision = "fl1a2b3c4d5e6"
down_revision = "fk1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "seller_tier_config",
        sa.Column("tier", sa.String(length=20), primary_key=True),
        sa.Column("max_active_products", sa.Integer(), nullable=True),
        sa.Column("withdraw_limit_per_request", sa.Integer(), nullable=True),
        sa.Column("fee_discount_pp", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("escrow_reduction_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )
    # Seed with the values that used to be hardcoded, so nothing changes on upgrade.
    op.execute(
        "INSERT INTO seller_tier_config (tier, max_active_products, withdraw_limit_per_request, fee_discount_pp, escrow_reduction_days) VALUES"
        " ('new', 3, 2000000, 0, 0), ('verified', 5, 10000000, 1, 0), ('trusted', 10, 50000000, 2, 1), ('enterprise', NULL, NULL, 3, 2)"
    )


def downgrade() -> None:
    op.drop_table("seller_tier_config")
