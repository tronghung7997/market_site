"""Seed seller nội bộ + provider igbm + 10 SKU resell (phase 1, chọn tay
qua igbm Catalog Picker 2026-09-17). Idempotent — chạy lại chỉ cập nhật.

WHITE-LABEL: buyer không được thấy "igbm" ở đâu — tên seller/provider/sản
phẩm trung tính, tên gốc thượng nguồn chỉ nằm ở supplier_listings.external_name
(admin/seller nội bộ). API public che adapter_type qua alias "auto_account"
(src/pricing/router.py).

Mặc định trỏ vào MOCK (scripts/mock_igbm.py :9400). Seed nguồn THẬT:

    IGBM_BASE_URL=https://igbm.net IGBM_API_KEY=... IGBM_SELLER_PASSWORD=... \\
        uv run python scripts/seed_igbm.py

Sau khi seed, chạy một lượt đồng bộ để lấy tồn/giá vốn thật:
    uv run python scripts/seed_igbm.py --sync
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from src.auth.service import hash_password  # noqa: E402
from src.auth.utils import generate_unique_affiliate_code  # noqa: E402
from src.database import SessionLocal  # noqa: E402
from src.models.account import Account  # noqa: E402
from src.models.category import Category  # noqa: E402
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant  # noqa: E402
from src.models.provider import Provider  # noqa: E402
from src.models.wallet import Wallet  # noqa: E402
from src.security.crypto import encrypt_config  # noqa: E402
from src.suppliers.service import attach_listing, sync_provider_listings  # noqa: E402

MOCK_BASE_URL = "http://127.0.0.1:9400"
MOCK_API_KEY = "mock-igbm-key"  # trùng scripts/mock_igbm.py

_ENV_BASE_URL = os.environ.get("IGBM_BASE_URL", "").strip()
_ENV_API_KEY = os.environ.get("IGBM_API_KEY", "").strip()
LIVE = bool(_ENV_BASE_URL or _ENV_API_KEY)
BASE_URL = _ENV_BASE_URL or MOCK_BASE_URL
API_KEY = _ENV_API_KEY or MOCK_API_KEY
RESET_CONFIG = os.environ.get("IGBM_RESET_CONFIG", "").strip().lower() in ("1", "true", "yes")

SELLER_EMAIL = "accstation-seller@dxtrade.example.com"
SELLER_PASSWORD = os.environ.get("IGBM_SELLER_PASSWORD", "").strip() or (None if LIVE else "DemoPass123!")
PROVIDER_NAME = "Acc Station — tài khoản"

PROVIDER_CONFIG = {
    "base_url": BASE_URL, "api_key": API_KEY,
    "timeout_seconds": 30, "low_balance_vnd": 200_000, "min_margin_pct": 10,
}

# Danh mục của mình: slug → (tên, parent slug). Tạo nếu thiếu.
CATEGORIES = {
    "facebook": ("Facebook", "social"),
    "instagram": ("Instagram / Threads", "social"),
    "tiktok": ("TikTok", "social"),
    "twitter": ("Twitter / X", "social"),
    "email": ("Email", None),
    "proxies": ("Proxy & VPN", None),
}

# (igbm_id, category slug, title white-label, tên gói, giá bán, mô tả, bảo hành, gốc)
PRODUCTS = [
    dict(sku="130956", cat="instagram", title="Instagram clone US — reg Android, full 2FA",
         variant="1 tài khoản", price=3000,
         description="Tài khoản Instagram tên Mỹ, đã qua reg BM, xác minh phone/Gmail, tuổi 2–6 tháng, full 2FA.\n\nGiao: ID | Mật khẩu | 2FA | Cookie",
         warranty="Bảo hành đăng nhập lần đầu trong 24 giờ. Không bảo hành sau khi đã đổi thông tin hoặc dính checkpoint do thao tác.",
         external_name="H362. Clone Instagram Name US | Đã Qua Reg BM | Reg Android | Veri Phone/Gmail | FULL 2FA"),
    dict(sku="128630", cat="facebook", title="Facebook clone nuôi tương tác — 1–7 ngày, full 2FA",
         variant="1 tài khoản", price=6000,
         description="Clone tên ngẫu nhiên, reg điện thoại Android, quốc gia ngẫu nhiên, mail TempMail.Plus lấy code được, tuổi 1–7 ngày, full 2FA.\n\nGiao: UID | Password | 2FA | Cookie | Token | Email",
         warranty="Bảo hành đăng nhập lần đầu trong 24 giờ.",
         external_name="H160. Clone Name Random Nuôi Tương Tác Mỗi Ngày | Reg PhoneAndroid | Reg Trên 1-7 Ngày | FULL 2FA"),
    dict(sku="146530", cat="facebook", title="Facebook clone nuôi tương tác — 15–30 ngày, no 2FA",
         variant="1 tài khoản", price=6000,
         description="Clone tên ngẫu nhiên, reg điện thoại Android, quốc gia ngẫu nhiên, mail TempMail.Plus, tuổi 15–30 ngày, không 2FA.\n\nGiao: UID | Password | Cookie | Token | Email",
         warranty="Bảo hành đăng nhập lần đầu trong 24 giờ.",
         external_name="H292. Clone Name Random Nuôi Tương Tác Mỗi Ngày | Reg PhoneAndroid | Reg Trên 15-30 Ngày | NO2FA"),
    dict(sku="128629", cat="facebook", title="Facebook clone nuôi tương tác — 15–30 ngày, full 2FA",
         variant="1 tài khoản", price=6000,
         description="Clone tên ngẫu nhiên, reg điện thoại Android, quốc gia ngẫu nhiên, mail TempMail.Plus, tuổi 15–30 ngày, full 2FA.\n\nGiao: UID | Password | 2FA | Cookie | Token | Email",
         warranty="Bảo hành đăng nhập lần đầu trong 24 giờ.",
         external_name="H159. Clone Name Random Nuôi Tương Tác Mỗi Ngày | Reg PhoneAndroid | Reg Trên 15-30 Ngày | FULL 2FA"),
    dict(sku="145883", cat="facebook", title="Facebook clone ngoại — live ads, zin ads, full 2FA",
         variant="1 tài khoản", price=4000,
         description="Clone ngoại reg mới, live ads, zin ads, xác minh phone, IP ngoại, mail Fvia lấy code được, full 2FA. Phù hợp TUT 2$/250$, reg BM.\n\nGiao: UID | Pass | 2FA | Mail",
         warranty="Bảo hành đăng nhập lần đầu trong 24 giờ.",
         external_name="H30. Clone Ngoại TUT 2$ / 250$ / Reg BM / Spam | Reg New | Live Ads | Zin ADS | FULL 2FA"),
    dict(sku="59917", cat="facebook", title="Facebook clone USA ngâm — live ads, no 2FA",
         variant="1 tài khoản", price=5000,
         description="Clone tên Mỹ đã ngâm, IP ngoại, zin all, live ads, xác minh mail. Phù hợp reg page, chạy TUT ads 2$/5$/10$.\n\nGiao: UID_PASS_COOKIE_TOKEN_MAIL",
         warranty="Bảo hành đăng nhập lần đầu trong 24 giờ.",
         external_name="H14. Clone Name USA Ngâm | Phù Hợp Reg Page + Spam + Chơi Tút ADS | IP NGOẠI | Zin ALL | NO2FA"),
    dict(sku="32749", cat="email", title="Hotmail trusted — có mail khôi phục, live 6–12 tháng",
         variant="1 tài khoản", price=1000,
         description="Hotmail trusted kèm mail khôi phục, tuổi 6–12 tháng, đã reg qua TikTok.\n\nGiao: Mail | Pass | Refresh_Token | Client_id",
         warranty="Bảo hành đăng nhập lần đầu trong 24 giờ.",
         external_name="HOTMAIL TRUSTED + MAIL KHÔI PHỤC | LIVE 6-12 THÁNG | ĐÃ REG QUA TIKTOK"),
    dict(sku="157393", cat="proxies", title="Proxy dân cư Việt Nam — 30 ngày",
         variant="1 proxy / 30 ngày", price=4000,
         description="Proxy dân cư IP Việt Nam, thời hạn 30 ngày kể từ khi giao.",
         warranty="Bảo hành kết nối trong 24 giờ đầu.",
         external_name="Proxy dân cư VN | 30 Ngày"),
    dict(sku="149256", cat="tiktok", title="TikTok clone Hàn Quốc — 2025, mail OAuth2",
         variant="1 tài khoản", price=4000,
         description="Clone TikTok Hàn Quốc tạo năm 2025, kèm mail OAuth2.",
         warranty="Bảo hành đăng nhập lần đầu trong 24 giờ.",
         external_name="Clone Tiktok  South Korea | Năm 2025 | Mail - Oauth2"),
    dict(sku="147083", cat="twitter", title="X / Twitter clone — tuổi trên 5 ngày",
         variant="1 tài khoản", price=3000,
         description="Clone X (Twitter) tuổi trên 5 ngày.",
         warranty="Bảo hành đăng nhập lần đầu trong 24 giờ.",
         external_name="H287. Clone X Twitter | Reg Trên 5 Ngày"),
]


async def _get_or_create_seller(db) -> int:
    account = await db.scalar(select(Account).where(Account.email == SELLER_EMAIL))
    if account is None:
        account = Account(
            email=SELLER_EMAIL, password_hash=hash_password(SELLER_PASSWORD),
            roles=["buyer", "seller"], affiliate_code=await generate_unique_affiliate_code(db),
        )
        db.add(account)
        await db.flush()
        shown = SELLER_PASSWORD if not LIVE else "(theo IGBM_SELLER_PASSWORD)"
        print(f"+ seller #{account.id}: {SELLER_EMAIL} (mật khẩu {shown})")
    else:
        if "seller" not in (account.roles or []):
            account.roles = [*(account.roles or []), "seller"]
        print(f"= seller #{account.id}: {SELLER_EMAIL}")
    # Seller nội bộ: mở khu "Nguồn cung" bên seller (accounts.is_internal).
    account.is_internal = True
    await db.flush()
    # Thiếu ví thì escrow_release/refund 404 và kẹt cả batch job (bài học seed TopProxy).
    if await db.scalar(select(Wallet).where(Wallet.account_id == account.id)) is None:
        db.add(Wallet(account_id=account.id))
        print(f"+ wallet cho seller #{account.id}")
    return account.id


async def _category(db, slug: str) -> Category:
    cat = await db.scalar(select(Category).where(Category.slug == slug))
    if cat is None:
        name, parent_slug = CATEGORIES[slug]
        parent = await db.scalar(select(Category).where(Category.slug == parent_slug)) if parent_slug else None
        cat = Category(name=name, slug=slug, parent_id=parent.id if parent else None)
        db.add(cat)
        await db.flush()
        print(f"+ category #{cat.id}: {name}")
    return cat


def _preflight() -> None:
    if bool(_ENV_BASE_URL) != bool(_ENV_API_KEY):
        sys.exit("IGBM_BASE_URL và IGBM_API_KEY phải cùng có hoặc cùng không.")
    if LIVE and not SELLER_PASSWORD:
        sys.exit(f"Seed nguồn THẬT cần IGBM_SELLER_PASSWORD (mật khẩu cho {SELLER_EMAIL}).")
    print(f"Nguồn hàng: {'THẬT — ' + BASE_URL if LIVE else 'MOCK — ' + MOCK_BASE_URL}")


async def main(sync: bool) -> None:
    _preflight()
    async with SessionLocal() as db:
        seller_id = await _get_or_create_seller(db)

        provider = await db.scalar(select(Provider).where(Provider.name == PROVIDER_NAME))
        if provider is None:
            # seller_id = giao nguồn cho seller nội bộ → seller thấy ở
            # /seller/sources và chỉ sản phẩm của seller đó gắn được.
            provider = Provider(
                name=PROVIDER_NAME, type="account", adapter_type="igbm",
                config=encrypt_config(PROVIDER_CONFIG), priority=1,
                is_active=True, review_status="approved", seller_id=seller_id,
            )
            db.add(provider)
            await db.flush()
            print(f"+ provider #{provider.id}: {provider.name}")
        else:
            provider.adapter_type = "igbm"
            provider.review_status = "approved"
            provider.seller_id = seller_id
            if LIVE or RESET_CONFIG:
                provider.config = encrypt_config(PROVIDER_CONFIG)
                provider.is_active = True
                print(f"= provider #{provider.id}: GHI ĐÈ config → {BASE_URL}")
            else:
                print(f"= provider #{provider.id}: giữ config hiện có")

        for spec in PRODUCTS:
            cat = await _category(db, spec["cat"])
            product = await db.scalar(select(Product).where(
                Product.seller_id == seller_id, Product.title == spec["title"],
            ))
            values = dict(
                seller_id=seller_id, category_id=cat.id, title=spec["title"],
                description=spec["description"], warranty_text=spec["warranty"],
                escrow_days=1, status=ProductStatus.active, service_type="account",
                provider_id=provider.id, pricing_strategy="fixed",
            )
            if product is None:
                product = Product(**values)
                db.add(product)
                await db.flush()
                print(f"+ product #{product.id}: {product.title}")
            else:
                for k, v in values.items():
                    setattr(product, k, v)
                print(f"= product #{product.id}: {product.title}")

            variant = await db.scalar(select(ProductVariant).where(ProductVariant.product_id == product.id))
            if variant is None:
                variant = ProductVariant(
                    product_id=product.id, name=spec["variant"], price=spec["price"],
                    delivery_mode=DeliveryMode.instant, is_active=True,
                )
                db.add(variant)
                await db.flush()
            else:
                variant.name = spec["variant"]
                variant.price = spec["price"]
                variant.is_active = True
            await attach_listing(
                db, provider_id=provider.id, variant_id=variant.id,
                external_product_id=spec["sku"], external_name=spec["external_name"],
            )
            print(f"    gói #{variant.id} ↔ SKU {spec['sku']} — bán {spec['price']:,}đ")

        # Commit trước khi sync: provider_call_logs ghi trên session riêng,
        # provider chưa commit thì FK không thấy → log cảnh báo vô nghĩa.
        await db.commit()
        if sync:
            report = await sync_provider_listings(provider, db)
            await db.commit()
            print(f"~ sync: updated={report.updated} delisted={report.delisted} "
                  f"low_margin={report.low_margin} error={report.error}")

    if not sync:
        print("Seed xong. Tồn kho/giá vốn còn 0 cho tới khi đồng bộ: chạy lại với --sync "
              "(mock: uv run uvicorn scripts.mock_igbm:app --port 9400 trước).")


if __name__ == "__main__":
    asyncio.run(main(sync="--sync" in sys.argv[1:]))
