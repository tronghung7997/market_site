"""Human-reviewed English catalog copy for known seed / demo listings.

Keyed by:
- category ``slug``
- product ``title`` (legacy Vietnamese scalar, stable match for seed data)
- variant ``name`` under a product title

Used by ``scripts/backfill_catalog_en.py`` and unit tests. Not applied
automatically on every request — write once into ``i18n.en``.
"""

from __future__ import annotations

# slug → English name
CATEGORY_EN: dict[str, str] = {
    "social": "Social networks",
    "twitter": "Twitter / X",
    "telegram": "Telegram",
    "facebook": "Facebook",
    "proxies": "Proxy & VPN",
    "cloud": "Cloud & Server",
    "payment": "Payments & Credit",
}


# Exact legacy title → EN fields
PRODUCT_EN: dict[str, dict] = {
    "Proxy dân cư — Trust cao, Anti Detect mạnh": {
        "title": "Residential Proxy — High Trust, Strong Anti-Detect",
        "description": (
            "Residential proxies help you hide your real IP and use genuine residential "
            "IPs, improving trust and reducing detection risk. Flexible configuration by "
            "type, network, and duration."
        ),
        "features": [
            "Real residential ISP IPs",
            "High trust — fewer checkpoints / account locks",
            "Multi-country support (US, UK, VN, EU…)",
            "Strong anti-detect for automation",
            "Flexible IP rotation by country",
            "Stable connections — solid speed",
            "Works with MMO tools, bots, and automation",
        ],
        "warranty_text": (
            "Support if the proxy fails or cannot connect.\n"
            "No warranty for misuse or excessive spam."
        ),
        "highlight_text": "Clean IPs — Looks human — Checkpoint risk minimized",
    },
    "TikTok Scraper API — Data extraction": {
        "title": "TikTok Scraper API — Data extraction",
        "description": (
            "TikTok data extraction API: profiles, videos, comments, hashtags. "
            "Buy a credit pack; each request spends credit. Built for research, "
            "marketing, and analytics."
        ),
        "features": [
            "REST + JSON API access",
            "Endpoints: profile, video, search, hashtag",
            "High rate limit — 100 req/s",
            "Credit-based billing — pay only when you use it",
            "Python / Node.js SDKs",
            "Real-time usage dashboard",
        ],
        "warranty_text": (
            "Purchased credits are non-refundable.\n"
            "24/7 technical support via ticket."
        ),
        "highlight_text": "Powerful API — Flexible credits — SDKs ready",
    },
    "Takedown Facebook / TikTok / YouTube": {
        "title": "Facebook / TikTok / YouTube Takedown",
        "description": (
            "Content takedown service for policy-violating material on Facebook, TikTok, "
            "and YouTube. Handled by the team within 24–72h with real-time report tracking."
        ),
        "features": [
            "Facebook, Instagram, TikTok, YouTube",
            "24–72h SLA per URL",
            "Real-time report tracking",
            "Experienced team (5+ years)",
            "Success rate > 85%",
            "Free pre-order consultation",
        ],
        "warranty_text": (
            "100% refund if the takedown does not succeed.\n"
            "No refund if content is restored after 30 days."
        ),
        "highlight_text": "Multi-platform — 24–72h SLA — Real-time tracking",
    },
    "VPS Cloud KVM — SSD NVMe": {
        "title": "Cloud VPS KVM — NVMe SSD",
        "description": (
            "High-performance cloud VPS with NVMe SSD and 99.99% uptime. "
            "Ideal for bots, tools, and web servers. Flexible plans and durations."
        ),
        "features": [
            "Intel Xeon / AMD EPYC CPUs",
            "High-speed NVMe SSD",
            "1Gbps unmetered bandwidth",
            "99.99% uptime SLA",
            "Full root access",
            "Multiple OS options (Ubuntu, CentOS, Debian, Windows)",
            "Daily automatic backups",
        ],
        "warranty_text": (
            "99.99% uptime SLA. Refund if downtime exceeds SLA.\n"
            "24/7 technical support via ticket."
        ),
        "highlight_text": "Fast NVMe — Root access — Automatic backups",
    },
    "Twitter cổ 2020+ — Trust cao": {
        "title": "Aged Twitter / X 2020+ — High Trust",
        "description": (
            "Aged Twitter/X accounts from 2020+, email + phone verified. High trust score, "
            "fewer restrictions. Suitable for ads, seeding, and automation."
        ),
        "features": [
            "Aged 2020+ accounts, high trust score",
            "Email + phone verified",
            "Low checkpoint risk",
            "Multi-country support (US, UK, VN, EU…)",
            "Strong anti-detect for automation",
            "Works with MMO tools, bots, seeding",
        ],
        "warranty_text": (
            "Support if the account fails or cannot log in within the first 24h.\n"
            "No warranty for misuse or excessive spam."
        ),
        "highlight_text": "Clean IP history — Looks human — Checkpoint risk minimized",
    },
    "Facebook Clone Việt cổ": {
        "title": "Aged Vietnamese Facebook Clones",
        "description": (
            "Aged Vietnamese Facebook clone accounts with posts and friends. "
            "Suitable for ads, seeding, and bulk registration workflows."
        ),
        "features": [
            "Vietnamese clones with 5–30 posts, 30–1000 friends",
            "Registered from 06/2025, full avatar + cover",
            "Trusted Hotmail, full 2FA",
            "Good for warming accounts and running ads",
            "Limit bypass, IP block avoidance",
            "Works with MMO tools and seeding",
        ],
        "warranty_text": (
            "Support if the account is checkpointed / dies within the first 24h.\n"
            "Read the description and notes carefully before purchasing."
        ),
        "highlight_text": "Quality VN clones — avatar + cover — real friends",
    },
    "Telegram số ảo — Session + JSON": {
        "title": "Telegram Virtual Numbers — Session + JSON",
        "description": (
            "Telegram accounts registered with virtual numbers, delivered with session + JSON. "
            "No spam history, ready to use."
        ),
        "features": [
            "Registered with quality virtual numbers",
            "Session + JSON file handover",
            "No spam history, clean profile",
            "Suitable for group warming and bots",
            "Compatible with Telethon and Pyrogram",
        ],
        "warranty_text": (
            "48h warranty if the session does not work.\n"
            "No warranty if banned due to spam reports."
        ),
        "highlight_text": "Clean session — no spam — ready to use",
    },
    "Visa ảo / Thẻ thanh toán quốc tế": {
        "title": "Virtual Visa / International Payment Cards",
        "description": (
            "Virtual Visa/Mastercard cards for international service payments. "
            "Flexible top-up, ready to use immediately."
        ),
        "features": [
            "Genuine virtual Visa/Mastercard",
            "Flexible top-up from 5 USD",
            "Pay Google Ads, Facebook Ads, ChatGPT, Netflix…",
            "No KYC for cards under 1000 USD",
            "Instant issuance",
        ],
        "warranty_text": (
            "Refund if the card does not work.\n"
            "No warranty if declined due to merchant BIN blocks."
        ),
        "highlight_text": "Instant issue — No KYC — Pay anywhere",
    },
    "Tra cứu hồ sơ Facebook — API dữ liệu công khai": {
        "title": "Facebook Profile Lookup — Public Data API",
        "description": (
            "Look up public Facebook data in real time via API — no scraper to run, "
            "no IP-block headaches.\n\n"
            "**Buy a request pack → get one gateway key → call the endpoints below via "
            "`/gw/{key}/<endpoint>`.** Each call (success or not found) spends exactly "
            "1 request from the pack, with no hidden fees.\n\n"
            "Data is taken from public Facebook pages only — information anyone can see "
            "without logging in."
        ),
        "features": [
            "Real-time public Facebook data",
            "Gateway key access after purchase",
            "Endpoints for profile, posts, and comments",
            "1 request per call — no hidden fees",
        ],
        "warranty_text": "Purchased request packs are non-refundable.",
        "highlight_text": "Public data only — Gateway API — No scraper setup",
    },
    "Tra cứu hồ sơ TikTok — API dữ liệu công khai": {
        "title": "TikTok Profile Lookup — Public Data API",
        "description": (
            "Look up public TikTok data in real time via API — no scraper to run, "
            "no IP-block headaches.\n\n"
            "**Buy a request pack → get one gateway key → call the endpoints below via "
            "`/gw/{key}/<endpoint>`.** Each call spends exactly 1 request from the pack.\n\n"
            "Data is taken from public TikTok content only."
        ),
        "features": [
            "Real-time public TikTok data",
            "Gateway key access after purchase",
            "Profile, video, comments, and user search",
            "1 request per call — no hidden fees",
        ],
        "warranty_text": "Purchased request packs are non-refundable.",
        "highlight_text": "Public data only — Gateway API — No scraper setup",
    },
    "Tra cứu kênh YouTube — API dữ liệu công khai": {
        "title": "YouTube Channel Lookup — Public Data API",
        "description": (
            "Look up public YouTube data in real time via API — no scraper to run, "
            "no IP-block headaches.\n\n"
            "**Buy a request pack → get one gateway key → call the endpoints below via "
            "`/gw/{key}/<endpoint>`.** Each call spends exactly 1 request from the pack.\n\n"
            "Data is taken from public YouTube content only."
        ),
        "features": [
            "Real-time public YouTube data",
            "Gateway key access after purchase",
            "Channel, video, comments, and search",
            "1 request per call — no hidden fees",
        ],
        "warranty_text": "Purchased request packs are non-refundable.",
        "highlight_text": "Public data only — Gateway API — No scraper setup",
    },
    # TopProxy seed titles (common active catalog)
    "Proxy dân cư tĩnh Việt Nam (share)": {
        "title": "Vietnam Static Residential Proxy (shared)",
        "description": "Shared static residential proxies in Vietnam for stable identity.",
        "highlight_text": "Static residential — Vietnam — Shared pool",
    },
    "Proxy Datacenter Việt Nam": {
        "title": "Vietnam Datacenter Proxy",
        "description": "Vietnam datacenter proxies for high throughput workloads.",
        "highlight_text": "Datacenter — Vietnam — High throughput",
    },
    "Proxy Datacenter US (San Jose)": {
        "title": "US Datacenter Proxy (San Jose)",
        "description": "US datacenter proxies hosted in San Jose.",
        "highlight_text": "Datacenter — San Jose, US",
    },
    "Proxy 4G di động Vinaphone": {
        "title": "Vinaphone Mobile 4G Proxy",
        "description": "Vietnamese mobile 4G proxies on the Vinaphone network.",
        "highlight_text": "Mobile 4G — Vinaphone — Vietnam",
    },
    "Gói proxy tĩnh 90–100 IP": {
        "title": "Static Proxy Pack 90–100 IPs",
        "description": "Bulk static proxy pack with 90–100 IPs.",
        "highlight_text": "Bulk static pack — 90–100 IPs",
    },
    "Key proxy xoay IPv4 — theo ngày": {
        "title": "Rotating IPv4 Proxy Key — Daily",
        "description": "Rotating IPv4 proxy access billed per day.",
        "highlight_text": "Rotating IPv4 — Daily plan",
    },
    "Key proxy xoay IPv4 — theo tuần": {
        "title": "Rotating IPv4 Proxy Key — Weekly",
        "description": "Rotating IPv4 proxy access billed per week.",
        "highlight_text": "Rotating IPv4 — Weekly plan",
    },
    "Key proxy xoay IPv4 — theo tháng": {
        "title": "Rotating IPv4 Proxy Key — Monthly",
        "description": "Rotating IPv4 proxy access billed per month.",
        "highlight_text": "Rotating IPv4 — Monthly plan",
    },
    "DProxy Test — Proxy xoay IP demo": {
        "title": "DProxy Test — Rotating IP demo",
        "description": "Demo rotating proxy product used for DProxy integration tests.",
        "highlight_text": "Demo — Rotating proxy",
    },
    "FB  uy tín, tạo trên 2 tháng": {
        "title": "Trusted Facebook accounts — 2+ months old",
        "description": "Trusted Facebook accounts created more than 2 months ago.",
        "highlight_text": "Trusted FB — Aged 2+ months",
    },
    "Takedown youtube": {
        "title": "YouTube Takedown",
        "description": "YouTube content takedown service.",
        "highlight_text": "YouTube takedown",
    },
    "[TEST-L1] Tài khoản demo — kho có sẵn": {
        "title": "[TEST-L1] Demo accounts — in-stock",
        "description": "Internal demo product for instant inventory delivery.",
        "highlight_text": "Demo L1 — Instant stock",
    },
    "[TEST-L2] Proxy demo — mua hộ thượng nguồn": {
        "title": "[TEST-L2] Demo proxy — upstream purchase",
        "description": "Internal demo product for upstream proxy provisioning.",
        "highlight_text": "Demo L2 — Upstream proxy",
    },
    "[TEST-L3] API demo — gói lượt gọi qua gateway": {
        "title": "[TEST-L3] Demo API — gateway call packs",
        "description": "Internal demo product for gateway credit packs.",
        "highlight_text": "Demo L3 — Gateway API",
    },
    "[TEST-L4] Takedown demo — tác vụ theo đơn": {
        "title": "[TEST-L4] Demo takedown — per-order tasks",
        "description": "Internal demo product for task-based takedown orders.",
        "highlight_text": "Demo L4 — Task takedown",
    },
    "Notif Demo Product": {
        "title": "Notification Demo Product",
        "description": "Internal product used for notification demos.",
        "highlight_text": "Demo — Notifications",
    },
}


# variant name (VI or mixed) → EN name
VARIANT_EN: dict[str, str] = {
    "Email + cookies": "Email + cookies",
    "Full 2FA + email": "Full 2FA + email",
    "Đặt sỉ theo yêu cầu (50+)": "Wholesale on request (50+)",
    "Session + JSON": "Session + JSON",
    "Cổ 1 năm, không spam": "1-year aged, no spam",
    "Bulk 100+ (theo yêu cầu)": "Bulk 100+ (on request)",
    "Visa ảo 10 USD": "Virtual Visa 10 USD",
    "Visa ảo 50 USD": "Virtual Visa 50 USD",
    "Visa ảo custom (theo yêu cầu)": "Custom virtual Visa (on request)",
    "Clone Việt 5-30 Posts | 30-1000 BB | REG 6.2025 | Avatar | Hotmail | Full 2FA": (
        "VN clone 5–30 posts | 30–1000 friends | REG 06/2025 | Avatar | Hotmail | Full 2FA"
    ),
    "ACC Name Việt cổ | UID 10000xxx | Mail SVMail | No2FA": (
        "Aged VN name account | UID 10000xxx | SVMail | No2FA"
    ),
    "ACC Việt cổ | 10-50 bạn bè | Hotmail Trust": (
        "Aged VN account | 10–50 friends | Trusted Hotmail"
    ),
    "ACC Việt cổ nhiều bài viết UID 1000 | 0-1000 BB | 2010-2023 | Hotmail+MailKP+2FA": (
        "Aged VN account, many posts UID 1000 | 0–1000 friends | 2010–2023 | Hotmail+MailKP+2FA"
    ),
    "Full 2FA + Cookies": "Full 2FA + Cookies",
    "Gói A": "Package A",
}
