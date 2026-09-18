"""supplier_catalog_items — snapshot catalog của nhà cung cấp mua-theo-đơn

Job đồng bộ kéo cả catalog (igbm ~1.5 MB) rồi lưu ở đây để seller/admin duyệt,
tìm, lọc và nhập SKU thành sản phẩm mà không gọi thượng nguồn mỗi lần.

Revision ID: ed1a2b3c4d5e6
Revises: ec1a2b3c4d5e6
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ed1a2b3c4d5e6"
down_revision = "ec1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "supplier_catalog_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider_id", sa.Integer(), sa.ForeignKey("providers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_id", sa.String(length=100), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("name_norm", sa.Text(), nullable=False, server_default=""),
        sa.Column("cost_price", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("min_qty", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("max_qty", sa.Integer(), nullable=True),
        sa.Column("format_hint", sa.Text(), nullable=True),
        sa.Column("group_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("category_path", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("provider_id", "external_id", name="uq_supplier_catalog_items_provider_external"),
    )
    op.create_index("ix_supplier_catalog_items_provider_group", "supplier_catalog_items", ["provider_id", "group_name"])


def downgrade() -> None:
    op.drop_index("ix_supplier_catalog_items_provider_group", table_name="supplier_catalog_items")
    op.drop_table("supplier_catalog_items")
