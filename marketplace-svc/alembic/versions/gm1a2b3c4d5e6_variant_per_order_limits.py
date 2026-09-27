"""product variants: minimum / maximum units per order

Revision ID: gm1a2b3c4d5e6
Revises: gl1a2b3c4d5e6
Create Date: 2026-09-27
"""
import sqlalchemy as sa
from alembic import op

revision = "gm1a2b3c4d5e6"
down_revision = "gl1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("product_variants", sa.Column("min_per_order", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("product_variants", sa.Column("max_per_order", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_product_variants_per_order_range",
        "product_variants",
        "min_per_order >= 1 AND (max_per_order IS NULL OR max_per_order >= min_per_order)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_product_variants_per_order_range", "product_variants", type_="check")
    op.drop_column("product_variants", "max_per_order")
    op.drop_column("product_variants", "min_per_order")
