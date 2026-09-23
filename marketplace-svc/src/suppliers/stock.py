"""Tồn kho BÁN ĐƯỢC theo gói — nguồn sự thật duy nhất cho storefront, seller
inventory và tổng quan admin.

Hai nguồn hàng cộng dồn:
- kho upload của seller: Resource `available`, chưa gán đơn, chưa lưu trữ;
- catalog thượng nguồn (provider `external_stock`, adapters/registry.py):
  SupplierListing.upstream_amount lần đồng bộ gần nhất, chặn bởi max/lần mua,
  0 nếu SKU bị gỡ, nguồn đang tạm dừng, hoặc giá bán dưới ngưỡng lãi tối
  thiểu của nguồn (precheck sẽ chặn đơn đó — hiện "hết hàng" ngay trên trang
  thay vì để buyer bấm mua rồi mới báo lỗi).

Một gói thực tế chỉ có một trong hai, nhưng cộng thay vì CASE để không phải
biết gói thuộc loại nào ở tầng SQL.
"""
from sqlalchemy import Float, case, cast, func, literal, or_, select

from src.models.product import ProductVariant
from src.models.provider import Provider
from src.models.resource import Resource, ResourceStatus
from src.models.supplier_listing import SupplierListing
from src.suppliers.service import DEFAULT_MIN_MARGIN_PCT


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
    # Cùng quy tắc với suppliers.service._min_margin_pct: thiếu / 0 / không
    # phải số → mặc định. Ép kiểu có kiểm tra để một giá trị rác trong config
    # không làm hỏng mọi truy vấn storefront.
    raw_margin = Provider.config.op("->>")("min_margin_pct")
    min_margin = func.coalesce(
        func.nullif(
            case((raw_margin.op("~")(r"^\s*[0-9]+(\.[0-9]+)?\s*$"), cast(raw_margin, Float)), else_=None),
            0,
        ),
        literal(DEFAULT_MIN_MARGIN_PCT),
    )
    below_min_margin = (SupplierListing.cost_price > 0) & (
        ProductVariant.price < SupplierListing.cost_price * (1 + min_margin / 100)
    )
    ext = (
        select(
            SupplierListing.variant_id.label("variant_id"),
            case(
                (or_(SupplierListing.sync_error == "delisted", Provider.is_active.is_(False), below_min_margin), 0),
                else_=ext_units,
            ).label("n"),
        )
        .join(ProductVariant, ProductVariant.id == SupplierListing.variant_id)
        .join(Provider, Provider.id == SupplierListing.provider_id)
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
