from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class ProvisionResult:
    success: bool
    data: str | None = None
    resource_id: str | None = None
    metadata: dict | None = field(default_factory=dict)
    # `error`: chi tiết kỹ thuật cho admin log — ĐƯỢC PHÉP nhắc tên nhà cung
    # cấp thượng nguồn, không hiển thị cho buyer.
    error: str | None = None
    # `buyer_message`: lý do WHITE-LABEL cho buyer thấy khi đơn huỷ (không lộ
    # nguồn hàng). None = dùng thông báo huỷ chung ở orders/service.py.
    buyer_message: str | None = None
    # `operational_error`: lỗi VẬN HÀNH — không phải "đơn này xui", mà là thứ
    # sẽ làm MỌI đơn tiếp theo cùng fail (hết Xu, sai API key), hoặc thứ có
    # thể đã tiêu tiền thượng nguồn mà không giao được hàng. orders/service.py
    # bắn alert admin cho các ca này; None = fail thường, chỉ ghi log.
    # Giá trị = severity cho create_alert: "critical" | "warning".
    operational_error: str | None = None
    operational_severity: str = "critical"
    # Nhà cung cấp báo HẾT TIỀN (TopProxy mã 102). Khác mọi lỗi khác ở chỗ:
    # không đơn nào sau đó có thể thành công, nên orders/service tắt provider
    # và bắn cảnh báo cấp provider thay vì cấp đơn (src/providers/credit.py).
    provider_out_of_credit: bool = False


class ProviderAdapter(ABC):
    """Mọi adapter dùng CHUNG một chữ ký khởi tạo — factory (adapters/factory.py)
    nhờ đó instantiate mọi adapter bằng đúng một dòng, không cần if/elif theo
    class. Adapter không dùng tham số nào thì đơn giản là bỏ qua nó.

    Hai class-attr dưới là capability GẮN VỚI IMPLEMENTATION (khác các
    capability gắn với adapter_type, khai ở adapters/registry.py::AdapterSpec):

    - `provisions_over_network`: provision() có gọi HTTP ra ngoài — orders
      service sẽ commit đơn ở `pending` rồi provision ở background task thay vì
      giữ transaction mở suốt thời gian gọi mạng.
    - `provision_has_purchase_side_effect`: provision() TIÊU TIỀN THẬT ở thượng
      nguồn (mua proxy, trừ Xu) — nút "Test provider" ở admin chỉ được
      check_health(), không bao giờ được gọi provision() thử.
    """

    provisions_over_network: bool = False
    provision_has_purchase_side_effect: bool = False

    def __init__(
        self,
        config: dict,
        *,
        db=None,
        provider_id: int | None = None,
        seller_owned: bool = False,
    ):
        self.config = config
        self.db = db
        self.provider_id = provider_id
        self.seller_owned = seller_owned

    @abstractmethod
    async def provision(self, order_id: int, user_config: dict) -> ProvisionResult:
        ...

    @abstractmethod
    async def check_health(self) -> dict:
        ...

    @abstractmethod
    async def get_usage(self, resource_id: str) -> dict | None:
        ...

    @abstractmethod
    async def revoke(self, resource_id: str) -> bool:
        ...


@dataclass(frozen=True)
class ProxyAssignment:
    """One normalized upstream proxy assignment — see
    docs/superpowers/specs/2026-07-22-dproxy-integration.md and
    docs/superpowers/plans/2026-07-22-dproxy-review-fixes.md Blocker 2.
    Adapter-agnostic on purpose: a second rotatable-proxy supplier would
    produce the same shape, so nothing above this needs to know DProxy's
    wire format.

    Represents ANY structurally-valid row from the supplier's inventory,
    not just usable ones — `online` carries the supplier's raw
    active/is_active/proxy-status signal so callers (reconciliation in
    particular) can distinguish "temporarily offline, binding still
    recoverable" from "gone". Use `is_usable()` wherever the old
    always-usable assumption applies (provisioning, buyer-facing summaries)."""

    external_id: str
    proxy_id: str | None
    host: str
    port: int
    username: str
    password: str
    public_ip: str | None
    assigned_at: datetime | None
    expires_at: datetime
    online: bool
    rotation_available: bool
    rotation_mode: str | None
    cooldown_seconds: int | None
    last_rotated_at: datetime | None
    rotate_path: str | None
    country: str | None = None
    # Nhà mạng / loại IP (Viettel, FPT, VNPT…). Tách khỏi `country` vì hai thứ
    # KHÁC NHAU và buyer đọc được sự khác biệt: trước 30/07 các adapter nhét
    # nhà mạng vào `country`, nên bản bàn giao ghi "Quốc gia: FPT" — sai hiển
    # nhiên với người mua. `country` giờ chỉ mang quốc gia thật (DProxy trả về
    # trong inventory), `network` mang nhà mạng.
    network: str | None = None
    proxy_type: str | None = None

    def is_usable(self, *, now: datetime | None = None) -> bool:
        """True only when this assignment can be freshly provisioned or
        delivered right now — online AND not past its own expiry."""
        now = now or datetime.now(timezone.utc)
        return self.online and self.expires_at > now

    def delivered_text(self) -> str:
        """Buyer-safe credential snapshot for Order.delivered_data — never
        includes rotate_path, proxy_id, or anything that isn't needed to
        actually use the proxy."""
        lines = [
            f"Host: {self.host}",
            f"Port: {self.port}",
            f"Username: {self.username}",
            f"Password: {self.password}",
        ]
        if self.public_ip:
            lines.append(f"IP hiện tại: {self.public_ip}")
        if self.network:
            lines.append(f"Nhà mạng: {self.network}")
        if self.country:
            lines.append(f"Quốc gia: {self.country}")
        if self.proxy_type:
            lines.append(f"Loại proxy: {self.proxy_type}")
        lines.append(f"Hết hạn: {self.expires_at.isoformat()}")
        return "\n".join(lines)


class RotatableProxyAdapter(ProviderAdapter, ABC):
    """Capability mixin for adapters backing a purchasable, rotatable proxy
    assignment (src/resources/proxy_service.py, src/resources/proxy_router.py)."""

    @abstractmethod
    async def list_assignments(self) -> list[ProxyAssignment]:
        ...

    @abstractmethod
    async def rotate_assignment(self, external_id: str) -> ProxyAssignment:
        ...
