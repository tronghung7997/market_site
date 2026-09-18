"""supplier_listings — gói của mình ↔ SKU nhà cung cấp mua-theo-đơn (igbm.net)

Mapping + cache tồn kho/giá vốn thượng nguồn cho sản phẩm resell; xem
docs/superpowers/specs/2026-09-17-igbm-reseller-research.md §5.1.

Revision ID: ec1a2b3c4d5e6
Revises: eb1a2b3c4d5e6
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ec1a2b3c4d5e6"
down_revision = "eb1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "supplier_listings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider_id", sa.Integer(), sa.ForeignKey("providers.id"), nullable=False),
        sa.Column("variant_id", sa.Integer(), sa.ForeignKey("product_variants.id"), nullable=False),
        sa.Column("external_product_id", sa.String(length=100), nullable=False),
        sa.Column("external_name", sa.Text(), nullable=True),
        sa.Column("cost_price", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("upstream_amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("upstream_min", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("upstream_max", sa.Integer(), nullable=True),
        sa.Column("format_hint", sa.Text(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_error", sa.String(length=255), nullable=True),
        sa.Column("extra", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.UniqueConstraint("variant_id", name="uq_supplier_listings_variant"),
    )
    op.create_index("ix_supplier_listings_provider_id", "supplier_listings", ["provider_id"])


def downgrade() -> None:
    op.drop_index("ix_supplier_listings_provider_id", table_name="supplier_listings")
    op.drop_table("supplier_listings")
