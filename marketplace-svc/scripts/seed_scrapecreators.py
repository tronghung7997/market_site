"""Seed 1 provider + 3 sản phẩm ScrapeCreators (Facebook/TikTok/YouTube) —
white-label, request-based, dùng chung 1 API key thật của docs.scrapecreators.com.

WHITE-LABEL: buyer không bao giờ thấy tên ScrapeCreators — provider tên trung
tính (chỉ admin đọc qua adapter_type="scrapecreators"), 3 sản phẩm dùng seller
RIÊNG (không phải seller demo/test dùng chung với các sản phẩm khác trong DB
dev) để gian hàng không bị lẫn với dữ liệu test/mock khác.

Idempotent — chạy lại chỉ cập nhật, không tạo trùng (khớp pattern
scripts/seed_topproxy.py). KHÔNG có "chế độ mock": khác TopProxy, ScrapeCreators
không có server giả lập cục bộ — script này chỉ dùng để seed hàng THẬT lúc go-live,
nên luôn đòi SCRAPECREATORS_API_KEY, không âm thầm rơi về giá trị giả.

Run (backend không cần chạy, ghi thẳng DB):

    cd marketplace-svc
    SCRAPECREATORS_API_KEY=<key thật> \
    SCRAPECREATORS_SELLER_EMAIL=<email seller mới, KHÁC seller demo> \
    SCRAPECREATORS_SELLER_PASSWORD=<mật khẩu seller, >= 8 ký tự> \
    uv run python scripts/seed_scrapecreators.py

    # Ghi đè config provider đã tồn tại (vd xoay API key mới)
    SCRAPECREATORS_RESET_CONFIG=1 SCRAPECREATORS_API_KEY=<key mới> ... uv run python scripts/seed_scrapecreators.py

Biến môi trường:
    SCRAPECREATORS_API_KEY          bắt buộc — key thật docs.scrapecreators.com
    SCRAPECREATORS_SELLER_EMAIL     bắt buộc — seller MỚI, không trùng seller demo/test khác
    SCRAPECREATORS_SELLER_PASSWORD  bắt buộc khi phải tạo mới tài khoản seller (>= 8 ký tự)
    SCRAPECREATORS_BASE_URL         mặc định https://api.scrapecreators.com
    SCRAPECREATORS_RESET_CONFIG=1   ghi đè config provider đã tồn tại (vd xoay key)

Sản phẩm (giá/gói) LUÔN được cập nhật ở mọi lần chạy — chỉ config provider mới
được bảo vệ khỏi ghi đè vô tình (credential thật).
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
from src.models.product import Product, ProductStatus  # noqa: E402
from src.models.provider import Provider  # noqa: E402
from src.models.wallet import Wallet  # noqa: E402
from src.security.crypto import encrypt_config  # noqa: E402

API_KEY = os.environ.get("SCRAPECREATORS_API_KEY", "").strip()
SELLER_EMAIL = os.environ.get("SCRAPECREATORS_SELLER_EMAIL", "").strip()
SELLER_PASSWORD = os.environ.get("SCRAPECREATORS_SELLER_PASSWORD", "").strip()
BASE_URL = os.environ.get("SCRAPECREATORS_BASE_URL", "").strip() or "https://api.scrapecreators.com"
RESET_CONFIG = os.environ.get("SCRAPECREATORS_RESET_CONFIG", "").strip().lower() in ("1", "true", "yes")

PROVIDER_NAME = "ScrapeCreators — Social Data"

ENDPOINT_MAP = {
    "facebook_profile": "/v1/facebook/profile",
    "facebook_posts": "/v1/facebook/profile/posts",
    "facebook_post": "/v1/facebook/post",
    "facebook_post_comments": "/v1/facebook/post/comments",
    "tiktok_profile": "/v1/tiktok/profile",
    "tiktok_video": "/v2/tiktok/video",
    "tiktok_video_comments": "/v1/tiktok/video/comments",
    "tiktok_search_users": "/v1/tiktok/search/users",
    "youtube_channel": "/v1/youtube/channel",
    "youtube_video": "/v1/youtube/video",
    "youtube_video_comments": "/v1/youtube/video/comments",
    "youtube_search": "/v1/youtube/search",
}

_PACKAGES = [
    {"size": 100, "label": "100 requests"},
    {"size": 500, "label": "500 requests"},
    {"size": 1000, "label": "1.000 requests"},
]
# 20đ/request — TẠM. Chưa có số $/credit thật của tài khoản ScrapeCreators
# trong docs công khai — kiểm tra lại tại app.scrapecreators.com trước khi
# công khai bán, không để giá đoán này chạy lâu dài.
_CREDIT_PRICE = 20


def _pricing(endpoint_rates: dict) -> dict:
    return {
        "field_labels": {"package_size": "Số request trong gói"},
        "packages": _PACKAGES,
        "credit_price": _CREDIT_PRICE,
        "default_rate": 1,
        "endpoint_rates": endpoint_rates,
    }


PRODUCTS = [
    {
        "title": "Tra cứu hồ sơ Facebook — API dữ liệu công khai",
        "description": (
            "Tra cứu dữ liệu công khai trên Facebook theo thời gian thực, gọi trực tiếp qua API — "
            "không cần tự dựng scraper, không lo bị chặn IP.\n\n"
            "**Mua gói request → nhận 1 gateway key → gọi 4 endpoint bên dưới qua `/gw/{key}/<endpoint>`.** "
            "Mỗi lần gọi (dù thành công hay không tìm thấy dữ liệu) trừ đúng 1 request trong gói, "
            "không có phụ phí ẩn.\n\n"
            "**Các endpoint hỗ trợ:**\n\n"
            "| Endpoint | Method | Tham số | Trả về |\n"
            "|---|---|---|---|\n"
            "| `facebook_profile` | GET | `url` (link trang/profile Facebook) | Thông tin trang: tên, "
            "ảnh đại diện, ảnh bìa, danh mục, follower, email/SĐT công khai nếu có |\n"
            "| `facebook_posts` | GET | `url` hoặc `pageId` (tối đa 3 bài/lần, dùng `cursor` để lấy tiếp) "
            "| Danh sách bài đăng công khai gần nhất: nội dung, media, số tương tác |\n"
            "| `facebook_post` | GET | `url` (link 1 bài viết/reel cụ thể) | Chi tiết 1 bài viết: nội "
            "dung, video HD/SD, số like/comment/share |\n"
            "| `facebook_post_comments` | GET | `url` (link bài viết, dùng `cursor` để lấy tiếp) | Danh "
            "sách bình luận: nội dung, người bình luận, số reaction chi tiết |\n\n"
            "**Ví dụ gọi:** `GET /gw/{key}/facebook_profile?url=https://www.facebook.com/<tên-trang>`\n\n"
            "Dữ liệu lấy trực tiếp từ Facebook công khai, không qua tài khoản đăng nhập — chỉ truy cập "
            "được thông tin ai cũng xem được không cần đăng nhập."
        ),
        "pricing_params": _pricing({
            "facebook_profile": 1, "facebook_posts": 1, "facebook_post": 1, "facebook_post_comments": 1,
        }),
    },
    {
        "title": "Tra cứu hồ sơ TikTok — API dữ liệu công khai",
        "description": (
            "Tra cứu dữ liệu công khai trên TikTok theo thời gian thực, gọi trực tiếp qua API — "
            "không cần tự dựng scraper, không lo bị chặn IP.\n\n"
            "**Mua gói request → nhận 1 gateway key → gọi 4 endpoint bên dưới qua `/gw/{key}/<endpoint>`.** "
            "Mỗi lần gọi trừ đúng 1 request trong gói, không có phụ phí ẩn.\n\n"
            "**Các endpoint hỗ trợ:**\n\n"
            "| Endpoint | Method | Tham số | Trả về |\n"
            "|---|---|---|---|\n"
            "| `tiktok_profile` | GET | `handle` (username) hoặc `user_id` | Hồ sơ người dùng: tên hiển "
            "thị, avatar, bio, follower/following, tổng lượt tim |\n"
            "| `tiktok_video` | GET | `video_id` | Chi tiết 1 video: lượt xem/thích/bình luận/chia sẻ, "
            "link video không watermark, nhạc nền |\n"
            "| `tiktok_video_comments` | GET | `url` (link video, dùng `cursor` để lấy tiếp) | Danh sách "
            "bình luận: nội dung, người bình luận, số lượt thích, số reply |\n"
            "| `tiktok_search_users` | GET | `query` (dùng `cursor` để lấy tiếp) | Danh sách người dùng "
            "khớp từ khoá: follower, trạng thái xác minh, avatar |\n\n"
            "**Ví dụ gọi:** `GET /gw/{key}/tiktok_profile?handle=<username>`\n\n"
            "Dữ liệu lấy trực tiếp từ TikTok công khai, không qua tài khoản đăng nhập — chỉ truy cập "
            "được thông tin ai cũng xem được không cần đăng nhập."
        ),
        "pricing_params": _pricing({
            "tiktok_profile": 1, "tiktok_video": 1, "tiktok_video_comments": 1, "tiktok_search_users": 1,
        }),
    },
    {
        "title": "Tra cứu kênh YouTube — API dữ liệu công khai",
        "description": (
            "Tra cứu dữ liệu công khai trên YouTube theo thời gian thực, gọi trực tiếp qua API — "
            "không cần tự dựng scraper, không lo bị chặn IP.\n\n"
            "**Mua gói request → nhận 1 gateway key → gọi 4 endpoint bên dưới qua `/gw/{key}/<endpoint>`.** "
            "Mỗi lần gọi trừ đúng 1 request trong gói, không có phụ phí ẩn.\n\n"
            "**Các endpoint hỗ trợ:**\n\n"
            "| Endpoint | Method | Tham số | Trả về |\n"
            "|---|---|---|---|\n"
            "| `youtube_channel` | GET | `handle`, `channelId`, hoặc `url` | Thông tin kênh: tên, avatar, "
            "mô tả, số subscriber, tổng view, ngày tham gia |\n"
            "| `youtube_video` | GET | `url` (link video/short) | Chi tiết video: tiêu đề, mô tả, "
            "view/like/comment, thời lượng, kênh gốc, phụ đề có sẵn |\n"
            "| `youtube_video_comments` | GET | `url` (dùng `continuationToken` để lấy tiếp, "
            "`order=top`/`newest`) | Danh sách bình luận: nội dung, người bình luận, lượt thích, số "
            "reply |\n"
            "| `youtube_search` | GET | `query` (lọc thêm bằng `type`, `uploadDate`, `duration`...) | "
            "Kết quả tìm kiếm: video, kênh, playlist, short khớp từ khoá |\n\n"
            "**Ví dụ gọi:** `GET /gw/{key}/youtube_channel?handle=@<tên-kênh>`\n\n"
            "Dữ liệu lấy trực tiếp từ YouTube công khai, không qua tài khoản đăng nhập — chỉ truy cập "
            "được thông tin ai cũng xem được không cần đăng nhập."
        ),
        "pricing_params": _pricing({
            "youtube_channel": 1, "youtube_video": 1, "youtube_video_comments": 1, "youtube_search": 1,
        }),
    },
]


async def _get_or_create_seller(db) -> int:
    account = await db.scalar(select(Account).where(Account.email == SELLER_EMAIL))
    if account is None:
        account = Account(
            email=SELLER_EMAIL,
            password_hash=hash_password(SELLER_PASSWORD),
            roles=["buyer", "seller"],
            affiliate_code=await generate_unique_affiliate_code(db),
        )
        db.add(account)
        await db.flush()
        print(f"+ seller #{account.id}: {SELLER_EMAIL} (mật khẩu theo SCRAPECREATORS_SELLER_PASSWORD)")
    else:
        if "seller" not in (account.roles or []):
            account.roles = [*(account.roles or []), "seller"]
        print(f"= seller #{account.id}: {SELLER_EMAIL}")

    # register_account() (src/auth/service.py) luôn tạo Wallet song song với
    # Account, nhưng account seed ở đây được insert thẳng nên có thể thiếu —
    # xem cùng lý do trong scripts/seed_topproxy.py::_get_or_create_seller.
    await db.flush()
    wallet = await db.scalar(select(Wallet).where(Wallet.account_id == account.id))
    if wallet is None:
        db.add(Wallet(account_id=account.id))
        print(f"+ wallet cho seller #{account.id} (trước đó thiếu ví)")

    return account.id


def _preflight() -> None:
    missing = []
    if not API_KEY:
        missing.append("SCRAPECREATORS_API_KEY")
    if not SELLER_EMAIL:
        missing.append("SCRAPECREATORS_SELLER_EMAIL")
    if missing:
        sys.exit(
            "Thiếu biến môi trường bắt buộc: " + ", ".join(missing) + "\n"
            "Script này chỉ seed hàng THẬT (không có chế độ mock) — không được để trống."
        )
    if len(SELLER_PASSWORD) < 8 and not SELLER_PASSWORD:
        # Chỉ chặn cứng khi phải TẠO MỚI seller — nếu seller đã tồn tại, giá trị
        # này không được dùng tới (giống seed_topproxy.py).
        print(
            "! SCRAPECREATORS_SELLER_PASSWORD trống hoặc <8 ký tự — chỉ ổn nếu "
            f"seller {SELLER_EMAIL} đã tồn tại từ trước. Nếu chưa, script sẽ lỗi khi tạo account."
        )
    print(
        f"Nguồn hàng: THẬT — {BASE_URL}"
        + (" (ghi đè config provider nếu đã tồn tại)" if RESET_CONFIG else " (giữ config provider hiện có nếu đã tồn tại)")
    )


async def main() -> None:
    _preflight()
    async with SessionLocal() as db:
        category = await db.scalar(select(Category).where(Category.slug == "social"))
        if category is None:
            category = Category(name="Mạng xã hội", slug="social")
            db.add(category)
            await db.flush()

        seller_id = await _get_or_create_seller(db)

        provider_config = {
            "base_url": BASE_URL,
            "api_key": API_KEY,
            "auth_header": "x-api-key",
            "auth_scheme": "",
            "skip_provision_handshake": True,
            "skip_health_probe": True,
            "endpoint_map": ENDPOINT_MAP,
        }
        provider = await db.scalar(select(Provider).where(Provider.name == PROVIDER_NAME))
        if provider is None:
            provider = Provider(
                name=PROVIDER_NAME, type="endpoint", adapter_type="scrapecreators",
                config=encrypt_config(provider_config), priority=1,
                is_active=True, review_status="approved",
            )
            db.add(provider)
            await db.flush()
            print(f"+ provider #{provider.id}: {provider.name}")
        else:
            provider.adapter_type = "scrapecreators"
            provider.is_active = True
            provider.review_status = "approved"
            # KHÔNG ghi đè config đã tồn tại (credential thật) trừ khi
            # RESET_CONFIG=1 — cùng lý do bảo vệ như seed_topproxy.py: chạy
            # lại seed vô tình không được phép âm thầm đổi/xoá API key thật
            # đang chạy.
            if RESET_CONFIG:
                provider.config = encrypt_config(provider_config)
                print(f"= provider #{provider.id}: {provider.name} (GHI ĐÈ config)")
            else:
                print(f"= provider #{provider.id}: {provider.name} (giữ nguyên config hiện có)")

        for spec in PRODUCTS:
            product = await db.scalar(select(Product).where(Product.title == spec["title"]))
            values = dict(
                seller_id=seller_id, category_id=category.id, title=spec["title"],
                description=spec["description"], escrow_days=3,
                status=ProductStatus.active, service_type="endpoint",
                provider_id=provider.id,
                pricing_strategy="credit", pricing_params=spec["pricing_params"],
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

    print(
        "Seed xong. Trước khi mở bán:\n"
        "  1. Test kết nối: POST /admin/providers/{id}/test → health 'healthy' (không tốn credit thật, "
        "xem real_api.py skip_health_probe)\n"
        "  2. Mua 1 đơn nhỏ nhất nghiệm thu trọn vòng (gói 100 request, tốn 1 credit thật/lần gọi)\n"
        "  3. Kiểm tra lại giá 20đ/request (_CREDIT_PRICE) theo số $/credit thật trên "
        "app.scrapecreators.com trước khi công khai bán"
    )


if __name__ == "__main__":
    asyncio.run(main())
