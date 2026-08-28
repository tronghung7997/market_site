"""Track refunded escrow before seller release.

Revision ID: b1c2d3e4f5a6
Revises: aa1b2c3d4e5f
"""
from alembic import op
import sqlalchemy as sa

revision = "b1c2d3e4f5a6"
down_revision = "aa1b2c3d4e5f"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column("orders", sa.Column("refunded_amount", sa.Integer(), nullable=False, server_default="0"))
    op.create_check_constraint("ck_orders_refunded_amount_range", "orders", "refunded_amount >= 0 AND refunded_amount <= total_amount")

def downgrade() -> None:
    op.drop_constraint("ck_orders_refunded_amount_range", "orders", type_="check")
    op.drop_column("orders", "refunded_amount")
