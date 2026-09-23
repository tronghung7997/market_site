from datetime import datetime
from enum import Enum as PyEnum

from decimal import Decimal

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.i18n.slug import new_public_key


class ProxyAllocationSource(str, PyEnum):
    # Bound from the account's existing inventory (`GET /api/v1/proxies/user`)
    # — external_id là assignment UUID, reconcile/rotate được qua list.
    pool = "pool"
    # Mua on-demand qua M2M partner-purchase. external_id là assignment UUID
    # khi DProxy trả `proxies[].assignment_id` (live 2026-09-23 — node mua
    # xuất hiện trong /proxies/user dưới đúng id đó, nên reconcile/rotate
    # được); bản ghi cũ hơn giữ ORDER UUID và chỉ hết hạn theo đồng hồ. Thu
    # hồi đi qua partner-dispute (UpstreamRevocation), không phải release.
    purchase = "purchase"


class ProxyAllocationStatus(str, PyEnum):
    allocated = "allocated"
    # Present upstream but temporarily unusable (inactive/offline) — a
    # RECOVERABLE state, distinct from `error`. Reconciliation
    # (src/scheduler.py::dproxy_reconciliation_job) queries allocated+offline
    # together so a proxy that comes back online returns to `allocated`
    # instead of being stuck the moment it flickers. See review fixes
    # docs/superpowers/plans/2026-07-22-dproxy-review-fixes.md Blocker 2.
    offline = "offline"
    expired = "expired"
    released = "released"
    error = "error"


class ProxyAllocation(Base):
    """Exclusive binding between one DProxy upstream assignment and one
    order. See docs/superpowers/specs/2026-07-22-dproxy-integration.md Task 2
    — src/resources/proxy_service.py owns all writes to this table."""

    __tablename__ = "proxy_allocations"
    __table_args__ = (
        # Prevents cross-order double delivery of the same upstream assignment.
        UniqueConstraint("provider_id", "external_id", name="uq_proxy_allocations_provider_external"),
        # One DProxy assignment per order in this phase (see plan Decisions).
        UniqueConstraint("order_id", name="uq_proxy_allocations_order"),
        Index("ix_proxy_allocations_provider_status_expiry", "provider_id", "status", "expires_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), nullable=False)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(100), nullable=False)
    external_proxy_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[ProxyAllocationStatus] = mapped_column(
        Enum(ProxyAllocationStatus), default=ProxyAllocationStatus.allocated,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Metadata only, never authorization — every use must independently
    # re-validate against expected_rotate_path(external_id) (src/adapters/dproxy.py).
    rotate_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    rotation_available: Mapped[bool] = mapped_column(default=False)
    cooldown_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_public_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Consecutive reconciliation runs where this external_id was entirely
    # absent from the supplier's list response — a grace counter so one bad
    # /list response can't flip an allocation straight to `error` (see
    # dproxy_reconciliation_job's MISSING_GRACE_ROUNDS). Reset to 0 the
    # moment the assignment reappears in any state (online, offline, or
    # expired — "present" is what matters here, not usability).
    consecutive_misses: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Nguồn binding — quyết định cách reconcile và thu hồi (xem
    # ProxyAllocationSource). Cột string chứ không phải Enum DB để thêm nguồn
    # mới không cần ALTER TYPE.
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, default=ProxyAllocationSource.pool.value, server_default="pool",
    )
    # IPv4 của BUYER được nhà cung cấp cho phép kết nối tới proxy. Hiện chỉ
    # MỘT IP (API get.php không hiểu danh sách nối dấu phẩy — quan sát thực địa
    # 28/07 đơn #93; dashboard nhà cung cấp có 2 ô nhưng đó là chuyện của web
    # họ). Cột vẫn là String(64) phòng khi sau này xác nhận được format nhiều IP.
    #
    # Chỉ dùng cho key xoay TopProxy. Nhà cung cấp khoá proxy theo IP gọi API:
    # với phương án B1 thì lệnh mua/lấy proxy do SERVER mình gọi, nên mặc định
    # whitelist là IP server và buyer không dùng được proxy họ vừa mua — mà
    # triệu chứng là proxy "im lặng", không có thông báo lỗi nào.
    #
    # NULL = buyer chưa khai báo. Mọi adapter khác để NULL vĩnh viễn.
    whitelist_ips: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Chỉ source=purchase. `partner_order_id` được CHỐT lúc mua: thu hồi sau
    # này phải gửi đúng id đã mua, không tính lại từ prefix hiện hành (đổi
    # DEPLOYMENT_ENVIRONMENT/partner_order_prefix sẽ làm mọi dispute trả 404).
    partner_order_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # `data.order_id` của DProxy — có thể NULL (live trả null).
    upstream_order_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Giá vốn thượng nguồn của lệnh mua (`total_cost_usd`) và quy đổi VND
    # theo tỷ giá hiển thị lúc giao — cho báo cáo lãi, không dùng để tính tiền.
    upstream_cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    upstream_cost_vnd: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Loại proxy buyer thấy (src/proxies/kinds.py), CHỐT lúc giao từ gói đã
    # bán — đổi cấu hình sản phẩm sau đó không đổi loại của proxy đã giao.
    # `rotation_kind` chỉ lưu "rotating_key"; static/rotating tính lúc đọc từ
    # `rotation_available` (node thật, reconciliation cập nhật).
    ip_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    rotation_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    protocol: Mapped[str | None] = mapped_column(String(8), nullable=True)
    network_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    country: Mapped[str | None] = mapped_column(String(8), nullable=True)
    plan_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    plan_label: Mapped[str | None] = mapped_column(String(160), nullable=True)
    # Ghi chú riêng của buyer trên dashboard /proxies.
    note: Mapped[str] = mapped_column(String(200), nullable=False, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )


class UpstreamRevocationStatus(str, PyEnum):
    pending = "pending"
    done = "done"
    failed = "failed"


class UpstreamRevocation(Base):
    """Lệnh thu hồi thượng nguồn (DProxy partner-dispute) chờ gửi SAU commit.

    Vì sao là outbox: hoàn tiền buyer chạy trong transaction đang khoá dòng
    order/dispute; gọi HTTP ở đó (timeout 30s × 3) giữ lock + connection, và
    nếu transaction hoàn tiền rollback sau khi DProxy đã thu node thì buyer
    mất proxy mà không được hoàn. Hàng đợi được ghi CÙNG transaction hoàn
    tiền nên chỉ tồn tại khi tiền đã về ví buyer; job
    `upstream_revocation_job` gửi và thử lại, hết lượt thì báo admin.
    """

    __tablename__ = "upstream_revocations"
    __table_args__ = (
        # Một đơn thượng nguồn chỉ thu hồi một lần dù nhiều đường cùng xếp lệnh.
        UniqueConstraint("provider_id", "partner_order_id", name="uq_upstream_revocations_partner_order"),
        Index("ix_upstream_revocations_status_next", "status", "next_attempt_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), nullable=False)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), nullable=False)
    partner_order_id: Mapped[str] = mapped_column(String(100), nullable=False)
    reason: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=UpstreamRevocationStatus.pending.value, server_default="pending",
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Kết quả lần gửi cuối: revoked | not_found | rejected | error.
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(255), nullable=True)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProxyTag(Base):
    """Tag của BUYER để gom proxy trên dashboard /proxies (2–500 proxy/buyer).
    `public_key` là id trên API — không lộ row id."""

    __tablename__ = "proxy_tags"
    __table_args__ = (
        UniqueConstraint("account_id", "name", name="uq_proxy_tags_account_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    public_key: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, default=new_public_key)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    tone: Mapped[str] = mapped_column(String(12), nullable=False, default="neutral", server_default="neutral")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProxyAllocationTag(Base):
    __tablename__ = "proxy_allocation_tags"

    allocation_id: Mapped[int] = mapped_column(
        ForeignKey("proxy_allocations.id", ondelete="CASCADE"), primary_key=True,
    )
    tag_id: Mapped[int] = mapped_column(ForeignKey("proxy_tags.id", ondelete="CASCADE"), primary_key=True, index=True)
