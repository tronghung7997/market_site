"""Sổ đăng ký adapter — NƠI DUY NHẤT khai một adapter_type mới.

Thêm một nhà cung cấp loại mới = viết class adapter (kế thừa ProviderAdapter,
chữ ký khởi tạo chung — xem adapters/base.py) + thêm MỘT entry AdapterSpec ở
đây. Mọi nơi tiêu thụ đọc từ spec thay vì so tên adapter:

- orders/service.py      → max_quantity_per_order, mints_gateway_key
- gateway/router.py      → gateway_forward
- providers/service.py   → requires_webhook_secret, validate_config
- providers/schemas.py   → seller_registrable (SELLER_ALLOWED_ADAPTER_TYPES)
- adapters/compatibility → strategies (ADAPTER_STRATEGY_COMPAT)
- adapters/factory.py    → cls (instantiate)

Capability gắn với IMPLEMENTATION (provisions_over_network,
provision_has_purchase_side_effect) nằm trên class adapter chứ không nằm đây —
chúng mô tả cách class hoạt động, giống nhau cho mọi adapter_type dùng chung
một class (seller_gateway và scrapecreators cùng là RealApiAdapter), và phải
đi theo instance sau khi factory đã đi hết fallback chain.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from src.adapters.base import ProviderAdapter
from src.adapters.dproxy import DProxyAdapter, validate_dproxy_config
from src.adapters.manual import ManualAdapter
from src.adapters.mock import MockAdapter
from src.adapters.real_api import RealApiAdapter
from src.adapters.seller_pool import SellerPoolAdapter
from src.adapters.seller_task_webhook import SellerTaskWebhookAdapter
from src.adapters.topproxy import (
    TopProxyAdapter,
    validate_topproxy_config,
    validate_topproxy_pricing_params,
)


@dataclass(frozen=True)
class AdapterSpec:
    """Mọi hành vi mà phần còn lại của hệ thống cần biết về một adapter_type.

    - `strategies`: pricing strategy tương thích. None = tương thích mọi
      strategy nhưng chỉ ở mức CẢNH BÁO (mock — dữ liệu giả dev/demo, không
      chặn, chỉ nhắc admin). Xem check_compatibility().
    - `max_quantity_per_order`: None = không giới hạn. =1 cho các adapter chỉ
      bind được đúng một allocation mỗi order (UNIQUE(order_id) trên
      proxy_allocations) — chặn ngay lúc quote, trước khi trừ ví.
    - `gateway_forward`: đơn của adapter này được gọi qua /gw/{key}/<endpoint>
      (src/gateway/router.py).
    - `mints_gateway_key`: giao hàng xong tự mint gateway key làm delivered_data
      (buyer không bao giờ thấy base_url/api_key thật — orders/service.py).
    - `seller_registrable`: seller tự đăng ký được (luôn vào hàng chờ admin
      duyệt). False = hạ tầng admin-curate.
    - `requires_webhook_secret`: config bắt buộc có webhook_secret (callback
      HMAC — không có secret thì ai đoán được provider_id + external_task_id
      là giả mạo được kết quả task).
    - `validate_config`: hook async kiểm tra config lúc admin/seller lưu —
      None = không cần kiểm tra gì thêm ngoài schema chung.
    - `validate_pricing_params`: hook đồng bộ (strategy, pricing_params) chạy
      khi gắn/sửa cấu hình giá của SẢN PHẨM. Tầng dưới `strategies`: strategies
      trả lời "adapter này đi được với chiến lược nào", hook này trả lời "các
      GIÁ TRỊ option trong tham số giá có phải thứ adapter nhận không" — vd
      TopProxy nhận `Viettel` chứ không nhận `viettel`. None = adapter chấp
      nhận mọi giá trị (dproxy forward thẳng, seller_gateway do seller tự định
      nghĩa endpoint).
    """

    cls: type[ProviderAdapter]
    strategies: frozenset[str] | None
    max_quantity_per_order: int | None = None
    gateway_forward: bool = False
    mints_gateway_key: bool = False
    seller_registrable: bool = False
    requires_webhook_secret: bool = False
    validate_config: Callable[[dict], Awaitable[None]] | None = None
    validate_pricing_params: Callable[[str | None, dict], None] | None = None


ADAPTERS: dict[str, AdapterSpec] = {
    # Dữ liệu giả cho dev/demo — mọi strategy, mức warn (docs/huong-dan-van-hanh.md).
    "mock": AdapterSpec(MockAdapter, strategies=None),
    # Kho resource seller upload sẵn — cần variant_id nên chỉ đi với "fixed".
    "seller_pool": AdapterSpec(SellerPoolAdapter, strategies=frozenset({"fixed"})),
    # Hàng đợi ServiceTask cho người xử lý tay (/admin/tasks).
    "manual": AdapterSpec(ManualAdapter, strategies=frozenset({"task"})),
    # Adapter thật theo tài liệu topproxy.vn (query-param auth, envelope status
    # số, không idempotency phía supplier) — xem
    # docs/superpowers/specs/2026-07-23-topproxy-research.md. provision đọc
    # type/network/days từ ConfigPricing → chỉ "config". Mỗi order một
    # ProxyAllocation, lệnh mua không idempotent → quantity chặn = 1.
    "topproxy": AdapterSpec(
        TopProxyAdapter,
        strategies=frozenset({"config"}),
        max_quantity_per_order=1,
        gateway_forward=True,
        validate_config=validate_topproxy_config,
        validate_pricing_params=validate_topproxy_pricing_params,
    ),
    # Giữ nguyên "config" trong strategies dù các sản phẩm ScrapeCreators thật
    # (docs.scrapecreators.com) chỉ dùng "credit" — một số test hiện có
    # (test_orders.py::_use_real_api_provider) mượn adapter_type này làm double
    # chung cho "provider RealApiAdapter bất kỳ" với strategy "config", không
    # liên quan gì tới ScrapeCreators thật. Bảo vệ khỏi gọi /provision không
    # tồn tại nằm ở config.skip_provision_handshake cấp PROVIDER (real_api.py),
    # không phải ở đây — thu hẹp strategies không thêm được lớp chặn nào mà
    # chỉ làm gãy test không liên quan.
    # mints_gateway_key=True: buyer không bao giờ thấy base_url/api_key thật
    # của ScrapeCreators, chỉ 1 key nền tảng tự cấp (giống seller_gateway).
    "scrapecreators": AdapterSpec(
        RealApiAdapter,
        strategies=frozenset({"config", "credit"}),
        gateway_forward=True,
        mints_gateway_key=True,
    ),
    # Cùng cơ chế HTTP với scrapecreators (retry, idempotency, ProviderCallLog)
    # — khác ở chỗ base_url trỏ vào backend do SELLER tự khai. Chỉ "credit" vì
    # buyer cần gói quota/units_total để gateway trừ dần theo từng lần gọi
    # (RealApiAdapter.call(), src/gateway/router.py, spec 2026-07-21).
    "seller_gateway": AdapterSpec(
        RealApiAdapter,
        strategies=frozenset({"credit"}),
        gateway_forward=True,
        mints_gateway_key=True,
        seller_registrable=True,
    ),
    # POST task cho backend seller thay vì hàng đợi người xử lý tay.
    "seller_task_webhook": AdapterSpec(
        SellerTaskWebhookAdapter,
        strategies=frozenset({"task"}),
        seller_registrable=True,
        requires_webhook_secret=True,
    ),
    # Admin-curated rotatable proxy — xem
    # docs/superpowers/specs/2026-07-22-dproxy-integration.md.
    # "credit" = mua nhanh từ pool sẵn, "config" = mua mới đúng type/network/days
    # buyer chọn. Mỗi order bind đúng 1 ProxyAllocation → quantity = 1.
    "dproxy": AdapterSpec(
        DProxyAdapter,
        strategies=frozenset({"credit", "config"}),
        max_quantity_per_order=1,
        validate_config=validate_dproxy_config,
    ),
}


def get_spec(adapter_type: str | None) -> AdapterSpec | None:
    """None cho adapter_type lạ — caller tự quyết chặn hay bỏ qua (luồng bán
    chặn ở get_adapter; luồng lưu config bỏ qua để không khoá dữ liệu cũ)."""
    return ADAPTERS.get(adapter_type or "")
