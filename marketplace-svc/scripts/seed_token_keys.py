"""Seed nguồn Token API (adapter ``token_keys``) + một sản phẩm "Token" bán
theo số lượng dưới seller nội bộ. Idempotent — chạy lại chỉ cập nhật.

Mặc định trỏ vào MOCK (scripts/mock_token_keys.py :9403). Trỏ nguồn thật:

    TOKEN_KEYS_BASE_URL=http://localhost:8500 TOKEN_KEYS_COST=... \\
        uv run python scripts/seed_token_keys.py

TOKEN_KEYS_API_KEY chỉ cần khi nguồn bắt xác thực lúc cấp key.
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from src.adapters.token_keys import SKU, TokenKeysAdapter  # noqa: E402
from src.auth.service import hash_password  # noqa: E402
from src.auth.utils import generate_unique_affiliate_code  # noqa: E402
from src.database import SessionLocal  # noqa: E402
from src.models.account import Account  # noqa: E402
from src.models.category import Category  # noqa: E402
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant  # noqa: E402
from src.models.provider import Provider  # noqa: E402
from src.models.wallet import Wallet  # noqa: E402
from src.security.crypto import encrypt_config  # noqa: E402
from src.suppliers.service import attach_listing  # noqa: E402

BASE_URL = os.environ.get("TOKEN_KEYS_BASE_URL", "").strip() or "http://127.0.0.1:9403"
API_KEY = os.environ.get("TOKEN_KEYS_API_KEY", "").strip()
COST = int(os.environ.get("TOKEN_KEYS_COST", "") or 1000)
PRICE = int(os.environ.get("TOKEN_KEYS_PRICE", "") or 2000)

SELLER_EMAIL = "accstation-seller@dxtrade.example.com"
SELLER_PASSWORD = os.environ.get("TOKEN_KEYS_SELLER_PASSWORD", "").strip() or "DemoPass123!"
PROVIDER_NAME = "Token API"
CATEGORY = ("api-token", "API & Token")
PRODUCT_TITLE = "Token API — mua theo số lượng, giao tức thì"
HIGHLIGHT = "Chọn 1, 5, 10 hay 50 token — thanh toán xong là có danh sách ngay"
PRODUCT_DESCRIPTION = """Cần token để chạy API mà không muốn chờ? Chọn đúng số lượng bạn cần, thanh toán bằng số dư ví, hệ thống **tự động lấy token và giao ngay** — không cần nhắn tin, không phải đợi người bán online.

### Bạn nhận được gì
- Danh sách **access token**, mỗi token một dòng, đánh số #01, #02…
- Xem, sao chép từng dòng hoặc **sao chép tất cả / tải file .txt** chỉ với một chạm
- Token nằm trong mục **Đơn của tôi**, mở lại bất cứ lúc nào

### Mua bao nhiêu cũng được
Chọn nhanh 1 / 5 / 10 / 50 hoặc nhập số lượng tuỳ ý. Mua nhiều hay ít, đơn giá vẫn minh bạch, tổng tiền hiện rõ trước khi bấm thanh toán.

### Tiền của bạn luôn an toàn
- Tiền được **giữ trong ký quỹ** cho tới khi token được giao.
- Nguồn không đủ số lượng? Bạn nhận phần đã có và **phần thiếu được hoàn tự động** vào ví — không cần khiếu nại.
- Không giao được token nào? **Hoàn 100%** ngay lập tức.
- Token nào không dùng được, báo lỗi đúng dòng đó trong thời gian ký quỹ để được xử lý."""
FEATURES = [
    "Giao tự động ngay sau khi thanh toán",
    "Chọn số lượng tuỳ ý: 1 / 5 / 10 / 50 hoặc nhập tay",
    "Mỗi token một dòng — sao chép tất cả hoặc tải .txt",
    "Giao thiếu → hoàn phần thiếu tự động",
    "Khiếu nại theo từng token trong thời gian ký quỹ",
]
SPECS = {
    "Hình thức giao": "Tự động, ngay sau thanh toán",
    "Định dạng": "Mỗi dòng một access token",
    "Số lượng": "Tuỳ chọn theo đơn",
    "Hoàn tiền": "Tự động cho phần không giao được",
}
WARRANTY = (
    "Tiền được giữ ký quỹ tới khi đơn giao xong.\n"
    "Giao thiếu: phần thiếu hoàn tự động vào ví.\n"
    "Token lỗi: báo lỗi theo từng dòng trong thời gian ký quỹ để được đổi hoặc hoàn tiền dòng đó."
)
I18N = {"en": {
    "title": "API tokens — buy any quantity, instant delivery",
    "highlight_text": "Pick 1, 5, 10 or 50 tokens — your list is ready the moment you pay",
    "description": """Need tokens for your API work without waiting? Pick the exact quantity, pay from your wallet, and the system **fetches and delivers your tokens instantly** — no messages, no waiting for the seller to come online.

### What you get
- A list of **access tokens**, one per line, numbered #01, #02…
- Reveal or copy each line, or **copy all / download a .txt** in one tap
- Tokens stay under **My orders** — reopen them any time

### Any quantity
Pick 1 / 5 / 10 / 50 or type your own amount. The unit price and total are shown before you pay.

### Your money is protected
- Payment is **held in escrow** until the tokens are delivered.
- Source short on stock? You get what is available and **the rest is refunded automatically** to your wallet.
- Nothing delivered? **100% refund**, straight away.
- A token doesn't work? Report that exact line during the escrow window.""",
    "features": [
        "Automatic delivery right after payment",
        "Any quantity: 1 / 5 / 10 / 50 or custom",
        "One token per line — copy all or download .txt",
        "Short delivery → the missing part is refunded automatically",
        "Per-token disputes during escrow",
    ],
    "warranty_text": (
        "Payment is held in escrow until delivery.\n"
        "Short delivery: the missing part is refunded to your wallet automatically.\n"
        "Faulty token: report that line during escrow to get it replaced or refunded."
    ),
}}


async def _seller(db) -> int:
    account = await db.scalar(select(Account).where(Account.email == SELLER_EMAIL))
    if account is None:
        account = Account(
            email=SELLER_EMAIL, password_hash=hash_password(SELLER_PASSWORD),
            roles=["buyer", "seller"], affiliate_code=await generate_unique_affiliate_code(db),
        )
        db.add(account)
        await db.flush()
        print(f"+ seller #{account.id}: {SELLER_EMAIL}")
    elif "seller" not in (account.roles or []):
        account.roles = [*(account.roles or []), "seller"]
    account.is_internal = True
    if await db.scalar(select(Wallet).where(Wallet.account_id == account.id)) is None:
        db.add(Wallet(account_id=account.id))
    await db.flush()
    return account.id


async def main() -> None:
    config = {"base_url": BASE_URL, "cost_price": COST, "timeout_seconds": 20, "auto_pause_after_failures": 0}
    if API_KEY:
        config["api_key"] = API_KEY
    print(f"Nguồn token: {BASE_URL}")
    async with SessionLocal() as db:
        seller_id = await _seller(db)

        provider = await db.scalar(select(Provider).where(Provider.name == PROVIDER_NAME))
        if provider is None:
            provider = Provider(
                name=PROVIDER_NAME, type="account", adapter_type="token_keys",
                config=encrypt_config(config), priority=1,
                is_active=True, review_status="approved", seller_id=seller_id,
            )
            db.add(provider)
            await db.flush()
            print(f"+ provider #{provider.id}: {PROVIDER_NAME}")
        else:
            provider.adapter_type = "token_keys"
            provider.config = encrypt_config(config)
            provider.is_active = True
            provider.review_status = "approved"
            provider.seller_id = seller_id
            print(f"= provider #{provider.id}: {PROVIDER_NAME}")

        slug, name = CATEGORY
        category = await db.scalar(select(Category).where(Category.slug == slug))
        if category is None:
            category = Category(name=name, slug=slug)
            db.add(category)
            await db.flush()

        values = dict(
            seller_id=seller_id, category_id=category.id, title=PRODUCT_TITLE,
            description=PRODUCT_DESCRIPTION, highlight_text=HIGHLIGHT, features=FEATURES, specs=SPECS,
            warranty_text=WARRANTY, i18n={
                **I18N, "_primary_locale": "vi",
                "vi": {"title": PRODUCT_TITLE, "description": PRODUCT_DESCRIPTION, "highlight_text": HIGHLIGHT,
                       "features": FEATURES, "specs": SPECS, "warranty_text": WARRANTY},
            }, images={"cover_id": "token"},
            escrow_days=1, status=ProductStatus.active,
            service_type="account", provider_id=provider.id, pricing_strategy="fixed",
        )
        product = await db.scalar(select(Product).where(
            Product.seller_id == seller_id, Product.provider_id == provider.id,
        ).order_by(Product.id).limit(1))
        if product is None:
            product = Product(**values)
            db.add(product)
            await db.flush()
            print(f"+ product #{product.id}: {PRODUCT_TITLE}")
        else:
            for k, v in values.items():
                setattr(product, k, v)

        variant = await db.scalar(select(ProductVariant).where(ProductVariant.product_id == product.id))
        if variant is None:
            variant = ProductVariant(product_id=product.id, name="Token", price=PRICE,
                                     delivery_mode=DeliveryMode.instant, is_active=True)
            db.add(variant)
            await db.flush()
        else:
            variant.price = PRICE
            variant.is_active = True

        # Catalog của nguồn này dựng từ config — không gọi mạng.
        [upstream] = await TokenKeysAdapter(config).fetch_catalog()
        await attach_listing(db, provider_id=provider.id, variant_id=variant.id,
                             external_product_id=SKU, upstream=upstream, external_name="Token")
        await db.commit()
        print(f"  gói #{variant.id} ↔ SKU {SKU} — bán {PRICE:,}đ, giá vốn {COST:,}đ")


if __name__ == "__main__":
    asyncio.run(main())
