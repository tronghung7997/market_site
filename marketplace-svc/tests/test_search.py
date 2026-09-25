"""Storefront search: /search/suggest (typeahead) and /search (results page).

Covers accent/case-insensitive matching, typo tolerance, ranking, the
visibility rules (only active products / categories / approved sellers with
stock on the shelf), the empty/short-query behavior, the process cache and
the timeout mapping. No sequential ids for products or sellers on the wire.
"""
import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.account import Account, ApplicationStatus, SellerApplication
from src.search import service as search_service
from tests.conftest import register_and_login
from tests.test_products import _create_public_product, setup_seller_with_category


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _approve_business_name(email: str, name: str) -> None:
    async with SessionLocal() as db:
        account_id = await db.scalar(select(Account.id).where(Account.email == email))
        db.add(SellerApplication(account_id=account_id, business_name=name, status=ApplicationStatus.approved))
        await db.commit()


async def _seed_catalog(client):
    """Admin category tree, one seller shop, a few active products and one draft."""
    seller_token, admin_token, cat_id = await setup_seller_with_category(client)
    social = await client.post(
        "/admin/categories", json={"name": "Mạng xã hội", "slug": "mang-xa-hoi"}, headers=_auth(admin_token),
    )
    social_id = social.json()["id"]
    facebook = await client.post(
        "/admin/categories",
        json={"name": "Facebook", "slug": "facebook", "parent_id": social_id},
        headers=_auth(admin_token),
    )
    facebook_id = facebook.json()["id"]
    await client.post(
        "/admin/categories", json={"name": "Proxy & VPN", "slug": "proxy-vpn"}, headers=_auth(admin_token),
    )

    await _approve_business_name("prod_seller@example.com", "Tài Khoản Store")
    fb = await _create_public_product(
        client, seller_token, facebook_id,
        title="Tài khoản Facebook cổ 2015", highlight_text="Bảo hành 7 ngày",
    )
    tiktok = await _create_public_product(
        client, seller_token, facebook_id, title="Acc TikTok Việt", highlight_text="Có avatar",
    )
    proxy = await _create_public_product(
        client, seller_token, cat_id, title="Proxy dân cư xoay IP",
    )
    draft = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Tài khoản Facebook nháp", "status": "draft",
    }, headers=_auth(seller_token))
    assert draft.status_code == 201, draft.text
    return {
        "seller_token": seller_token,
        "admin_token": admin_token,
        "social_id": social_id,
        "facebook_id": facebook_id,
        "fb": fb,
        "tiktok": tiktok,
        "proxy": proxy,
        "draft": draft.json(),
    }


@pytest.mark.asyncio
async def test_suggest_is_accent_and_case_insensitive_and_hides_drafts(client):
    seeded = await _seed_catalog(client)

    resp = await client.get("/search/suggest", params={"q": "TAI KHOAN facebook"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["query"] == "TAI KHOAN facebook"
    titles = [p["title"] for p in body["products"]]
    assert titles == ["Tài khoản Facebook cổ 2015"]
    hit = body["products"][0]
    assert hit["canonical_path"] == seeded["fb"]["canonical_path"]
    assert "id" not in hit and "seller_id" not in hit
    assert hit["category_slug"] == "facebook"
    assert hit["category_name"] == "Facebook"
    assert hit["seller_name"] == "Tài Khoản Store"
    assert hit["seller_path"].startswith("/sellers/tai-khoan-store-")
    # The draft never surfaces, whatever the query.
    assert seeded["draft"]["public_key"] not in {p["public_key"] for p in body["products"]}


@pytest.mark.asyncio
async def test_suggest_matches_categories_with_parent_and_sellers_by_business_name(client):
    await _seed_catalog(client)

    resp = await client.get("/search/suggest", params={"q": "face"})
    body = resp.json()
    cats = body["categories"]
    assert [c["slug"] for c in cats] == ["facebook"]
    assert cats[0]["parent_name"] == "Mạng xã hội"
    assert cats[0]["parent_slug"] == "mang-xa-hoi"

    resp = await client.get("/search/suggest", params={"q": "tai khoan store"})
    sellers = resp.json()["sellers"]
    assert len(sellers) == 1
    assert sellers[0]["display_name"] == "Tài Khoản Store"
    assert sellers[0]["handle"] == "tai-khoan-store"
    assert "account_id" not in sellers[0] and "email" not in sellers[0]


@pytest.mark.asyncio
async def test_suggest_is_typo_tolerant_and_ranks_prefix_first(client):
    seeded = await _seed_catalog(client)

    # "facebok" ≈ "facebook": the product with it in the title ranks above the
    # one that only sits in the Facebook category.
    fuzzy = await client.get("/search/suggest", params={"q": "facebok"})
    keys = [p["public_key"] for p in fuzzy.json()["products"]]
    assert keys[0] == seeded["fb"]["public_key"]
    assert seeded["proxy"]["public_key"] not in keys

    # "proxy" is a title prefix for the proxy product; category "Proxy & VPN" too.
    ranked = await client.get("/search/suggest", params={"q": "proxy"})
    body = ranked.json()
    assert body["products"][0]["public_key"] == seeded["proxy"]["public_key"]
    assert body["categories"][0]["slug"] == "proxy-vpn"


@pytest.mark.asyncio
async def test_suggest_short_or_empty_queries_stay_cheap(client):
    await _seed_catalog(client)

    empty = await client.get("/search/suggest", params={"q": "   "})
    assert empty.status_code == 200
    assert empty.json() == {"query": "", "products": [], "categories": [], "sellers": []}

    # One character: categories only — products and sellers need two.
    single = await client.get("/search/suggest", params={"q": "f"})
    body = single.json()
    assert body["products"] == [] and body["sellers"] == []
    assert [c["slug"] for c in body["categories"]] == ["facebook"]

    too_long = await client.get("/search/suggest", params={"q": "x" * 200})
    assert too_long.status_code == 422


@pytest.mark.asyncio
async def test_suggest_never_treats_like_metacharacters_as_wildcards(client):
    await _seed_catalog(client)
    resp = await client.get("/search/suggest", params={"q": "%"})
    assert resp.status_code == 200
    assert resp.json()["products"] == [] and resp.json()["categories"] == []


@pytest.mark.asyncio
async def test_search_page_paginates_ranked_products_and_filters_by_category(client):
    seeded = await _seed_catalog(client)

    resp = await client.get("/search", params={"q": "tài khoản", "per_page": 1})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["products"]["total"] == 1
    assert body["products"]["items"][0]["public_key"] == seeded["fb"]["public_key"]
    assert "seller_id" not in body["products"]["items"][0]
    assert [s["handle"] for s in body["sellers"]] == ["tai-khoan-store"]

    page_two = await client.get("/search", params={"q": "tài khoản", "per_page": 1, "page": 2})
    assert page_two.json()["products"]["items"] == []
    # Category / seller side panels are only computed for page 1.
    assert page_two.json()["sellers"] == [] and page_two.json()["categories"] == []

    scoped = await client.get(
        "/search", params={"q": "acc", "category_id": seeded["social_id"]},
    )
    assert [p["public_key"] for p in scoped.json()["products"]["items"]] == [seeded["tiktok"]["public_key"]]

    elsewhere = await client.get("/search", params={"q": "proxy", "category_id": seeded["social_id"]})
    assert elsewhere.json()["products"]["total"] == 0
    # …but the category and seller panels still answer the raw query.
    assert [c["slug"] for c in elsewhere.json()["categories"]] == ["proxy-vpn"]


@pytest.mark.asyncio
async def test_search_page_sorts_relevance_by_default_and_honours_other_sorts(client):
    seeded = await _seed_catalog(client)
    resp = await client.get("/search", params={"q": "việt", "sort": "newest"})
    assert [p["public_key"] for p in resp.json()["products"]["items"]] == [seeded["tiktok"]["public_key"]]

    bad_sort = await client.get("/search", params={"q": "việt", "sort": "random"})
    assert bad_sort.status_code == 422


@pytest.mark.asyncio
async def test_catalog_list_search_is_accent_insensitive_too(client):
    seeded = await _seed_catalog(client)
    resp = await client.get("/products", params={"search": "tai khoan", "sort": "relevance"})
    assert [p["public_key"] for p in resp.json()["items"]] == [seeded["fb"]["public_key"]]


@pytest.mark.asyncio
async def test_sellers_without_active_products_or_approval_are_invisible(client):
    await _seed_catalog(client)
    # A second seller with an approved name but no active product.
    ghost_token = await register_and_login(client, "ghost_seller@example.com")
    from tests.conftest import make_seller
    await make_seller("ghost_seller@example.com")
    await _approve_business_name("ghost_seller@example.com", "Tài Khoản Ghost")

    resp = await client.get("/search/suggest", params={"q": "tai khoan"})
    assert [s["display_name"] for s in resp.json()["sellers"]] == ["Tài Khoản Store"]

    # Pending application: still invisible even once it has stock.
    async with SessionLocal() as db:
        account_id = await db.scalar(select(Account.id).where(Account.email == "ghost_seller@example.com"))
        db.add(SellerApplication(account_id=account_id, business_name="Tài Khoản Pending", status=ApplicationStatus.pending))
        await db.commit()
    resp = await client.get("/search/suggest", params={"q": "pending"})
    assert resp.json()["sellers"] == []
    assert ghost_token


@pytest.mark.asyncio
async def test_suggest_results_are_served_from_the_process_cache(client, monkeypatch):
    await _seed_catalog(client)
    first = await client.get("/search/suggest", params={"q": "proxy"})
    assert first.status_code == 200

    calls = {"n": 0}

    async def boom(*args, **kwargs):
        calls["n"] += 1
        raise AssertionError("database should not be hit for a cached query")

    monkeypatch.setattr(search_service, "suggest_products", boom)
    # Same query, different case → same cache key.
    again = await client.get("/search/suggest", params={"q": "PROXY"})
    assert again.status_code == 200
    assert again.json() == first.json()
    assert calls["n"] == 0


@pytest.mark.asyncio
async def test_search_timeout_maps_to_504(client, monkeypatch):
    await _seed_catalog(client)

    async def slow(*args, **kwargs):
        raise search_service.SearchTimeout()

    monkeypatch.setattr(search_service, "suggest", slow)
    resp = await client.get("/search/suggest", params={"q": "proxy"})
    assert resp.status_code == 504
    assert resp.json()["error_code"] == "SEARCH_TIMEOUT"


@pytest.mark.asyncio
async def test_statement_timeout_is_armed_per_request(client):
    """A query slower than STATEMENT_TIMEOUT_MS is cancelled by PostgreSQL and
    surfaces as SearchTimeout, not as a hung connection."""
    from sqlalchemy import text

    async with SessionLocal() as db:
        await search_service._arm_timeout(db)
        with pytest.raises(Exception) as excinfo:
            await db.execute(text("SELECT pg_sleep(2)"))
        assert search_service._is_query_canceled(excinfo.value)


@pytest.mark.asyncio
async def test_search_rate_limit_returns_429(client, monkeypatch):
    from src.search import router as search_router

    async def deny(*args, **kwargs):
        return False

    monkeypatch.setattr(search_router, "check_rate_limit", deny)
    resp = await client.get("/search/suggest", params={"q": "proxy"})
    assert resp.status_code == 429
    assert resp.json()["error_code"] == "RATE_LIMITED"
    assert resp.headers["retry-after"] == "60"


@pytest.mark.asyncio
async def test_search_throttles_per_forwarded_client_ip(client, monkeypatch):
    """Behind the BFF every request shares one TCP peer; the bucket must be
    the end-user IP the signed BFF request carries, not the whole site."""
    from src.search import router as search_router

    keys: list[str] = []

    async def record(key, **kwargs):
        keys.append(key)
        return True

    monkeypatch.setattr(search_router, "check_rate_limit", record)
    await client.get("/search/suggest", params={"q": "proxy"}, headers={"X-Client-IP": "203.0.113.5"})
    await client.get("/search/suggest", params={"q": "proxy"}, headers={"X-Client-IP": "198.51.100.8"})
    assert keys == ["search:203.0.113.5", "search:198.51.100.8"]


async def _add_variant(client, token, product_id: int, name: str) -> int:
    resp = await client.post(f"/seller/products/{product_id}/variants", json={
        "name": name, "price": 15000, "delivery_mode": "manual", "sla_hours": 8,
    }, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_products_are_found_by_variant_name_and_category(client):
    seeded = await _seed_catalog(client)
    await _add_variant(client, seeded["seller_token"], seeded["proxy"]["id"], "Gói 30 ngày xoay IP")

    by_variant = await client.get("/search/suggest", params={"q": "gói 30 ngày"})
    assert [p["public_key"] for p in by_variant.json()["products"]] == [seeded["proxy"]["public_key"]]

    # "facebook" is only in the category name for the TikTok product; the
    # product with it in the title still ranks first.
    by_category = await client.get("/search", params={"q": "facebook"})
    keys = [p["public_key"] for p in by_category.json()["products"]["items"]]
    assert keys[0] == seeded["fb"]["public_key"]
    assert seeded["tiktok"]["public_key"] in keys
    assert seeded["proxy"]["public_key"] not in keys


@pytest.mark.asyncio
async def test_variant_edits_and_deactivation_keep_the_corpus_in_sync(client):
    seeded = await _seed_catalog(client)
    token = seeded["seller_token"]
    variant_id = await _add_variant(client, token, seeded["proxy"]["id"], "Gói Premium")
    assert (await client.get("/search/suggest", params={"q": "premium"})).json()["products"]
    renamed = await client.patch(f"/seller/variants/{variant_id}", json={"name": "Gói Basic"}, headers=_auth(token))
    assert renamed.status_code == 200, renamed.text
    search_service._suggest_cache.invalidate()
    assert not (await client.get("/search/suggest", params={"q": "premium"})).json()["products"]
    assert (await client.get("/search/suggest", params={"q": "basic"})).json()["products"]


@pytest.mark.asyncio
async def test_multi_word_queries_match_in_any_order(client):
    seeded = await _seed_catalog(client)
    in_order = await client.get("/search/suggest", params={"q": "facebook 2015"})
    reversed_order = await client.get("/search/suggest", params={"q": "2015 facebook"})
    expected = [seeded["fb"]["public_key"]]
    assert [p["public_key"] for p in in_order.json()["products"]] == expected
    assert [p["public_key"] for p in reversed_order.json()["products"]] == expected
    # Every word has to be present: an unrelated extra word yields nothing.
    assert not (await client.get("/search/suggest", params={"q": "facebook xoay"})).json()["products"]


@pytest.mark.asyncio
async def test_synonyms_expand_abbreviations_and_are_admin_editable(client):
    seeded = await _seed_catalog(client)
    admin = _auth(seeded["admin_token"])

    # The suite truncates the seeded synonyms; without any, "fb" finds nothing.
    assert not (await client.get("/search/suggest", params={"q": "fb 2015"})).json()["products"]

    put = await client.put("/admin/search/synonyms", json={"group_key": "Facebook", "terms": ["Facebook", "FB", "fb"]}, headers=admin)
    assert put.status_code == 200, put.text
    assert put.json() == {"group_key": "facebook", "terms": ["facebook", "fb"]}

    hits = await client.get("/search/suggest", params={"q": "fb 2015"})
    assert [p["public_key"] for p in hits.json()["products"]] == [seeded["fb"]["public_key"]]

    listed = await client.get("/admin/search/synonyms", headers=admin)
    assert listed.json()["items"] == [{"group_key": "facebook", "terms": ["facebook", "fb"]}]

    assert (await client.delete("/admin/search/synonyms/facebook", headers=admin)).status_code == 204
    assert (await client.delete("/admin/search/synonyms/facebook", headers=admin)).status_code == 404
    assert not (await client.get("/search/suggest", params={"q": "fb 2015"})).json()["products"]

    forbidden = await client.get("/admin/search/synonyms", headers=_auth(seeded["seller_token"]))
    assert forbidden.status_code == 403


@pytest.mark.asyncio
async def test_results_page_queries_are_logged_for_admins(client):
    import asyncio

    seeded = await _seed_catalog(client)
    await client.get("/search", params={"q": "facebook"})
    await client.get("/search", params={"q": "Facebook"})
    await client.get("/search", params={"q": "khong co gi dau"})
    await client.get("/search", params={"q": "khong co gi dau", "page": 2})  # later pages are not logged
    await client.get("/search/suggest", params={"q": "zzz"})  # zero-hit typeahead is logged too
    await asyncio.sleep(0.2)

    stats = await client.get("/admin/search/queries", params={"days": 7}, headers=_auth(seeded["admin_token"]))
    assert stats.status_code == 200, stats.text
    items = {row["query"].lower(): row for row in stats.json()["items"]}
    assert items["facebook"]["searches"] == 2
    assert items["facebook"]["zero_results"] == 0
    assert items["khong co gi dau"] == {**items["khong co gi dau"], "searches": 1, "zero_results": 1}
    assert "zzz" not in items  # suggest entries are kept out of the page report

    zero_only = await client.get("/admin/search/queries", params={"zero_only": True}, headers=_auth(seeded["admin_token"]))
    assert [row["query"] for row in zero_only.json()["items"]] == ["khong co gi dau"]

    assert (await client.get("/admin/search/queries", headers=_auth(seeded["seller_token"]))).status_code == 403
