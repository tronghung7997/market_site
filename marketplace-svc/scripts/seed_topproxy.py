"""Seed dữ liệu cửa hàng mapping catalog TopProxy → sản phẩm marketplace.

WHITE-LABEL: mọi thứ buyer nhìn thấy (tên sản phẩm, seller, mô tả) KHÔNG
được lộ nguồn TopProxy — nguồn chỉ tồn tại ở tầng admin (provider
adapter_type="topproxy", tên provider cũng đặt trung tính vì
/products/{id}/operations chưa có auth guard). API public pricing-options
trả adapter_type qua alias "auto_proxy" (xem _PUBLIC_ADAPTER_ALIASES,
src/pricing/router.py).

Option/giá lấy từ CHÍNH trang topproxy.vn 2026-07-23 (dump <select> +
hàm tinhGia* bằng Playwright — xem
docs/superpowers/specs/2026-07-23-topproxy-research.md §5b):
- Dân cư share: nhà mạng Viettel/FPT/VNPT, vốn bậc thang 800→320 Xu/ngày.
- Datacenter VN: 3 mức chia sẻ (web: Private/Share1/Share3 — apiv2 dùng
  DatacenterA/B/C; mapping A=riêng, B=Share1, C=Share3 CẦN VERIFY với key
  thật trước khi bán thật). Vốn: riêng 2800→1360, Share1 800→320,
  Share3 800→240 Xu/ngày.
- US: 1 khu vực (San Jose), vốn 480→160 Xu/ngày.
- 4G Vinaphone: vốn 2500→600 Xu/ngày, HIỆN -50% — hết KM phải chỉnh giá.
- Key xoay: mua N ngày/tuần/tháng (thoigian), vốn hiện hành 2500/2000/1500
  Xu/ngày theo đơn vị.
- "Dân cư tĩnh Private" (web loai=PRIVATEA) không có trong apiv2 → không seed.

CHÍNH SÁCH GIÁ (kỳ hạn ngắn 3/7/14/30 ngày theo yêu cầu 2026-07-23):
công thức ConfigPricing tuyến tính (base × days/30) còn vốn là bậc thang
giảm dần → đơn giá bán/ngày phải neo theo VỐN Ở KỲ NGẮN NHẤT (3 ngày)
× margin ≥ 50%, chấp nhận margin phình to ở kỳ dài. Muốn giá kỳ dài cạnh
tranh hơn thì cần pricing per-duration (chưa có) hoặc tách sản phẩm.

Tạo (idempotent, tự rename dữ liệu phiên bản cũ):
- 1 seller riêng `pxstation-seller@dxtrade.example.com` (DemoPass123!).
- 2 provider adapter_type=topproxy (mode static/xoay) trỏ vào
  scripts/mock_topproxy.py (:9300); đổi sang thật = sửa base_url + api_key.
- 8 sản phẩm strategy=config. QUY ƯỚC MAPPING: network_mult keys = giá trị
  `loaiproxy` NGUYÊN VĂN của apiv2; type_mult keys = HTTP|SOCKS5;
  duration_options = số ngày. Nhãn tiếng Việt ở *_display, KHÔNG đổi key máy.

Run (backend không cần chạy, ghi thẳng DB):
    cd marketplace-svc
    uv run python scripts/seed_topproxy.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from src.auth.service import hash_password  # noqa: E402
from src.auth.utils import generate_unique_affiliate_code  # noqa: E402
from src.database import SessionLocal  # noqa: E402
from src.models.account import Account  # noqa: E402
from src.models.category import Category  # noqa: E402
from src.models.product import Product, ProductStatus  # noqa: E402
from src.models.provider import Provider  # noqa: E402
from src.security.crypto import encrypt_config  # noqa: E402

MOCK_BASE_URL = "http://127.0.0.1:9300"
MOCK_API_KEY = "mock-topproxy-key"  # trùng scripts/mock_topproxy.py

SELLER_EMAIL = "pxstation-seller@dxtrade.example.com"
LEGACY_SELLER_EMAIL = "topproxy-seller@dxtrade.example.com"
SELLER_PASSWORD = "DemoPass123!"

# Tên provider trung tính (admin nhận diện nguồn qua adapter_type="topproxy")
PROVIDER_STATIC = "PX Station — proxy tĩnh (mock)"
PROVIDER_XOAY = "PX Station — key xoay (mock)"
LEGACY_PROVIDER_NAMES = {
    PROVIDER_STATIC: "TopProxy — Proxy tĩnh (mock)",
    PROVIDER_XOAY: "TopProxy — Key xoay (mock)",
}

PROVIDERS = [
    {
        "name": PROVIDER_STATIC,
        "config": {"base_url": MOCK_BASE_URL, "api_key": MOCK_API_KEY, "mode": "static"},
    },
    {
        "name": PROVIDER_XOAY,
        "config": {
            "base_url": MOCK_BASE_URL, "api_key": MOCK_API_KEY, "mode": "xoay",
            "xoay_get_url": f"{MOCK_BASE_URL}/api/get.php",
        },
    },
]

_STATIC_TYPE = {"HTTP": 1, "SOCKS5": 1}
_D3_7_14_30 = [
    {"days": 3, "label": "3 ngày"},
    {"days": 7, "label": "7 ngày"},
    {"days": 14, "label": "14 ngày"},
    {"days": 30, "label": "30 ngày"},
]
_XOAY_TYPE = {
    "type_mult": {"HTTP": 1},
    "type_display": {"HTTP": "HTTP + SOCKS5 (key trả cả hai)"},
    "network_mult": {"Random": 1},
    "network_display": {"Random": "Chọn nhà mạng mỗi lần lấy IP"},
    "field_labels": {"network": "Nhà mạng", "type": "Giao thức"},
    "volume_tiers": [],
}
_XOAY_SPECS = {
    "Đổi IP": "Không giới hạn, tối thiểu 60s/lần", "IP sống": "15–30 phút",
    "Nhà mạng": "Viettel / VNPT / FPT (chọn mỗi lần lấy)", "Phủ sóng": "45 tỉnh thành",
    "Giao hàng": "Key tự động, kích hoạt ngay",
}

PRODUCTS = [
    {
        "title": "Proxy dân cư tĩnh Việt Nam (share)",
        "legacy_title": "Proxy dân cư tĩnh VN (share) — TopProxy",
        "provider": PROVIDER_STATIC,
        "description": (
            "IPv4 dân cư Việt Nam (hàng share 3 người dùng) — phù hợp MMO, nuôi tài khoản. "
            "Không giới hạn dung lượng. Giao tự động, IP riêng kèm user/pass."
        ),
        "pricing_params": {
            # Vốn 3 ngày = 800 Xu/ngày → bán 1.200đ/ngày (+50% ở kỳ ngắn nhất)
            "base_price": 36000,
            "type_mult": _STATIC_TYPE,
            "network_mult": {"Viettel": 1, "FPT": 1, "VNPT": 1},
            "network_display": {"Viettel": "Viettel", "FPT": "FPT", "VNPT": "VNPT"},
            "field_labels": {"network": "Nhà mạng"},
            "duration_options": _D3_7_14_30,
            "volume_tiers": [],
        },
        "specs": {
            "Loại IP": "Dân cư tĩnh (share 3)", "Băng thông": "Không giới hạn",
            "Giao thức": "HTTP / SOCKS5", "Giao hàng": "Tự động, kích hoạt ngay",
        },
    },
    {
        "title": "Proxy Datacenter Việt Nam",
        "legacy_title": "Proxy Datacenter Việt Nam — TopProxy",
        "provider": PROVIDER_STATIC,
        "description": (
            "IPv4 datacenter đặt tại Việt Nam, độ ổn định cao, phù hợp chơi game / tool. "
            "Chọn mức chia sẻ: dùng riêng, share 1 hoặc share 3."
        ),
        "pricing_params": {
            # Vốn 3 ngày/ngày: riêng 2.800 / Share1 800 / Share3 800 Xu
            # → Share3 bán 1.200đ/ngày (mult 1.0), Share1 1.500 (1.25),
            #   riêng 4.200 (3.5, +50% trên 2.800).
            # apiv2 DatacenterA/B/C ↔ web riêng/Share1/Share3: CẦN VERIFY
            # với key thật (mua thử 1 ngày) trước khi mở bán thật.
            "base_price": 36000,
            "type_mult": _STATIC_TYPE,
            "network_mult": {"DatacenterA": 3.5, "DatacenterB": 1.25, "DatacenterC": 1.0},
            "network_display": {
                "DatacenterA": "Dùng riêng", "DatacenterB": "Share 1", "DatacenterC": "Share 3",
            },
            "field_labels": {"network": "Mức chia sẻ"},
            "duration_options": _D3_7_14_30,
            "volume_tiers": [],
        },
        "specs": {
            "Loại IP": "Datacenter VN", "Băng thông": "Không giới hạn",
            "Giao thức": "HTTP / SOCKS5", "Giao hàng": "Tự động, kích hoạt ngay",
        },
    },
    {
        "title": "Proxy Datacenter US (San Jose)",
        "legacy_title": "Proxy US Datacenter — TopProxy",
        "provider": PROVIDER_STATIC,
        "description": "IPv4 datacenter Mỹ (San Jose, California) — tiết kiệm chi phí, băng thông không giới hạn.",
        "pricing_params": {
            # Vốn 3 ngày = 480 Xu/ngày → bán 800đ/ngày (+67%)
            "base_price": 24000,
            "type_mult": _STATIC_TYPE,
            "network_mult": {"US": 1},
            "network_display": {"US": "San Jose, California (US)"},
            "field_labels": {"network": "Khu vực"},
            "duration_options": _D3_7_14_30,
            "volume_tiers": [],
        },
        "specs": {
            "Loại IP": "Datacenter US", "Khu vực": "San Jose, CA",
            "Giao thức": "HTTP / SOCKS5", "Giao hàng": "Tự động, kích hoạt ngay",
        },
    },
    {
        "title": "Proxy 4G di động Vinaphone",
        "legacy_title": "Proxy 4G Vinaphone — TopProxy",
        "provider": PROVIDER_STATIC,
        "description": (
            "Proxy tạo từ SIM 4G Vinaphone thật — IP di động trust cao. "
            "Giới hạn 4GB/ngày, tự làm mới 00h00 hàng ngày."
        ),
        "pricing_params": {
            # Vốn 3 ngày hiện hành (đang -50%) = 1.250 Xu/ngày → bán 1.900đ/ngày
            # (+52%). HẾT KHUYẾN MÃI PHẢI TĂNG base_price ~2x.
            "base_price": 57000,
            "type_mult": _STATIC_TYPE,
            "network_mult": {"4Gvinaphone": 1},
            "network_display": {"4Gvinaphone": "4G Vinaphone"},
            "field_labels": {"network": "Nhà mạng"},
            "duration_options": _D3_7_14_30,
            "volume_tiers": [],
        },
        "specs": {
            "Loại IP": "4G mobile (SIM thật)", "Dung lượng": "4GB/ngày, reset 00h00",
            "Giao thức": "HTTP / SOCKS5", "Giao hàng": "Tự động, kích hoạt ngay",
        },
    },
    {
        "title": "Gói proxy tĩnh 90–100 IP",
        "legacy_title": "Gói proxy tĩnh 90–100 IP — TopProxy",
        "provider": PROVIDER_STATIC,
        "description": (
            "Gói số lượng lớn 90–100 proxy tĩnh cùng lúc (1 đơn = 1 gói). "
            "Không đổi được proxy trong gói, đổi được bảo mật từng con. Băng thông không giới hạn."
        ),
        "pricing_params": {
            # Vốn 30 ngày: gói nhà mạng 675.000 Xu, gói datacenter 480.000 Xu
            # → bán 945.000 (+40%) / 671.000 (mult 0.71). Gói không bán kỳ ngắn
            # (bảng giá nguồn không công bố bậc dưới 30 ngày).
            "base_price": 945000,
            "type_mult": _STATIC_TYPE,
            "network_mult": {"GoiViettel": 1, "GoiVNPT": 1, "GoiFPT": 1, "GoiDATACENTER": 0.71},
            "network_display": {
                "GoiViettel": "Gói 90 IP Viettel", "GoiVNPT": "Gói 96 IP VNPT",
                "GoiFPT": "Gói 96 IP FPT", "GoiDATACENTER": "Gói 100 IP Datacenter",
            },
            "field_labels": {"network": "Chọn gói"},
            "duration_options": [{"days": 30, "label": "30 ngày"}],
            "volume_tiers": [],
        },
        "specs": {
            "Quy mô": "90–100 IP / gói", "Lưu ý": "Không đổi proxy trong gói",
            "Giao thức": "HTTP / SOCKS5", "Giao hàng": "Tự động, kích hoạt ngay",
        },
    },
    # ------------------------------------------------------------------
    # Key xoay: vốn theo bậc ĐƠN VỊ (ngày 2.500 / tuần 2.000/ngày /
    # tháng 1.500/ngày — hiện hành đã -50%). Tách 3 sản phẩm theo đơn vị
    # để giá tuyến tính khớp bậc; adapter tự chọn endpoint + thoigian.
    # ------------------------------------------------------------------
    {
        "title": "Key proxy xoay IPv4 — theo ngày",
        "provider": PROVIDER_XOAY,
        "description": (
            "Key xoay IP chủ động, mua lẻ theo ngày: không giới hạn số lần đổi IP và băng thông, "
            "đủ 3 nhà mạng Viettel/VNPT/FPT, phủ 45 tỉnh thành. IP sống 15–30 phút, đổi tối thiểu 60 giây."
        ),
        "pricing_params": {
            # Vốn 2.500 Xu/ngày → bán 4.000đ/ngày (+60%). base×(1/30)=4.000
            "base_price": 120000,
            "duration_options": [
                {"days": 1, "label": "24 giờ"},
                {"days": 2, "label": "2 ngày"},
                {"days": 3, "label": "3 ngày"},
                {"days": 5, "label": "5 ngày"},
            ],
            **_XOAY_TYPE,
        },
        "specs": _XOAY_SPECS,
    },
    {
        "title": "Key proxy xoay IPv4 — theo tuần",
        "provider": PROVIDER_XOAY,
        "description": (
            "Key xoay IP chủ động theo tuần (rẻ hơn mua ngày): không giới hạn số lần đổi IP "
            "và băng thông, đủ 3 nhà mạng, phủ 45 tỉnh thành."
        ),
        "pricing_params": {
            # Vốn 14.000 Xu/tuần → bán 21.000đ/tuần (+50%). base×(7/30)=21.000
            "base_price": 90000,
            "duration_options": [
                {"days": 7, "label": "1 tuần"},
                {"days": 14, "label": "2 tuần"},
                {"days": 21, "label": "3 tuần"},
            ],
            **_XOAY_TYPE,
        },
        "specs": _XOAY_SPECS,
    },
    {
        "title": "Key proxy xoay IPv4 — theo tháng",
        "provider": PROVIDER_XOAY,
        "description": (
            "Key xoay IP chủ động theo tháng (đơn giá/ngày rẻ nhất): không giới hạn số lần đổi IP "
            "và băng thông, đủ 3 nhà mạng, phủ 45 tỉnh thành."
        ),
        "pricing_params": {
            # Vốn 45.000 Xu/tháng → bán 68.000đ/tháng (+51%). base×(30/30)=68.000
            "base_price": 68000,
            "duration_options": [
                {"days": 30, "label": "1 tháng"},
                {"days": 60, "label": "2 tháng"},
                {"days": 90, "label": "3 tháng"},
            ],
            **_XOAY_TYPE,
        },
        "specs": _XOAY_SPECS,
    },
]


async def _get_or_create_seller(db) -> int:
    account = await db.scalar(select(Account).where(Account.email == SELLER_EMAIL))
    if account is None:
        # White-label rename: tài khoản seed đợt trước mang email lộ nguồn
        account = await db.scalar(select(Account).where(Account.email == LEGACY_SELLER_EMAIL))
        if account is not None:
            account.email = SELLER_EMAIL
            print(f"~ seller #{account.id}: {LEGACY_SELLER_EMAIL} → {SELLER_EMAIL}")
    if account is None:
        account = Account(
            email=SELLER_EMAIL,
            password_hash=hash_password(SELLER_PASSWORD),
            roles=["buyer", "seller"],
            affiliate_code=await generate_unique_affiliate_code(db),
        )
        db.add(account)
        await db.flush()
        print(f"+ seller #{account.id}: {SELLER_EMAIL} (mật khẩu {SELLER_PASSWORD})")
    else:
        if "seller" not in (account.roles or []):
            account.roles = [*(account.roles or []), "seller"]
        print(f"= seller #{account.id}: {SELLER_EMAIL}")
    return account.id


async def main() -> None:
    async with SessionLocal() as db:
        category = await db.scalar(select(Category).where(Category.slug == "proxies"))
        if category is None:
            category = Category(name="Proxy & VPN", slug="proxies")
            db.add(category)
            await db.flush()

        seller_id = await _get_or_create_seller(db)

        provider_ids: dict[str, int] = {}
        for spec in PROVIDERS:
            provider = await db.scalar(select(Provider).where(Provider.name == spec["name"]))
            if provider is None:
                legacy_name = LEGACY_PROVIDER_NAMES.get(spec["name"])
                if legacy_name:
                    provider = await db.scalar(select(Provider).where(Provider.name == legacy_name))
                    if provider is not None:
                        provider.name = spec["name"]
                        print(f"~ provider #{provider.id}: {legacy_name} → {spec['name']}")
            if provider is None:
                provider = Provider(
                    name=spec["name"], type="proxy", adapter_type="topproxy",
                    config=encrypt_config(spec["config"]), priority=1,
                    is_active=True, review_status="approved",
                )
                db.add(provider)
                await db.flush()
                print(f"+ provider #{provider.id}: {provider.name}")
            else:
                provider.adapter_type = "topproxy"
                provider.config = encrypt_config(spec["config"])
                provider.is_active = True
                provider.review_status = "approved"
                print(f"= provider #{provider.id}: {provider.name} (cập nhật config)")
            provider_ids[spec["name"]] = provider.id

        # Dọn 3 sản phẩm xoay phiên bản đầu (kỳ hạn cố định, đã thay từ 23/07)
        for title in [
            "Key proxy xoay IPv4 — 24 giờ",
            "Key proxy xoay IPv4 — 7 ngày",
            "Key proxy xoay IPv4 — 30 ngày",
        ]:
            legacy = await db.scalar(select(Product).where(Product.title == title))
            if legacy is not None and legacy.status != ProductStatus.paused:
                legacy.status = ProductStatus.paused
                print(f"~ product #{legacy.id}: {title} → paused")

        for spec in PRODUCTS:
            product = await db.scalar(select(Product).where(Product.title == spec["title"]))
            if product is None and spec.get("legacy_title"):
                product = await db.scalar(select(Product).where(Product.title == spec["legacy_title"]))
                if product is not None:
                    print(f"~ product #{product.id}: đổi tên white-label → {spec['title']}")
            values = dict(
                seller_id=seller_id, category_id=category.id, title=spec["title"],
                description=spec["description"], escrow_days=1,
                status=ProductStatus.active, service_type="proxy",
                specs=spec["specs"], provider_id=provider_ids[spec["provider"]],
                pricing_strategy="config", pricing_params=spec["pricing_params"],
            )
            if product is None:
                product = Product(**values)
                db.add(product)
                await db.flush()
                print(f"+ product #{product.id}: {product.title}")
            else:
                for k, v in values.items():
                    setattr(product, k, v)
                print(f"= product #{product.id}: {product.title} (cập nhật)")

        await db.commit()
    print("Seed xong. Chạy mock: uv run uvicorn scripts.mock_topproxy:app --port 9300")


if __name__ == "__main__":
    asyncio.run(main())
