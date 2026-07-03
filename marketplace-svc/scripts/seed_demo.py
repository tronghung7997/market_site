"""Seed demo data into a running marketplace-svc (:8001) for the frontend.

Run:  marketplace-svc/.venv/bin/python marketplace-svc/scripts/seed_demo.py
"""
import asyncio
import json

import asyncpg
import httpx

BASE = "http://localhost:8001"
DB = "postgresql://marketplace:marketplace@localhost:5432/marketplace"
PW = "DemoPass123!"
ADMIN, SELLER, BUYER = "admin@dxtrade.example.com", "seller@dxtrade.example.com", "buyer@dxtrade.example.com"


# ---------------------------------------------------------------------------
# Provider & Pricing seed definitions
# ---------------------------------------------------------------------------

PROVIDERS = [
    # (name, type, adapter_type, config, priority, fallback_index_or_none)
    ("Mock Provider", "mock", "mock", {}, 1, None),
    ("Seller Pool", "seller_pool", "seller_pool", {}, 2, 0),  # fallback → #0 (Mock Provider)
    ("TopProxy (mock)", "proxy", "mock", {"api_key": "tp_demo_key"}, 3, 0),
    ("ScrapCreators (mock)", "endpoint", "mock", {"api_key": "sc_demo_key"}, 4, 0),
    ("Proxora Team", "manual", "manual", {"channel": "#takedown"}, 5, None),
]

PRICING_CONFIGS = [
    ("account", "fixed", {}),
    ("token", "fixed", {}),
    ("payment", "fixed", {}),
    (
        "proxy",
        "config",
        {
            "base_price": 75000,
            "type_mult": {
                "residential_static": 1.6,
                "residential_rotating": 1.2,
                "datacenter": 1.0,
            },
            "network_mult": {"viettel": 1.0, "fpt": 0.9, "vnpt": 0.85},
            "duration_options": [
                {"days": 7, "label": "7 ngày"},
                {"days": 15, "label": "15 ngày"},
                {"days": 30, "label": "30 ngày"},
            ],
            "volume_tiers": [
                {"min_qty": 5, "discount": 0.05},
                {"min_qty": 20, "discount": 0.10},
            ],
        },
    ),
    (
        "endpoint",
        "credit",
        {
            "credit_price": 10,
            "packages": [
                {"size": 1000, "label": "1.000 requests"},
                {"size": 5000, "label": "5.000 requests"},
                {"size": 10000, "label": "10.000 requests"},
            ],
            "volume_tiers": [
                {"min_qty": 5000, "discount": 0.05},
                {"min_qty": 10000, "discount": 0.10},
            ],
        },
    ),
    (
        "takedown",
        "task",
        {
            "base_price": 500000,
            "platform_mult": {
                "facebook": 1.0,
                "instagram": 1.0,
                "tiktok": 1.2,
                "youtube": 1.5,
            },
            "volume_tiers": [
                {"min_qty": 5, "discount": 0.05},
                {"min_qty": 20, "discount": 0.10},
            ],
        },
    ),
    (
        "cloud",
        "config",
        {
            "base_price": 150000,
            "plan_options": [
                {"key": "basic", "label": "Basic — 2 vCPU / 2GB", "multiplier": 1.0},
                {"key": "standard", "label": "Standard — 4 vCPU / 4GB", "multiplier": 1.87},
                {"key": "pro", "label": "Pro — 8 vCPU / 16GB", "multiplier": 4.33},
            ],
            "duration_options": [
                {"months": 1, "label": "1 tháng", "multiplier": 1.0},
                {"months": 3, "label": "3 tháng", "multiplier": 3.0},
                {"months": 6, "label": "6 tháng", "multiplier": 5.5},
                {"months": 12, "label": "12 tháng", "multiplier": 10.0},
            ],
            "volume_tiers": [],
        },
    ),
]

# New provider-backed products (created via seller API, then linked to providers via SQL)
PROVIDER_PRODUCTS = [
    {
        "cat": "proxies",
        "title": "Proxy dân cư — Trust cao, Anti Detect mạnh",
        "description": (
            "Proxy dân cư (Residential Proxy) giúp bạn ẩn IP thật và sử dụng IP dân cư thật, "
            "tăng độ trust và giảm nguy cơ bị detect. Cấu hình linh hoạt theo loại, mạng và thời hạn."
        ),
        "service_type": "proxy",
        "provider_name": "TopProxy (mock)",
        "features": [
            "IP từ mạng dân cư thật (ISP)",
            "Trust cao — hạn chế checkpoint / khoá tài khoản",
            "Hỗ trợ nhiều quốc gia (US, UK, VN, EU...)",
            "Anti detect mạnh — phù hợp automation",
            "Đổi IP linh hoạt theo quốc gia",
            "Kết nối ổn định — tốc độ tốt",
            "Tương thích tool MMO, bot, automation",
        ],
        "specs": {
            "format": "DOMAIN:PORT:USERNAME:PASS hoặc IP:PORT:USERNAME:PASS",
            "protocol": "HTTP/SOCKS5",
            "provider": "Viettel/FPT/VNPT",
            "bandwidth": "Unlimited Band",
            "countries": "195+ quốc gia",
            "uptime": "99.9%",
        },
        "warranty_text": "Hỗ trợ nếu proxy lỗi / không kết nối được.\nKhông bảo hành nếu sử dụng sai cách / spam quá mức.",
        "highlight_text": "IP sạch — Giống người thật — Hạn chế checkpoint tối đa",
        "sold_count": 892,
        "rating_avg": 4.8,
        "rating_count": 412,
        "pricing_strategy": "config",
        "pricing_params": {
            "base_price": 75000,
            "type_mult": {
                "residential_static": 1.6,
                "residential_rotating": 1.2,
                "datacenter": 1.0,
            },
            "network_mult": {"viettel": 1.0, "fpt": 0.9, "vnpt": 0.85},
            "duration_options": [
                {"days": 7, "label": "7 ngày"},
                {"days": 15, "label": "15 ngày"},
                {"days": 30, "label": "30 ngày"},
            ],
            "volume_tiers": [
                {"min_qty": 5, "discount": 0.05},
                {"min_qty": 20, "discount": 0.10},
            ],
        },
    },
    {
        "cat": "cloud",
        "title": "TikTok Scraper API — Data extraction",
        "description": (
            "API trích xuất dữ liệu TikTok: profile, video, comments, hashtags. "
            "Mua gói credit, mỗi request trừ credit. Phù hợp research, marketing, analytics."
        ),
        "service_type": "endpoint",
        "provider_name": "ScrapCreators (mock)",
        "features": [
            "API access qua REST + JSON",
            "Nhiều endpoint: profile, video, search, hashtag",
            "Rate limit cao — 100 req/s",
            "Credit-based billing — chỉ trả khi dùng",
            "SDK Python / Node.js",
            "Dashboard theo dõi usage real-time",
        ],
        "specs": {
            "format": "REST API + JSON",
            "auth": "API Key (Bearer token)",
            "rate_limit": "100 req/s",
            "endpoints": "profile, video, search, hashtag, comments",
            "sdk": "Python, Node.js",
        },
        "warranty_text": "Credit đã mua không hoàn lại.\nHỗ trợ kỹ thuật qua ticket 24/7.",
        "highlight_text": "API mạnh — Credit linh hoạt — SDK sẵn sàng",
        "sold_count": 67,
        "rating_avg": 4.5,
        "rating_count": 28,
        "pricing_strategy": "credit",
        "pricing_params": {
            "credit_price": 10,
            "packages": [
                {"size": 1000, "label": "1.000 requests"},
                {"size": 5000, "label": "5.000 requests"},
                {"size": 10000, "label": "10.000 requests"},
            ],
            "volume_tiers": [
                {"min_qty": 5000, "discount": 0.05},
                {"min_qty": 10000, "discount": 0.10},
            ],
        },
    },
    {
        "cat": "social",
        "title": "Takedown Facebook / TikTok / YouTube",
        "description": (
            "Dịch vụ takedown nội dung vi phạm trên Facebook, TikTok, YouTube. "
            "Team xử lý 24-72h. Report tracking real-time."
        ),
        "service_type": "takedown",
        "provider_name": "Proxora Team",
        "features": [
            "Hỗ trợ Facebook, Instagram, TikTok, YouTube",
            "SLA 24-72h cho mỗi URL",
            "Report tracking real-time",
            "Team chuyên nghiệp, kinh nghiệm 5+ năm",
            "Tỷ lệ thành công > 85%",
            "Hỗ trợ tư vấn miễn phí trước khi đặt",
        ],
        "specs": {
            "platforms": "Facebook, Instagram, TikTok, YouTube",
            "sla": "24-72h",
            "success_rate": "> 85%",
            "tracking": "Real-time qua dashboard",
        },
        "warranty_text": "Hoàn tiền 100% nếu takedown không thành công.\nKhông hoàn tiền nếu nội dung được phục hồi sau 30 ngày.",
        "highlight_text": "Multi-platform — SLA 24-72h — Tracking real-time",
        "sold_count": 143,
        "rating_avg": 4.6,
        "rating_count": 51,
        "pricing_strategy": "task",
        "pricing_params": {
            "base_price": 500000,
            "platform_mult": {
                "facebook": 1.0,
                "instagram": 1.0,
                "tiktok": 1.2,
                "youtube": 1.5,
            },
            "volume_tiers": [
                {"min_qty": 5, "discount": 0.10},
            ],
        },
    },
    {
        "cat": "cloud",
        "title": "VPS Cloud KVM — SSD NVMe",
        "description": (
            "VPS Cloud hiệu năng cao, SSD NVMe, uptime 99.99%. "
            "Phù hợp chạy bot, tool, web server. Cấu hình linh hoạt theo plan và thời hạn."
        ),
        "service_type": "cloud",
        "provider_name": "TopProxy (mock)",
        "features": [
            "CPU Intel Xeon / AMD EPYC",
            "SSD NVMe tốc độ cao",
            "Bandwidth 1Gbps unmetered",
            "Uptime 99.99% SLA",
            "Root access đầy đủ",
            "Hỗ trợ nhiều OS (Ubuntu, CentOS, Debian, Windows)",
            "Backup tự động hàng ngày",
        ],
        "specs": {
            "cpu": "2-8 vCPU",
            "ram": "2-16 GB",
            "storage": "40-200 GB SSD NVMe",
            "bandwidth": "1Gbps Unmetered",
            "location": "VN, SG, US, EU",
            "os": "Ubuntu, CentOS, Debian, Windows",
        },
        "warranty_text": "SLA uptime 99.99%. Hoàn tiền nếu downtime vượt SLA.\nHỗ trợ kỹ thuật 24/7 qua ticket.",
        "highlight_text": "NVMe tốc độ cao — Root access — Backup tự động",
        "sold_count": 156,
        "rating_avg": 4.9,
        "rating_count": 67,
        "pricing_strategy": "config",
        "pricing_params": {
            "base_price": 150000,
            "plan_options": [
                {"key": "basic", "label": "Basic — 2 vCPU / 2GB", "multiplier": 1.0},
                {"key": "standard", "label": "Standard — 4 vCPU / 4GB", "multiplier": 1.87},
                {"key": "pro", "label": "Pro — 8 vCPU / 16GB", "multiplier": 4.33},
            ],
            "duration_options": [
                {"months": 1, "label": "1 tháng", "multiplier": 1.0},
                {"months": 3, "label": "3 tháng", "multiplier": 3.0},
                {"months": 6, "label": "6 tháng", "multiplier": 5.5},
                {"months": 12, "label": "12 tháng", "multiplier": 10.0},
            ],
            "volume_tiers": [],
        },
    },
]


async def reg(c, email):
    await c.post("/auth/register", json={"email": email, "password": PW})


async def login(c, email):
    r = await c.post("/auth/login", json={"email": email, "password": PW})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def seed_providers(conn) -> dict[str, int]:
    """Insert providers and return {name: id} mapping."""
    provider_ids: dict[str, int] = {}
    for name, ptype, adapter, config, priority, _fb in PROVIDERS:
        # Check if already exists (no unique constraint on name)
        pid = await conn.fetchval("SELECT id FROM providers WHERE name=$1", name)
        if pid is None:
            pid = await conn.fetchval(
                """INSERT INTO providers (name, type, adapter_type, config, priority, is_active)
                   VALUES ($1, $2, $3, $4::jsonb, $5, true)
                   RETURNING id""",
                name, ptype, adapter, json.dumps(config), priority,
            )
        provider_ids[name] = pid

    # Set fallback_provider_id
    for name, _t, _a, _c, _pr, fb_idx in PROVIDERS:
        if fb_idx is not None:
            fb_name = PROVIDERS[fb_idx][0]
            await conn.execute(
                "UPDATE providers SET fallback_provider_id=$1 WHERE id=$2",
                provider_ids[fb_name], provider_ids[name],
            )

    print(f"  Providers   : {len(provider_ids)} seeded")
    return provider_ids


async def seed_pricing_configs(conn) -> int:
    """Insert pricing configs, return count."""
    count = 0
    for stype, strategy, params in PRICING_CONFIGS:
        r = await conn.fetchval(
            """INSERT INTO pricing_configs (service_type, strategy, params, is_active)
               VALUES ($1, $2, $3::jsonb, true)
               ON CONFLICT (service_type) DO UPDATE SET strategy=EXCLUDED.strategy, params=EXCLUDED.params
               RETURNING id""",
            stype, strategy, json.dumps(params),
        )
        if r:
            count += 1
    print(f"  Pricing     : {count} configs seeded")
    return count


async def link_existing_products_to_seller_pool(conn, provider_ids: dict[str, int]):
    """Set provider_id on existing products that have none."""
    sp_id = provider_ids.get("Seller Pool")
    if sp_id:
        updated = await conn.execute(
            "UPDATE products SET provider_id=$1 WHERE provider_id IS NULL", sp_id,
        )
        print(f"  Linked      : existing products → Seller Pool (provider #{sp_id}) [{updated}]")


async def seed_provider_products(
    c: httpx.AsyncClient, conn, seller_headers: dict, flat: dict, provider_ids: dict[str, int],
) -> int:
    """Create provider-backed products via seller API, then link to providers via SQL."""
    created = 0
    for item in PROVIDER_PRODUCTS:
        cat_id = flat.get(item["cat"])
        if not cat_id:
            print(f"  WARN: category '{item['cat']}' not found, skipping '{item['title']}'")
            continue

        # Check if already exists (idempotent) — still link to correct provider
        existing = await conn.fetchval(
            "SELECT id FROM products WHERE title=$1", item["title"],
        )
        if existing:
            prov_id = provider_ids.get(item["provider_name"])
            if prov_id:
                await conn.execute("UPDATE products SET provider_id=$1 WHERE id=$2", prov_id, existing)
            if item.get("pricing_strategy"):
                await conn.execute(
                    "UPDATE products SET pricing_strategy=$1, pricing_params=$2::jsonb WHERE id=$3",
                    item["pricing_strategy"], json.dumps(item["pricing_params"]), existing,
                )
            print(f"  SKIP: '{item['title']}' already exists (id={existing}), linked to provider + pricing set")
            continue

        pr = await c.post("/seller/products", headers=seller_headers, json={
            "category_id": cat_id,
            "title": item["title"],
            "description": item["description"],
            "status": "active",
            "escrow_days": 3,
            "service_type": item["service_type"],
            "features": item.get("features"),
            "specs": item.get("specs"),
            "warranty_text": item.get("warranty_text"),
            "highlight_text": item.get("highlight_text"),
        })
        if pr.status_code != 201:
            print(f"  WARN: could not create '{item['title']}': {pr.status_code} {pr.text}")
            continue
        pid = pr.json()["id"]

        # Link to provider via SQL
        prov_id = provider_ids.get(item["provider_name"])
        if prov_id:
            await conn.execute("UPDATE products SET provider_id=$1 WHERE id=$2", prov_id, pid)

        # Update stats
        if item.get("sold_count") or item.get("rating_avg"):
            await conn.execute(
                "UPDATE products SET sold_count=$1, rating_avg=$2, rating_count=$3 WHERE id=$4",
                item.get("sold_count", 0), item.get("rating_avg"), item.get("rating_count", 0), pid,
            )

        # Set product-level pricing_strategy + pricing_params
        if item.get("pricing_strategy"):
            await conn.execute(
                "UPDATE products SET pricing_strategy=$1, pricing_params=$2::jsonb WHERE id=$3",
                item["pricing_strategy"],
                json.dumps(item["pricing_params"]),
                pid,
            )

        created += 1

    print(f"  Products    : {created} new provider products created")
    return created


async def main():
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as c:
        for e in (ADMIN, SELLER, BUYER):
            await reg(c, e)

        conn = await asyncpg.connect(DB)
        await conn.execute("UPDATE accounts SET roles=$1 WHERE email=$2", ["buyer", "admin"], ADMIN)
        await conn.execute("UPDATE accounts SET roles=$1 WHERE email=$2", ["buyer", "seller"], SELLER)
        buyer_id = await conn.fetchval("SELECT id FROM accounts WHERE email=$1", BUYER)
        await conn.close()

        admin = await login(c, ADMIN)
        seller = await login(c, SELLER)

        cats = {
            "social": {"name": "Mạng xã hội", "slug": "social"},
            "twitter": {"name": "Twitter / X", "slug": "twitter", "parent": "social"},
            "telegram": {"name": "Telegram", "slug": "telegram", "parent": "social"},
            "facebook": {"name": "Facebook", "slug": "facebook", "parent": "social"},
            "proxies": {"name": "Proxy & VPN", "slug": "proxies"},
            "cloud": {"name": "Cloud & Server", "slug": "cloud"},
            "payment": {"name": "Thanh toán & Credit", "slug": "payment"},
        }
        ids: dict[str, int] = {}
        for key, spec in cats.items():
            if "parent" in spec:
                continue
            r = await c.post("/admin/categories", headers=admin, json={"name": spec["name"], "slug": spec["slug"]})
            if r.status_code == 201:
                ids[key] = r.json()["id"]
        for key, spec in cats.items():
            if "parent" not in spec:
                continue
            r = await c.post("/admin/categories", headers=admin,
                             json={"name": spec["name"], "slug": spec["slug"], "parent_id": ids.get(spec["parent"])})
            if r.status_code == 201:
                ids[key] = r.json()["id"]

        tree = (await c.get("/categories")).json()
        flat = {}
        def walk(nodes):
            for n in nodes:
                flat[n["slug"]] = n["id"]
                walk(n.get("children", []))
        walk(tree)

        listings = [
            {
                "cat": "twitter",
                "title": "Twitter cổ 2020+ — Trust cao",
                "description": "Tài khoản Twitter/X cổ từ 2020, đã xác minh email + số điện thoại. Trust score cao, ít bị hạn chế. Phù hợp chạy ads, seeding, automation.",
                "service_type": "account",
                "features": [
                    "Tài khoản cổ từ 2020, trust score cao",
                    "Đã xác minh email + số điện thoại",
                    "Hạn chế checkpoint thấp",
                    "Hỗ trợ nhiều quốc gia (US, UK, VN, EU...)",
                    "Anti-detect mạnh — phù hợp automation",
                    "Tương thích tool MMO, bot, seeding",
                ],
                "specs": {
                    "format": "ID | PASS | MAIL | PASS_MAIL | COOKIE | TOKEN",
                    "platform": "Twitter / X",
                    "age": "2020+",
                    "verified": "Email + Phone",
                    "country": "US, UK, VN, EU",
                },
                "warranty_text": "Hỗ trợ nếu tài khoản lỗi / không đăng nhập được trong 24h đầu.\nKhông bảo hành nếu sử dụng sai cách / spam quá mức.",
                "highlight_text": "IP sạch — Giống người thật — Hạn chế checkpoint tối đa",
                "sold_count": 373,
                "rating_avg": 4.6,
                "rating_count": 159,
                "variants": [
                    ("Email + cookies", 25000, "instant", ["tw1|pass1|mail1@ex.com|cookie1", "tw2|pass2|mail2@ex.com|cookie2", "tw3|pass3|mail3@ex.com|cookie3", "tw4|pass4|mail4@ex.com|cookie4"]),
                    ("Full 2FA + email", 59000, "instant", ["tw2fa1|pass|2fa_key|mail@ex.com", "tw2fa2|pass|2fa_key|mail@ex.com"]),
                    ("Đặt sỉ theo yêu cầu (50+)", 290000, "manual", None),
                ],
            },
            {
                "cat": "facebook",
                "title": "Facebook Clone Việt cổ",
                "description": "Tài khoản Facebook Clone Việt cổ, đã qua thời gian nuôi, có bài viết và bạn bè. Phù hợp chạy ads, seeding, reg acc số lượng lớn.",
                "service_type": "account",
                "features": [
                    "Clone Việt 5-30 posts, 30-1000 bạn bè",
                    "REG từ 6.2025, avatar + cover đầy đủ",
                    "Hotmail trust, full 2FA",
                    "Phù hợp nuôi tài khoản, chạy ads",
                    "Bypass limit, tránh block IP",
                    "Tương thích tool MMO, seeding",
                ],
                "specs": {
                    "format": "ID | PASS | 2FA | MAIL | PASS_MAIL | COOKIE | TOKEN",
                    "platform": "Facebook",
                    "type": "Clone Việt cổ",
                    "friends": "30-1000",
                    "posts": "5-30",
                },
                "warranty_text": "Hỗ trợ nếu tài khoản checkpoint / die trong 24h đầu.\nĐọc kĩ mô tả và lưu ý trước khi mua hàng.",
                "highlight_text": "Clone Việt chất lượng — avatar + cover — bạn bè thật",
                "sold_count": 170,
                "rating_avg": 4.5,
                "rating_count": 108,
                "variants": [
                    ("Clone Việt 5-30 Posts | 30-1000 BB | REG 6.2025 | Avatar | Hotmail | Full 2FA", 35000, "instant",
                     ["fb1|pass|2fa_key|mail1@hotmail.com|cookie1", "fb2|pass|2fa_key|mail2@hotmail.com|cookie2", "fb3|pass|2fa_key|mail3@hotmail.com|cookie3"]),
                    ("ACC Name Việt cổ | UID 10000xxx | Mail SVMail | No2FA", 28000, "instant",
                     ["fb4|pass|mail@svmail.com|cookie", "fb5|pass|mail@svmail.com|cookie"]),
                    ("ACC Việt cổ | 10-50 bạn bè | Hotmail Trust", 42000, "manual", None),
                    ("ACC Việt cổ nhiều bài viết UID 1000 | 0-1000 BB | 2010-2023 | Hotmail+MailKP+2FA", 85000, "manual", None),
                ],
            },
            {
                "cat": "telegram",
                "title": "Telegram số ảo — Session + JSON",
                "description": "Tài khoản Telegram đăng ký bằng số ảo, bàn giao kèm session + JSON. Không spam, sẵn sàng sử dụng.",
                "service_type": "account",
                "features": [
                    "Đăng ký bằng số ảo chất lượng",
                    "Bàn giao session + JSON file",
                    "Không spam, profile sạch",
                    "Phù hợp nuôi group, chạy bot",
                    "Tương thích Telethon, Pyrogram",
                ],
                "specs": {
                    "format": "PHONE | SESSION | JSON",
                    "platform": "Telegram",
                    "type": "Số ảo",
                    "compatibility": "Telethon, Pyrogram, TDLib",
                },
                "warranty_text": "Bảo hành 48h nếu session không hoạt động.\nKhông bảo hành nếu bị report do spam.",
                "highlight_text": "Session sạch — không spam — sẵn sàng sử dụng",
                "sold_count": 521,
                "rating_avg": 4.7,
                "rating_count": 203,
                "variants": [
                    ("Session + JSON", 18000, "instant", ["tg1|+84xxx|session_data1", "tg2|+84xxx|session_data2", "tg3|+84xxx|session_data3", "tg4|+84xxx|session_data4", "tg5|+84xxx|session_data5"]),
                    ("Cổ 1 năm, không spam", 45000, "instant", ["tga1|+1xxx|session_old1"]),
                    ("Bulk 100+ (theo yêu cầu)", 15000, "manual", None),
                ],
            },
            {
                "cat": "payment",
                "title": "Visa ảo / Thẻ thanh toán quốc tế",
                "description": "Thẻ Visa/Mastercard ảo dùng thanh toán dịch vụ quốc tế. Nạp tiền linh hoạt, dùng ngay.",
                "service_type": "payment",
                "features": [
                    "Visa/Mastercard ảo chính hãng",
                    "Nạp tiền linh hoạt từ 5 USD",
                    "Thanh toán Google Ads, Facebook Ads, ChatGPT, Netflix...",
                    "Không cần KYC cho thẻ < 1000 USD",
                    "Cấp phát tức thì",
                ],
                "specs": {
                    "type": "Virtual Card",
                    "network": "Visa / Mastercard",
                    "currency": "USD",
                    "min_load": "5 USD",
                    "max_load": "10,000 USD",
                    "kyc": "Không cần (< 1000 USD)",
                },
                "warranty_text": "Hoàn tiền nếu thẻ không hoạt động.\nKhông bảo hành nếu bị từ chối do merchant block BIN.",
                "highlight_text": "Cấp phát tức thì — Không KYC — Thanh toán mọi nơi",
                "sold_count": 234,
                "rating_avg": 4.4,
                "rating_count": 89,
                "variants": [
                    ("Visa ảo 10 USD", 280000, "instant", ["visa_10usd_001|4242****|12/27|123", "visa_10usd_002|4242****|12/27|456"]),
                    ("Visa ảo 50 USD", 1350000, "instant", ["visa_50usd_001|4242****|12/27|789"]),
                    ("Visa ảo custom (theo yêu cầu)", 0, "manual", None),
                ],
            },
        ]

        for item in listings:
            cat_id = flat.get(item["cat"])
            if not cat_id:
                continue
            pr = await c.post("/seller/products", headers=seller, json={
                "category_id": cat_id,
                "title": item["title"],
                "description": item["description"],
                "status": "active",
                "escrow_days": 3,
                "service_type": item.get("service_type", "other"),
                "features": item.get("features"),
                "specs": item.get("specs"),
                "warranty_text": item.get("warranty_text"),
                "highlight_text": item.get("highlight_text"),
            })
            if pr.status_code != 201:
                print(f"  WARN: could not create '{item['title']}': {pr.status_code} {pr.text}")
                continue
            pid = pr.json()["id"]

            if item.get("sold_count") or item.get("rating_avg"):
                await conn_update(pid, item)

            for name, price, mode, items in item["variants"]:
                vr = await c.post(f"/seller/products/{pid}/variants", headers=seller,
                                  json={"name": name, "price": price, "delivery_mode": mode, "sla_hours": 24})
                if vr.status_code == 201 and items:
                    vid = vr.json()["id"]
                    await c.post(f"/seller/variants/{vid}/resources", headers=seller, json={"items": items})

        await c.post("/wallet/topup", headers=admin, json={"account_id": buyer_id, "amount": 5_000_000})

        # ----- Providers, Pricing Configs, Provider Products -----
        conn = await asyncpg.connect(DB)
        try:
            provider_ids = await seed_providers(conn)
            await seed_pricing_configs(conn)
            await link_existing_products_to_seller_pool(conn, provider_ids)
            await seed_provider_products(c, conn, seller, flat, provider_ids)
        finally:
            await conn.close()

        print("\nSeed complete.")
        print(f"  Buyer login : {BUYER} / {PW}  (balance 5.000.000 ₫)")
        print(f"  Seller login: {SELLER} / {PW}")
        print(f"  Admin login : {ADMIN} / {PW}")
        print(f"  Products    : {len((await c.get('/products')).json())} active listings")


async def conn_update(pid, item):
    conn = await asyncpg.connect(DB)
    await conn.execute(
        "UPDATE products SET sold_count=$1, rating_avg=$2, rating_count=$3 WHERE id=$4",
        item.get("sold_count", 0),
        item.get("rating_avg"),
        item.get("rating_count", 0),
        pid,
    )
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
