"""manual_stock: how many units a made-to-order package can still take

``product_variants.manual_stock`` is the seller-set number of units a manual
("theo yêu cầu") package still accepts; NULL keeps today's behaviour (no
limit). Each order takes its quantity off the count and remembers it in
``orders.stock_held`` until the seller delivers; an order cancelled before
delivery puts it back.

Revision ID: ms1a2b3c4d5e6
Revises: ux1a2b3c4d5e6
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op

revision = "ms1a2b3c4d5e6"
down_revision = "ux1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("product_variants", sa.Column("manual_stock", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_product_variants_manual_stock_nonnegative", "product_variants",
        "manual_stock IS NULL OR manual_stock >= 0",
    )
    op.add_column(
        "orders", sa.Column("stock_held", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_check_constraint("ck_orders_stock_held_nonnegative", "orders", "stock_held >= 0")


def downgrade() -> None:
    op.drop_constraint("ck_orders_stock_held_nonnegative", "orders", type_="check")
    op.drop_column("orders", "stock_held")
    op.drop_constraint("ck_product_variants_manual_stock_nonnegative", "product_variants", type_="check")
    op.drop_column("product_variants", "manual_stock")
