"""CLI: keyword landing categories with their SEO copy (backlog F37).

Creates the sub-categories buyers search for — "mua acc Threads", "buy aged
TikTok accounts", "thuê proxy tĩnh", "proxy IPv4", "mua via Facebook",
"thuê API captcha", "mua landing page" — under the parents of the category
tree v2 (scripts/category_tree_v2.sql: accounts, proxies, social-tools,
other), with vi/en names, SEO title/description, short description and
markdown intro (categories.i18n, see categories/service.py).

Data, not pages: each one is an ordinary category. While it has no active
product it is left out of the sitemap and served with noindex (thin content),
so creating them early is safe; move or list products into them in
Admin › Danh mục / Sản phẩm.

Idempotent. An existing slug is never moved or renamed; only its empty copy
fields are filled (``--overwrite`` replaces them). A parent that does not exist
yet is skipped: run category_tree_v2.sql first. ``--create-missing-parents``
creates the v2 roots (social-tools, other) itself — only for a database that
will never run category_tree_v2.sql (its guard refuses existing target slugs).

Default is a DRY-RUN that prints the plan and rolls back; add --apply to commit.

    uv run python scripts/seed_seo_categories.py
    uv run python scripts/seed_seo_categories.py --actor 18 --apply
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # noqa: E402 — run as a plain script

from sqlalchemy import delete, func, select  # noqa: E402

from src.audit.service import log_event  # noqa: E402
from src.categories.schemas import CategoryContentLocale  # noqa: E402
from src.database import SessionLocal  # noqa: E402
from src.i18n.catalog import merge_i18n_locale  # noqa: E402
from src.models.account import Account  # noqa: E402
from src.models.category import Category, CategoryRedirect  # noqa: E402

# Parent slug of the v2 tree → slugs it may still have before v2 is applied.
PARENTS: dict[str, tuple[str, ...]] = {
    "accounts": ("accounts", "social"),
    "proxies": ("proxies",),
    "facebook": ("facebook",),
    "tiktok": ("tiktok",),
    "social-tools": ("social-tools",),
    "other": ("other",),
}
# Roots --create-missing-parents may create (names as in category_tree_v2.sql).
V2_ROOTS = {"social-tools": ("Social Tools", 3), "other": ("Other", 4)}

COPY_FIELDS = ("description", "intro", "seo_title", "seo_description")

LANDINGS: list[dict] = [
    {
        "slug": "threads", "parent": "accounts",
        "vi": {
            "name": "Threads",
            "seo_title": "Mua acc Threads – tài khoản Threads giao tự động | GMMO",
            "seo_description": "Mua acc Threads từ nhiều shop, so sánh giá, định dạng và bảo hành. Gói có sẵn giao tự động; tiền được giữ ở sàn đến khi bạn kiểm tra xong.",
            "description": "Tài khoản Threads (đăng nhập bằng Instagram) để xây kênh, đăng nội dung và quản lý nhiều trang.",
            "intro": (
                "**Acc Threads** được bán theo nhiều phân loại: mới tạo, đã có bài đăng hoặc đã ngâm. Đọc kỹ định dạng "
                "(user|pass|2FA|email) và thời hạn bảo hành của từng shop trước khi mua.\n\n"
                "Threads dùng chung tài khoản với Instagram: nên giữ một proxy cố định cho mỗi tài khoản, đổi mật khẩu "
                "và email khôi phục ngay sau khi nhận."
            ),
        },
        "en": {
            "name": "Threads",
            "seo_title": "Buy Threads accounts – instant delivery | GMMO",
            "seo_description": "Buy Threads accounts from several shops and compare price, format and warranty. In-stock packages deliver instantly; payment is held until you have checked.",
            "description": "Threads accounts (signed in with Instagram) for building channels, posting content and managing several profiles.",
            "intro": (
                "**Threads accounts** come in several types: fresh, with posts, or aged. Check each shop's format "
                "(user|pass|2FA|email) and warranty window before you buy.\n\n"
                "Threads shares the Instagram login: keep one fixed proxy per account and change the password and "
                "recovery email as soon as you receive it."
            ),
        },
    },
    {
        "slug": "aged-tiktok", "parent": "tiktok",
        "vi": {
            "name": "TikTok cổ (aged)",
            "seo_title": "Mua acc TikTok cổ (aged) – tài khoản TikTok lâu năm | GMMO",
            "seo_description": "Acc TikTok cổ theo năm tạo và quốc gia, có hoặc chưa có follow. So sánh giá và bảo hành từng shop; tiền giữ ở sàn đến khi bạn xác nhận.",
            "description": "Tài khoản TikTok đã tạo từ lâu, ghi rõ năm tạo, quốc gia và tình trạng follow trong từng gói.",
            "intro": (
                "**Acc TikTok cổ** là tài khoản tạo từ nhiều năm trước. Tuổi tài khoản giúp ít bị hạn chế lúc đầu, nhưng "
                "không tự mang lại lượt xem: nội dung, thiết bị và IP đăng nhập vẫn quyết định phần lớn.\n\n"
                "Sau khi nhận: đăng nhập trên một thiết bị và proxy cố định, đổi mật khẩu, email, rồi hoạt động nhẹ vài "
                "ngày trước khi đăng nhiều."
            ),
        },
        "en": {
            "name": "Aged TikTok accounts",
            "seo_title": "Buy aged TikTok accounts – old TikTok accounts | GMMO",
            "seo_description": "Aged TikTok accounts by creation year and country, with or without followers. Compare shops and warranties; payment is held until you confirm.",
            "description": "TikTok accounts created years ago, with the creation year, country and follower status stated in each package.",
            "intro": (
                "**Aged TikTok accounts** were created years ago. Age helps an account start with fewer limits, but it "
                "does not bring views by itself: content, device and login IP still matter most.\n\n"
                "After delivery: sign in from one device and one fixed proxy, change the password and email, and keep "
                "activity light for a few days before posting a lot."
            ),
        },
    },
    {
        "slug": "via-facebook", "parent": "facebook",
        "vi": {
            "name": "Via Facebook",
            "seo_title": "Mua via Facebook – via cổ, via ngoại, có 2FA | GMMO",
            "seo_description": "Via Facebook theo quốc gia và năm tạo, có 2FA, email đi kèm. Xem định dạng và bảo hành từng shop; tiền giữ ở sàn đến khi bạn kiểm tra.",
            "description": "Tài khoản Facebook đã có lịch sử sử dụng, dùng cho quảng cáo, quản lý trang và Business Manager.",
            "intro": (
                "**Via Facebook** là tài khoản đã có lịch sử hoạt động, thường được dùng để chạy quảng cáo hoặc làm "
                "quản trị trang. Mỗi shop ghi rõ quốc gia, năm tạo, có 2FA hay không và cách đăng nhập.\n\n"
                "Đăng nhập lần đầu bằng IP cùng quốc gia với via, qua proxy cố định, và không đổi nhiều thông tin trong "
                "ngày đầu để hạn chế checkpoint."
            ),
        },
        "en": {
            "name": "Facebook via accounts",
            "seo_title": "Buy Facebook via accounts – aged, with 2FA | GMMO",
            "seo_description": "Facebook via accounts by country and creation year, with 2FA and email. Check each shop's format and warranty; payment is held until you have checked.",
            "description": "Facebook accounts with a usage history, for advertising, page management and Business Manager.",
            "intro": (
                "**Facebook via accounts** already have an activity history and are mostly used to run ads or manage "
                "pages. Each shop states the country, creation year, 2FA and how to sign in.\n\n"
                "Sign in the first time from an IP in the account's country, through one fixed proxy, and avoid "
                "changing many details on day one to reduce checkpoints."
            ),
        },
    },
    {
        "slug": "static-proxy", "parent": "proxies",
        "vi": {
            "name": "Proxy tĩnh",
            "seo_title": "Thuê proxy tĩnh (static) – IP cố định dân cư, datacenter | GMMO",
            "seo_description": "Thuê proxy tĩnh giữ nguyên một IP suốt gói: dân cư, datacenter, 4G, nhiều quốc gia. Gói theo ngày, tuần, tháng; đa số gói giao tự động.",
            "description": "Proxy giữ một địa chỉ IP cố định trong suốt thời hạn thuê, hợp cho nuôi tài khoản và đăng nhập lâu dài.",
            "intro": (
                "**Proxy tĩnh** giữ nguyên IP trong suốt gói, nên mỗi tài khoản luôn đăng nhập từ một địa chỉ quen "
                "thuộc. Chọn loại IP (dân cư, datacenter, 4G), quốc gia, giao thức HTTP hoặc SOCKS5 và thời hạn.\n\n"
                "Gia hạn ngay trong trang đơn để giữ đúng IP cũ; proxy lỗi được xử lý theo bảo hành của từng shop."
            ),
        },
        "en": {
            "name": "Static proxies",
            "seo_title": "Rent static proxies – fixed residential & datacenter IPs | GMMO",
            "seo_description": "Rent static proxies that keep one IP for the whole plan: residential, datacenter or mobile, several countries. Daily to monthly plans; most deliver instantly.",
            "description": "Proxies that keep one fixed IP address for the whole rental period, suited to long-running accounts.",
            "intro": (
                "**Static proxies** keep the same IP for the whole plan, so each account always signs in from a "
                "familiar address. Pick the IP type (residential, datacenter, mobile), country, HTTP or SOCKS5 and "
                "duration.\n\nRenew from the order page to keep the same IP; faulty proxies are handled under each "
                "shop's warranty."
            ),
        },
    },
    {
        "slug": "ipv4-proxy", "parent": "proxies",
        "vi": {
            "name": "Proxy IPv4",
            "seo_title": "Mua proxy IPv4 riêng – HTTP, SOCKS5, nhiều quốc gia | GMMO",
            "seo_description": "Proxy IPv4 riêng hoặc dùng chung, HTTP và SOCKS5, IP Việt Nam và quốc tế. So sánh giá giữa các shop, gia hạn ngay trong đơn.",
            "description": "Proxy IPv4 riêng hoặc dùng chung, hỗ trợ HTTP/SOCKS5, cho tool, trình duyệt antidetect và quản lý nhiều tài khoản.",
            "intro": (
                "**Proxy IPv4** tương thích với hầu hết website và ứng dụng. Gói *riêng* (dedicated) chỉ một người "
                "dùng mỗi IP; gói *dùng chung* rẻ hơn nhưng IP có thể đã được người khác dùng.\n\n"
                "Kiểm tra quốc gia, giao thức và giới hạn băng thông của gói trước khi mua."
            ),
        },
        "en": {
            "name": "IPv4 proxies",
            "seo_title": "Buy IPv4 proxies – dedicated, HTTP & SOCKS5 | GMMO",
            "seo_description": "Dedicated or shared IPv4 proxies over HTTP and SOCKS5, Vietnamese and international IPs. Compare shops and renew from the order page.",
            "description": "Dedicated or shared IPv4 proxies with HTTP/SOCKS5 for tools, antidetect browsers and multi-account work.",
            "intro": (
                "**IPv4 proxies** work with almost every site and app. A *dedicated* plan gives each IP to one user; "
                "a *shared* plan costs less but the IP may already have been used by others.\n\n"
                "Check the country, protocol and bandwidth limits of a plan before you buy."
            ),
        },
    },
    {
        "slug": "captcha-api", "parent": "social-tools",
        "vi": {
            "name": "API giải captcha",
            "seo_title": "Thuê API giải captcha – reCAPTCHA, hCaptcha, captcha ảnh | GMMO",
            "seo_description": "Gói lượt API giải captcha cho tool và bot: reCAPTCHA, hCaptcha, captcha ảnh. Dùng qua API key, trả theo lượt; xem cách tính lượt của từng gói.",
            "description": "Dịch vụ giải captcha qua API cho công cụ tự động: trả theo gói lượt, dùng bằng API key.",
            "intro": (
                "**API giải captcha** nhận ảnh hoặc tham số captcha từ tool của bạn và trả về kết quả. Mỗi gói ghi rõ "
                "loại captcha hỗ trợ, tốc độ trung bình và cách tính lượt khi giải sai.\n\n"
                "Chỉ dùng cho website và tài khoản bạn được phép tự động hoá."
            ),
        },
        "en": {
            "name": "Captcha solving API",
            "seo_title": "Captcha solving API – reCAPTCHA, hCaptcha, image | GMMO",
            "seo_description": "Captcha solving API request packages for tools and bots: reCAPTCHA, hCaptcha and image captchas. Pay per request with an API key.",
            "description": "Captcha solving over an API for automation tools: request packages, used with an API key.",
            "intro": (
                "A **captcha solving API** takes the captcha image or parameters from your tool and returns the "
                "answer. Each package states the supported captcha types, average speed and how failed solves are "
                "counted.\n\nOnly use it on sites and accounts you are allowed to automate."
            ),
        },
    },
    {
        "slug": "landing-page", "parent": "other",
        "vi": {
            "name": "Landing page",
            "seo_title": "Mua landing page bán hàng – mẫu dựng sẵn, thiết kế riêng | GMMO",
            "seo_description": "Landing page dựng sẵn và thiết kế theo yêu cầu cho bán hàng, chạy quảng cáo, thu lead. Xem demo, phạm vi bàn giao và thời gian làm trước khi đặt.",
            "description": "Landing page bán hàng, thu lead và chạy quảng cáo: mẫu dựng sẵn hoặc thiết kế theo yêu cầu.",
            "intro": (
                "**Landing page** là trang đích một sản phẩm, một lời kêu gọi. Gói *mẫu dựng sẵn* giao nhanh; gói "
                "*thiết kế riêng* làm theo nội dung của bạn trong số ngày shop ghi.\n\n"
                "Hỏi rõ phần bàn giao (mã nguồn, tên miền, hosting, form thu lead) trước khi đặt; tiền được giữ ở sàn "
                "đến khi bạn nhận đủ."
            ),
        },
        "en": {
            "name": "Landing pages",
            "seo_title": "Buy landing pages – ready-made templates & custom design | GMMO",
            "seo_description": "Ready-made and custom landing pages for sales, ads and lead capture. Check the demo, what is handed over and the turnaround before you order.",
            "description": "Landing pages for sales, lead capture and ads: ready-made templates or custom design.",
            "intro": (
                "A **landing page** is one page for one offer. *Template* packages deliver fast; *custom* packages are "
                "built from your content within the days the shop states.\n\n"
                "Ask what is handed over (source, domain, hosting, lead form) before you order; payment is held until "
                "you have received everything."
            ),
        },
    },
]


def _validate() -> None:
    """Fail before touching the database if a copy breaks the API limits."""
    for landing in LANDINGS:
        for locale in ("vi", "en"):
            copy = landing[locale]
            CategoryContentLocale(**{field: copy[field] for field in COPY_FIELDS})
            assert len(copy["name"]) <= 100, (landing["slug"], locale)


async def _parent(db, key: str) -> Category | None:
    for slug in PARENTS[key]:
        cat = await db.scalar(select(Category).where(Category.slug == slug))
        if cat is not None:
            return cat
    return None


def _merge_copy(i18n: dict | None, locale: str, copy: dict, *, overwrite: bool) -> tuple[dict, list[str]]:
    bucket = (i18n or {}).get(locale) or {}
    fields = {
        field: copy[field] for field in (*COPY_FIELDS, "name")
        if overwrite or not bucket.get(field)
    }
    if not fields:
        return dict(i18n or {}), []
    return merge_i18n_locale(i18n, locale, fields), sorted(fields)


async def _run(*, apply: bool, overwrite: bool, create_parents: bool, actor: int | None) -> int:
    _validate()
    async with SessionLocal() as db:
        if actor is not None:
            admin = await db.get(Account, actor)
            if admin is None or "admin" not in {getattr(r, "value", r) for r in (admin.roles or [])}:
                print(f"refusing: account {actor} is not an admin")
                return 1
        created: list[str] = []
        for landing in LANDINGS:
            slug, parent_key = landing["slug"], landing["parent"]
            parent = await _parent(db, parent_key)
            if parent is None and create_parents and parent_key in V2_ROOTS:
                name, order = V2_ROOTS[parent_key]
                parent = Category(name=name, slug=parent_key, parent_id=None, sort_order=order, is_active=True,
                                  i18n={"vi": {"name": name}, "en": {"name": name}})
                db.add(parent)
                await db.flush()
                print(f"  + root {parent_key} (id {parent.id})")
            if parent is None:
                print(f"  skip {slug}: parent '{parent_key}' does not exist yet (run category_tree_v2.sql first)")
                continue
            existing = await db.scalar(select(Category).where(Category.slug == slug))
            if existing is not None:
                i18n = existing.i18n
                filled: list[str] = []
                for locale in ("vi", "en"):
                    i18n, fields = _merge_copy(i18n, locale, landing[locale], overwrite=overwrite)
                    filled += [f"{locale}.{f}" for f in fields]
                where = "" if existing.parent_id == parent.id else f" (left under parent id {existing.parent_id}, not moved)"
                if filled:
                    existing.i18n = i18n
                    print(f"  ~ {slug} (id {existing.id}){where}: filled {', '.join(filled)}")
                else:
                    print(f"  = {slug} (id {existing.id}){where}: nothing to fill")
                continue
            # A live category wins over an old redirect of the same slug.
            await db.execute(delete(CategoryRedirect).where(CategoryRedirect.old_slug == slug))
            last = await db.scalar(select(func.max(Category.sort_order)).where(Category.parent_id == parent.id))
            i18n: dict = {}
            for locale in ("vi", "en"):
                i18n, _ = _merge_copy(i18n, locale, landing[locale], overwrite=True)
            cat = Category(
                name=landing["vi"]["name"], slug=slug, parent_id=parent.id, sort_order=(last or 0) + 1,
                is_active=True, i18n=i18n,
            )
            db.add(cat)
            await db.flush()
            created.append(slug)
            print(f"  + {parent.slug} › {slug} (id {cat.id})")
        if created:
            await log_event(
                db, "info", f"SEO landing categories created: {', '.join(created)}",
                metadata={
                    "event": "category_seo_landings_seeded", "actor_id": actor, "actor_type": "admin" if actor else "system",
                    "subject_type": "category", "created": created, "outcome": "success",
                    "source": "script:seed_seo_categories",
                },
            )
        if apply:
            await db.commit()
            print(f"APPLIED — {len(created)} created")
        else:
            await db.rollback()
            print("DRY-RUN — rolled back. Add --apply to commit.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--overwrite", action="store_true", help="replace copy fields an admin already filled")
    parser.add_argument("--create-missing-parents", action="store_true",
                        help="create the v2 roots social-tools / other (never before category_tree_v2.sql)")
    parser.add_argument("--actor", type=int, default=None, help="admin account id recorded in the audit log")
    args = parser.parse_args()
    sys.exit(asyncio.run(_run(
        apply=args.apply, overwrite=args.overwrite, create_parents=args.create_missing_parents, actor=args.actor,
    )))


if __name__ == "__main__":
    main()
