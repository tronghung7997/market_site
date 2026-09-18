"""Tồn kho BÁN ĐƯỢC theo gói — nguồn sự thật duy nhất cho storefront, seller
inventory và tổng quan admin.

Hai nguồn hàng cộng dồn:
- kho upload của seller: Resource `available`, chưa gán đơn, chưa lưu trữ;
- catalog thượng nguồn (provider `external_stock`, adapters/registry.py):
  SupplierListing.upstream_amount lần đồng bộ gần nhất, chặn bởi max/lần mua,
  0 nếu SKU bị gỡ.

Một gói thực tế chỉ có một trong hai, nhưng cộng thay vì CASE để không phải
biết gói thuộc loại nào ở tầng SQL.
"""
from sqlalchemy import case, func, select

from src.models.product import ProductVariant
from src.models.resource import Resource, ResourceStatus
from src.models.supplier_listing import SupplierListing


def pool_available_condition():
    return (
        Resource.status == ResourceStatus.available,
        Resource.order_id.is_(None),
        Resource.is_archived == False,  # noqa: E712
    )


def sellable_stock_by_variant():
    """Subquery ``(variant_id, stock)`` — một dòng cho MỌI gói (stock 0 nếu
    không có hàng), nên caller join thẳng, không cần coalesce."""
    pool = (
        select(Resource.variant_id.label("variant_id"), func.count(Resource.id).label("n"))
        .where(*pool_available_condition())
        .group_by(Resource.variant_id)
        .subquery()
    )
    ext_units = func.greatest(
        func.least(
            SupplierListing.upstream_amount,
            func.coalesce(SupplierListing.upstream_max, SupplierListing.upstream_amount),
        ),
        0,
    )
    ext = (
        select(
            SupplierListing.variant_id.label("variant_id"),
            case((SupplierListing.sync_error == "delisted", 0), else_=ext_units).label("n"),
        )
        .subquery()
    )
    return (
        select(
            ProductVariant.id.label("variant_id"),
            (func.coalesce(pool.c.n, 0) + func.coalesce(ext.c.n, 0)).label("stock"),
        )
        .outerjoin(pool, pool.c.variant_id == ProductVariant.id)
        .outerjoin(ext, ext.c.variant_id == ProductVariant.id)
        .subquery()
    )
