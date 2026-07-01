"""backfill columns present in models but missing from migrations

Adds orders.product_id and disputes.seller_note, and relaxes
orders.variant_id to nullable, to match the ORM models in
src/models/order.py which had drifted ahead of the migration history.

Revision ID: h1c2d3e4f5g6
Revises: g1b2c3d4e5f6
Create Date: 2026-07-01
"""
import sqlalchemy as sa
from alembic import op

revision = "h1c2d3e4f5g6"
down_revision = "g1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("product_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "orders_product_id_fkey", "orders", "products", ["product_id"], ["id"]
    )
    op.alter_column("orders", "variant_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("disputes", sa.Column("seller_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("disputes", "seller_note")
    op.alter_column("orders", "variant_id", existing_type=sa.Integer(), nullable=False)
    op.drop_constraint("orders_product_id_fkey", "orders", type_="foreignkey")
    op.drop_column("orders", "product_id")
