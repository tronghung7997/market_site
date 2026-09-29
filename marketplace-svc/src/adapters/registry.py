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
- products/service.py, orders/service.py, suppliers/* → external_stock

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
from src.adapters.igbm import IgbmAdapter, validate_igbm_config
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


# Proxies per order. TopProxy buys N static proxies in one call (`soluong`);
# DProxy buys one assignment per call, so N sequential purchases off the
# request path — kept lower. Each proxy is its own line (proxy_allocations.line_no).
PROXY_MAX_PER_ORDER = 50
DPROXY_MAX_PER_ORDER = 20
# TopProxy rotating keys are bought one purchase call per key while the order
# is provisioned, so their default is kept at a size the upstream handles
# comfortably. An admin can set another value per source (config
# `max_per_order`, Sources › Settings), never above the adapter's maximum.
TOPPROXY_XOAY_MAX_PER_ORDER = 10


@dataclass(frozen=True)
class AdapterSpec:
    """Mọi hành vi mà phần còn lại của hệ thống cần biết về một adapter_type.

    - `strategies`: pricing strategy tương thích. None = tương thích mọi
      strategy nhưng chỉ ở mức CẢNH BÁO (mock — dữ liệu giả dev/demo, không
      chặn, chỉ nhắc admin). Xem check_compatibility().
    - `max_quantity_per_order`: None = không giới hạn. Adapter proxy khai số
      proxy tối đa một đơn (mỗi proxy một dòng proxy_allocations) — chặn ngay
      lúc quote, trước khi trừ ví.
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
    - `external_stock`: tồn kho KHÔNG nằm trong bảng `resources` mà là cache
      catalog thượng nguồn (`supplier_listings`, adapters/supplier.py). Hệ quả
      ở ba nơi: storefront đếm tồn từ listing (src/suppliers/stock.py), đơn
      `fixed` đi qua adapter thay vì claim_resources, và job đồng bộ catalog
      (src/suppliers/sync.py) chạy cho provider này. Adapter phải là
      CatalogSupplierAdapter.
    - `gateway_source`: API bán theo gói request qua gateway, quản lý ở
      /admin/sources như một nguồn (gói + giá, endpoint, nhật ký request) —
      src/suppliers/gateway_sources.py. Adapter phải là RealApiAdapter.
    - `proxy_source`: nhà cung cấp PROXY quản lý được ở /admin/sources như một
      "nguồn hàng": có catalog gói (plan) đồng bộ vào `supplier_catalog_items`
      và bảng "sản phẩm đang bán" tính từ pricing `config` của product, nhưng
      KHÔNG có tồn kho thượng nguồn kiểu `external_stock` (đơn vẫn provision
      qua adapter như trước; xem src/suppliers/proxy_sources.py). Adapter phải
      là ProxyPlanCatalog.
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
    # Strategies the per-order maximum applies to; any other strategy of the
    # adapter stays at one unit per order. None = every strategy.
    bulk_strategies: frozenset[str] | None = None
    # Default per-order maximum by provider `config.mode` (e.g. TopProxy
    # rotating keys), below `max_quantity_per_order`.
    max_quantity_by_mode: dict[str, int] | None = None
    gateway_forward: bool = False
    mints_gateway_key: bool = False
    seller_registrable: bool = False
    requires_webhook_secret: bool = False
    external_stock: bool = False
    proxy_source: bool = False
    gateway_source: bool = False
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
    # dòng ProxyAllocation; N proxy một lệnh mua (`soluong`).
    "topproxy": AdapterSpec(
        TopProxyAdapter,
        strategies=frozenset({"config"}),
        max_quantity_per_order=PROXY_MAX_PER_ORDER,
        max_quantity_by_mode={"xoay": TOPPROXY_XOAY_MAX_PER_ORDER},
        gateway_forward=True,
        proxy_source=True,
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
    # buyer chọn. "config" mua N proxy (N lệnh mua, mỗi proxy một dòng);
    # "credit" (pool) vẫn đúng một proxy mỗi đơn.
    "dproxy": AdapterSpec(
        DProxyAdapter,
        strategies=frozenset({"credit", "config"}),
        max_quantity_per_order=DPROXY_MAX_PER_ORDER,
        bulk_strategies=frozenset({"config"}),
        proxy_source=True,
        validate_config=validate_dproxy_config,
    ),
    # Shop tài khoản/key mua-theo-đơn (igbm.net) — xem
    # docs/superpowers/specs/2026-09-17-igbm-reseller-research.md. Gói = một
    # SKU thượng nguồn (supplier_listings) nên chỉ đi với "fixed"; mua N trả N
    # dòng → không giới hạn quantity, tồn kho lấy từ cache catalog.
    "igbm": AdapterSpec(
        IgbmAdapter,
        strategies=frozenset({"fixed"}),
        external_stock=True,
        validate_config=validate_igbm_config,
    ),
    # API tra cứu Facebook của lookup.ghlab.info bán theo gói request qua
    # gateway (/gw/{key}/fb_collect) dưới tên một seller nội bộ — quản lý ở
    # /admin/sources (tab Gói bán / Endpoint / Request / Cài đặt, xem
    # src/suppliers/gateway_sources.py). Cùng RealApiAdapter với
    # scrapecreators; khác ở config: key đi qua ?api_key=, endpoint có method,
    # không tự gọi lại, lỗi nguồn không trừ request của khách.
    "ghlab_fb": AdapterSpec(
        RealApiAdapter,
        strategies=frozenset({"credit"}),
        gateway_forward=True,
        mints_gateway_key=True,
        gateway_source=True,
    ),
}


def catalog_supplier_adapter_types() -> list[str]:
    """Adapter types that buy per order from an upstream catalog (igbm)."""
    return sorted(name for name, spec in ADAPTERS.items() if spec.external_stock)


def default_quantity_for(spec: "AdapterSpec | None", strategy: str | None, config: dict | None = None) -> int | None:
    """The per-order maximum a source has when its admin set none."""
    if spec is None or spec.max_quantity_per_order is None:
        return None
    if spec.bulk_strategies is not None and strategy not in spec.bulk_strategies:
        return 1
    mode = str((config or {}).get("mode") or "").lower()
    return (spec.max_quantity_by_mode or {}).get(mode, spec.max_quantity_per_order)


def max_quantity_for(spec: "AdapterSpec | None", strategy: str | None, config: dict | None = None) -> int | None:
    """Most units one order may buy through this adapter with this strategy
    and this provider config: the source's own `max_per_order` when set,
    else the default for its mode — never above the adapter's maximum."""
    default = default_quantity_for(spec, strategy, config)
    if default is None or default == 1:
        return default
    try:
        override = int((config or {}).get("max_per_order") or 0)
    except (TypeError, ValueError):
        override = 0
    return min(override, spec.max_quantity_per_order) if override >= 1 else default


def get_spec(adapter_type: str | None) -> AdapterSpec | None:
    """None cho adapter_type lạ — caller tự quyết chặn hay bỏ qua (luồng bán
    chặn ở get_adapter; luồng lưu config bỏ qua để không khoá dữ liệu cũ)."""
    return ADAPTERS.get(adapter_type or "")
