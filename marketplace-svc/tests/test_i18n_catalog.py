"""Unit + API tests for catalog locale resolve and coded errors."""

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.errors.codes import ErrorCode, MESSAGES_EN
from src.exceptions import InsufficientCredit, NotOwner
from src.i18n.catalog import (
    available_locales,
    normalize_locale,
    parse_accept_language,
    resolve_field,
    resolve_product_fields,
    resolve_product_pricing_params,
    resolve_product_specs,
)
from src.i18n.en_catalog import CATEGORY_EN, PRODUCT_EN
from src.models.category import Category
from src.models.product import Product, ProductStatus, ProductVariant
from tests.conftest import make_admin, make_seller, register_and_login


# ---------------------------------------------------------------------------
# Pure unit tests (no DB)
# ---------------------------------------------------------------------------

@pytest.mark.no_db
def test_normalize_locale():
    assert normalize_locale(None) == "en"
    assert normalize_locale("en") == "en"
    assert normalize_locale("en-US") == "en"
    assert normalize_locale("vi") == "vi"
    assert normalize_locale("vi-VN") == "vi"
    assert normalize_locale("fr") == "en"


@pytest.mark.no_db
def test_parse_accept_language_prefers_highest_q_supported():
    assert parse_accept_language("vi-VN,vi;q=0.9,en-US;q=0.8") == "vi"
    assert parse_accept_language("en-US,en;q=0.9") == "en"
    assert parse_accept_language("fr-FR,fr;q=0.9") is None


@pytest.mark.no_db
def test_resolve_field_en_never_falls_back_to_vi():
    i18n = {
        "vi": {"title": "Tiêu đề VI"},
        "en": {"title": "EN title"},
    }
    assert resolve_field(i18n, "title", "en", legacy="legacy") == "EN title"
    # EN missing → legacy, NOT vi
    i18n_vi_only = {"vi": {"title": "Tiêu đề VI"}}
    assert resolve_field(i18n_vi_only, "title", "en", legacy="legacy-en") == "legacy-en"
    # VI missing → en → legacy
    assert resolve_field(i18n, "title", "vi", legacy="legacy") == "Tiêu đề VI"
    i18n_en_only = {"en": {"title": "EN title"}}
    assert resolve_field(i18n_en_only, "title", "vi", legacy="legacy") == "EN title"


@pytest.mark.no_db
def test_available_locales():
    assert available_locales({}) == []
    assert available_locales({"en": {"title": "X"}, "vi": {"title": "Y"}}) == ["en", "vi"]
    assert available_locales({"vi": {"title": "Y"}}) == ["vi"]


@pytest.mark.no_db
def test_error_codes_have_en_messages():
    for code in ErrorCode:
        assert code in MESSAGES_EN
        assert MESSAGES_EN[code]


@pytest.mark.no_db
def test_coded_exception_attributes():
    exc = InsufficientCredit()
    assert exc.status_code == 402
    assert exc.error_code == "INSUFFICIENT_CREDIT"
    assert exc.params == {}
    assert "Insufficient" in exc.detail
    assert NotOwner().error_code == "NOT_OWNER"


# ---------------------------------------------------------------------------
# API integration
# ---------------------------------------------------------------------------

class _FakeProduct:
    def __init__(self):
        self.title = "Legacy VI title"
        self.description = "Mô tả VI"
        self.warranty_text = None
        self.highlight_text = "Nổi bật"
        self.features = ["A"]
        self.specs = {"Loại IP": "Datacenter VN"}
        self.pricing_params = {
            "base_price": 36000,
            "network_mult": {"DatacenterA": 3.5},
            "network_display": {"DatacenterA": "Dùng riêng"},
            "duration_options": [{"days": 14, "label": "14 ngày"}],
            "platform_display": {"tiktok": "TikTok VI"},
            "packages": [{"size": 1000, "label": "Gói 1.000 lượt"}],
        }
        self.i18n = {
            "vi": {
                "title": "Tiêu đề VI",
                "description": "Mô tả VI i18n",
                "highlight_text": "Nổi bật VI",
                "features": ["A VI"],
            },
            "en": {
                "title": "EN title",
                "description": "EN description",
                "highlight_text": "EN highlight",
                "features": ["A EN"],
                "specs": {"IP type": "Datacenter VN"},
                "pricing_labels": {
                    "field_labels": {"network": "Sharing level"},
                    "network_display": {"DatacenterA": "Dedicated"},
                    "duration_labels": {"14": "14 days"},
                    "platform_display": {"tiktok": "TikTok"},
                    "package_labels": {"1000": "1,000 requests"},
                },
            },
        }


@pytest.mark.no_db
def test_resolve_product_fields_object():
    p = _FakeProduct()
    en = resolve_product_fields(p, "en")
    assert en["title"] == "EN title"
    assert en["locale"] == "en"
    assert set(en["available_locales"]) == {"en", "vi"}

    vi = resolve_product_fields(p, "vi")
    assert vi["title"] == "Tiêu đề VI"


@pytest.mark.no_db
def test_resolve_structured_product_content_without_changing_price_data():
    p = _FakeProduct()
    assert resolve_product_specs(p, "en") == {"IP type": "Datacenter VN"}
    params = resolve_product_pricing_params(p, "en")
    assert params["base_price"] == 36000
    assert params["network_mult"] == {"DatacenterA": 3.5}
    assert params["field_labels"]["network"] == "Sharing level"
    assert params["network_display"]["DatacenterA"] == "Dedicated"
    assert params["duration_options"] == [{"days": 14, "label": "14 days"}]
    assert params["platform_display"] == {"tiktok": "TikTok"}
    assert params["packages"] == [{"size": 1000, "label": "1,000 requests"}]


@pytest.mark.asyncio
async def test_public_product_list_resolves_en(client):
    admin_token = await register_and_login(client, "i18n_admin@example.com")
    await make_admin("i18n_admin@example.com")
    admin_token = await register_and_login(client, "i18n_admin@example.com")
    cat = await client.post(
        "/admin/categories",
        json={"name": "Mạng xã hội", "slug": "social-i18n"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    cat_id = cat.json()["id"]

    seller_token = await register_and_login(client, "i18n_seller@example.com")
    await make_seller("i18n_seller@example.com")
    seller_token = await register_and_login(client, "i18n_seller@example.com")
    product = await client.post(
        "/seller/products",
        json={
            "category_id": cat_id,
            "title": "Twitter cổ 2020+ — Trust cao",
            "description": "Mô tả tiếng Việt",
            "status": "active",
            "highlight_text": "Nổi bật VI",
        },
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert product.status_code == 201
    product_id = product.json()["id"]
    await client.post(
        f"/seller/products/{product_id}/variants",
        json={"name": "Email + cookies", "price": 1000},
        headers={"Authorization": f"Bearer {seller_token}"},
    )

    # Seed i18n.en directly (simulates backfill)
    en_fields = PRODUCT_EN["Twitter cổ 2020+ — Trust cao"]
    async with SessionLocal() as db:
        p = await db.get(Product, product_id)
        p.i18n = {
            **(p.i18n or {}),
            "en": en_fields,
        }
        # also set category EN
        c = await db.get(Category, cat_id)
        c.i18n = {**(c.i18n or {}), "en": {"name": "Social networks"}}
        v = (await db.execute(
            select(ProductVariant).where(ProductVariant.product_id == product_id)
        )).scalar_one()
        v.i18n = {**(v.i18n or {}), "en": {"name": "Email + cookies"}}
        await db.commit()

    # Default locale = en → EN title
    listing = (await client.get("/products")).json()
    item = next(x for x in listing["items"] if x["id"] == product_id)
    assert item["title"] == en_fields["title"]
    assert item["locale"] == "en"
    assert "en" in item["available_locales"]
    assert item["variants"][0]["name"] == "Email + cookies"

    detail = (await client.get(f"/products/{product_id}")).json()
    assert detail["title"] == en_fields["title"]
    assert detail["description"] == en_fields["description"]
    assert detail["locale"] == "en"

    # Explicit vi → Vietnamese from i18n.vi (mirrored on create)
    vi_detail = (await client.get(f"/products/{product_id}", params={"locale": "vi"})).json()
    assert vi_detail["title"] == "Twitter cổ 2020+ — Trust cao"
    assert vi_detail["locale"] == "vi"

    # Accept-Language: vi
    vi_header = (
        await client.get(f"/products/{product_id}", headers={"Accept-Language": "vi-VN,vi;q=0.9"})
    ).json()
    assert vi_header["locale"] == "vi"
    assert vi_header["title"] == "Twitter cổ 2020+ — Trust cao"

    # Categories resolve EN by default
    tree = (await client.get("/categories")).json()
    flat = []

    def walk(nodes):
        for n in nodes:
            flat.append(n)
            walk(n.get("children") or [])

    walk(tree)
    node = next(n for n in flat if n["slug"] == "social-i18n")
    assert node["name"] == "Social networks"
    assert node["locale"] == "en"


@pytest.mark.asyncio
async def test_en_does_not_leak_vi_when_en_missing(client):
    """If only i18n.vi exists, requested en must use legacy scalar — never vi."""
    admin_token = await register_and_login(client, "i18n_admin2@example.com")
    await make_admin("i18n_admin2@example.com")
    admin_token = await register_and_login(client, "i18n_admin2@example.com")
    cat = await client.post(
        "/admin/categories",
        json={"name": "Cloud EN-miss", "slug": "cloud-en-miss"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    cat_id = cat.json()["id"]
    seller_token = await register_and_login(client, "i18n_seller2@example.com")
    await make_seller("i18n_seller2@example.com")
    seller_token = await register_and_login(client, "i18n_seller2@example.com")
    product = await client.post(
        "/seller/products",
        json={
            "category_id": cat_id,
            "title": "Only VI content title",
            "status": "active",
        },
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    product_id = product.json()["id"]

    # Confirm i18n has vi only (from create mirror)
    async with SessionLocal() as db:
        p = await db.get(Product, product_id)
        assert "vi" in (p.i18n or {})
        assert "en" not in (p.i18n or {})

    detail = (await client.get(f"/products/{product_id}")).json()
    # Falls back to legacy scalar (which equals the VI title written on create)
    assert detail["title"] == "Only VI content title"
    assert detail["locale"] == "en"


@pytest.mark.asyncio
async def test_coded_error_body_on_duplicate_email(client):
    await client.post(
        "/auth/register",
        json={"email": "dup_err@example.com", "password": "StrongPass123!"},
    )
    resp = await client.post(
        "/auth/register",
        json={"email": "dup_err@example.com", "password": "StrongPass123!"},
    )
    assert resp.status_code == 409
    body = resp.json()
    assert body["error_code"] == "DUPLICATE_EMAIL"
    assert isinstance(body["detail"], str)
    assert "already registered" in body["detail"].lower() or "email" in body["detail"].lower()
    assert body.get("params") == {}


@pytest.mark.asyncio
async def test_category_en_catalog_covers_seed_slugs():
    """Sanity: seed demo category slugs all have EN names in the map."""
    for slug in ("social", "twitter", "telegram", "facebook", "proxies", "cloud", "payment"):
        assert slug in CATEGORY_EN
