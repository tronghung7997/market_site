"""Indexes cho các query list sản phẩm + đếm tồn kho

Đi kèm đợt batch hoá list_products/list_seller_products (products/service.py):
sau khi số query đã cố định, phần còn lại là mỗi query phải có index đỡ khi
bảng lớn — Postgres KHÔNG tự tạo index cho cột FK.

- products(status, created_at): GET /products lọc status=active, sort mới nhất.
- products(category_id): lọc theo danh mục (subtree IN).
- products(seller_id): bảng quản lý seller + /products?seller_id.
- product_variants(product_id): gom gói theo IN product_ids.
- resources(variant_id, status): đếm kho available — query chạy nhiều nhất
  của cả list lẫn detail.
- orders(product_id): thống kê đơn/doanh thu GROUP BY của /admin/products và
  /products/{id}/operations.

Revision ID: cg1a2b3c4d5e6
Revises: cf1a2b3c4d5e6
Create Date: 2026-07-30
"""
from alembic import op

revision = "cg1a2b3c4d5e6"
down_revision = "cf1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_products_status_created_at", "products", ["status", "created_at"])
    op.create_index("ix_products_category_id", "products", ["category_id"])
    op.create_index("ix_products_seller_id", "products", ["seller_id"])
    op.create_index("ix_product_variants_product_id", "product_variants", ["product_id"])
    op.create_index("ix_resources_variant_id_status", "resources", ["variant_id", "status"])
    op.create_index("ix_orders_product_id", "orders", ["product_id"])


def downgrade() -> None:
    op.drop_index("ix_orders_product_id", table_name="orders")
    op.drop_index("ix_resources_variant_id_status", table_name="resources")
    op.drop_index("ix_product_variants_product_id", table_name="product_variants")
    op.drop_index("ix_products_seller_id", table_name="products")
    op.drop_index("ix_products_category_id", table_name="products")
    op.drop_index("ix_products_status_created_at", table_name="products")
