from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class UsageRecordStatus(str, PyEnum):
    ok = "ok"
    rejected_quota = "rejected_quota"
    rejected_expired = "rejected_expired"
    # Ghi bởi refund_usage() (usage/service.py) khi một forward qua gateway
    # thất bại — không có dòng này, lịch sử vẫn còn một bản ghi `ok` dù
    # units_used đã được trừ ngược, khiến tổng "ok" không khớp balance thật.
    refunded = "refunded"


class OrderBalance(Base):
    """Số dư request còn lại của một order strategy=credit.

    1-1 với order — chỉ tồn tại từ lúc order chuyển `delivered` (xem
    orders/service.py::_apply_provision_result). `units_total` chốt tại thời
    điểm giao hàng, lấy từ `order.quantity` (đã là package_size do
    CreditPricing._subtotal trả về) — không đổi kể cả nếu seller sau này sửa
    giá sản phẩm, vì đây là số lượng buyer đã trả tiền mua, không phải cấu
    hình sản phẩm hiện tại.
    """

    __tablename__ = "order_balances"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True, nullable=False)
    units_total: Mapped[int] = mapped_column(Integer, nullable=False)
    units_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Frozen from product.pricing_params at delivery time — same reasoning as
    # units_total: what the buyer bought shouldn't drift if the seller edits
    # pricing_params afterward. NULL = every endpoint costs `default_rate`
    # (itself NULL = 1) — the gateway's pre-existing flat-1-unit behavior,
    # unchanged unless a seller actually configures per-endpoint pricing.
    endpoint_rates: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    default_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UsageRecord(Base):
    """Một lần trừ (hoặc thử trừ và bị từ chối) — kể cả bị từ chối cũng ghi lại,
    vì buyer cãi "tôi không hề vượt hạn mức" cần tra lại được lịch sử thật."""

    __tablename__ = "usage_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False, index=True)
    request_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    endpoint: Mapped[str] = mapped_column(String(100), nullable=False)
    units: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[UsageRecordStatus] = mapped_column(Enum(UsageRecordStatus), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
