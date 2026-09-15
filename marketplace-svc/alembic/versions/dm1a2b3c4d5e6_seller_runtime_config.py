"""seller_runtime_config singleton (low-stock threshold, export row limit)

The seller Products page said "low stock" at <= 20 while the Inventory page
said <= 5. One admin-editable row replaces both constants.

Revision ID: dm1a2b3c4d5e6
Revises: dj1a2b3c4d5e6
Create Date: 2026-09-15
"""
from alembic import op
import sqlalchemy as sa

revision = "dm1a2b3c4d5e6"
down_revision = "dj1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "seller_runtime_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("low_stock_threshold", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("inventory_export_row_limit", sa.Integer(), nullable=False, server_default="50000"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("seller_runtime_config")
