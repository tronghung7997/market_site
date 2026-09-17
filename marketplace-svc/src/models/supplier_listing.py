from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class SupplierListing(Base):
    """Một gói (ProductVariant) của mình ↔ một SKU trong catalog của nhà cung
    cấp mua-theo-đơn (igbm.net là nguồn đầu tiên; xem
    docs/superpowers/specs/2026-09-17-igbm-reseller-research.md §5.1).

    Vừa là MAPPING (gói nào mua SKU nào ở đâu) vừa là CACHE tồn kho/giá vốn
    thượng nguồn: sản phẩm `fixed` thường đếm bảng `resources` để biết còn
    hàng, nhưng hàng resell không nằm trong kho mình — số tồn là số nhà cung
    cấp báo lần đồng bộ gần nhất (src/suppliers/stock.py gộp hai nguồn).

    Một gói chỉ gắn được một SKU (UNIQUE variant_id); một SKU thượng nguồn có
    thể được nhiều gói bán lại với giá khác nhau.
    """

    __tablename__ = "supplier_listings"
    __table_args__ = (UniqueConstraint("variant_id", name="uq_supplier_listings_variant"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), nullable=False, index=True)
    variant_id: Mapped[int] = mapped_column(ForeignKey("product_variants.id"), nullable=False)
    # Id SKU phía nhà cung cấp — string vì mỗi nguồn một kiểu (igbm: số).
    external_product_id: Mapped[str] = mapped_column(String(100), nullable=False)
    # Tên gốc thượng nguồn — CHỈ admin/seller nội bộ thấy, không bao giờ trả ra
    # storefront (white-label).
    external_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Giá vốn 1 unit (VND) theo lần đồng bộ gần nhất.
    cost_price: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Tồn kho thượng nguồn lần đồng bộ gần nhất. 0 = hết/bị gỡ.
    upstream_amount: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    upstream_min: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    upstream_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Gợi ý định dạng dòng giao hàng do nhà cung cấp ghi (igbm: `description`).
    format_hint: Mapped[str | None] = mapped_column(Text, nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # None = đồng bộ OK. "delisted" = SKU biến mất khỏi catalog; chuỗi khác =
    # lỗi lần sync gần nhất (giữ cache cũ, không xoá).
    sync_error: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Dữ liệu phụ theo từng nguồn (đường dẫn danh mục thượng nguồn…) — không
    # có cột riêng để nguồn thứ hai không phải sửa schema.
    extra: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}", default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    def sellable_units(self) -> int:
        """Số unit tối đa có thể bán ngay theo cache: tồn thượng nguồn, chặn
        thêm bởi max/lần mua của nhà cung cấp."""
        if self.sync_error == "delisted":
            return 0
        n = max(self.upstream_amount, 0)
        if self.upstream_max is not None:
            n = min(n, self.upstream_max)
        return n
