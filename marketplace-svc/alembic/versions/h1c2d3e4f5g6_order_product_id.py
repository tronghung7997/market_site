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
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    orders_columns = {c["name"]: c for c in inspector.get_columns("orders")}
    if "product_id" not in orders_columns:
        op.add_column("orders", sa.Column("product_id", sa.Integer(), nullable=True))

    orders_fks = {fk["name"] for fk in inspector.get_foreign_keys("orders")}
    if "orders_product_id_fkey" not in orders_fks:
        op.create_foreign_key(
            "orders_product_id_fkey", "orders", "products", ["product_id"], ["id"]
        )

    if not orders_columns["variant_id"]["nullable"]:
        op.alter_column("orders", "variant_id", existing_type=sa.Integer(), nullable=True)

    disputes_columns = {c["name"] for c in inspector.get_columns("disputes")}
    if "seller_note" not in disputes_columns:
        op.add_column("disputes", sa.Column("seller_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("disputes", "seller_note")
    op.alter_column("orders", "variant_id", existing_type=sa.Integer(), nullable=False)
    op.drop_constraint("orders_product_id_fkey", "orders", type_="foreignkey")
    op.drop_column("orders", "product_id")
