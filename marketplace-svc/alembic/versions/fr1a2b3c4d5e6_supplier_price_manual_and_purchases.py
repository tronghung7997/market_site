"""Supplier listings: manual-price flag; supplier purchase log

Revision ID: fr1a2b3c4d5e6
Revises: fo1a2b3c4d5e6
Create Date: 2026-09-23

- ``supplier_listings.price_manual``: the seller typed this variant's price
  by hand, so the source's price rule (``markup_pct`` in provider config)
  never overwrites it. Existing rows default to false.
- ``supplier_purchases``: one row per order the catalog adapter tried to buy
  upstream — what the source charged (``cost_total``), its transaction id,
  and the failure reason. Feeds the "Đơn mua từ nguồn" tab; nothing else
  reads it, so orders placed before this revision simply have no row.
"""
import sqlalchemy as sa
from alembic import op

revision = "fr1a2b3c4d5e6"
down_revision = "fo1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "supplier_listings",
        sa.Column("price_manual", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "supplier_purchases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("provider_id", sa.Integer(), sa.ForeignKey("providers.id"), nullable=False),
        sa.Column("variant_id", sa.Integer(), sa.ForeignKey("product_variants.id"), nullable=True),
        sa.Column("external_product_id", sa.String(100), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("cost_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("trans_id", sa.String(100), nullable=True),
        sa.Column("ok", sa.Boolean(), nullable=False),
        sa.Column("error", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("order_id", name="uq_supplier_purchases_order"),
    )
    op.create_index("ix_supplier_purchases_provider_created", "supplier_purchases", ["provider_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_supplier_purchases_provider_created", table_name="supplier_purchases")
    op.drop_table("supplier_purchases")
    op.drop_column("supplier_listings", "price_manual")
