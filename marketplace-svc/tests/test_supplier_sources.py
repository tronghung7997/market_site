"""Quản lý nguồn hàng (/seller/sources, /admin/sources) — src/suppliers/sources.py.

Dùng lại mock igbm + fixture của test_igbm_adapter: nguồn được giao cho
seller (Provider.seller_id), seller duyệt catalog đã đồng bộ, nhập SKU thành
sản phẩm, gắn/sửa/gỡ, áp margin; admin thấy mọi nguồn; seller khác không thấy.
"""
import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.account import Account
from src.models.product import Product, ProductVariant
from src.models.provider import Provider
from src.models.supplier_listing import SupplierCatalogItem, SupplierListing
from src.suppliers.sources import guess_service_type, suggest_price
from tests.conftest import make_seller, register_and_login
from tests.test_igbm_adapter import _setup, mock_igbm  # noqa: F401 — fixture re-export


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.no_db
def test_suggest_price_rounds_up_to_step():
    assert suggest_price(2800, 30) == 4000
    assert suggest_price(2800, 30, 100) == 3700
    assert suggest_price(280, 30) == 1000
    assert suggest_price(0, 30) == 0


@pytest.mark.no_db
def test_guess_service_type():
    assert guess_service_type(["Proxy - IP -  VPN", "Proxy"]) == "proxy"
    assert guess_service_type(["CapCut Pro 1"]) == "token"
    assert guess_service_type(["Facebook", "Clone VN"]) == "account"


async def _assign_to_seller(ctx):
    async with SessionLocal() as db:
        seller_id = (await db.scalar(select(Product.seller_id).where(Product.id == ctx["product"]["id"])))
        await db.execute(update(Provider).where(Provider.id == ctx["provider_id"]).values(seller_id=seller_id))
        # Nguồn chỉ thuộc seller nội bộ (wizard / PUT providers bật cờ này).
        await db.execute(update(Account).where(Account.id == seller_id).values(is_internal=True))
        await db.commit()
        return seller_id


@pytest.mark.asyncio
async def test_seller_sees_only_assigned_sources_and_admin_sees_all(client, mock_igbm):
    ctx = await _setup(client)
    # Chưa giao (seller thường) → khu Nguồn cung bị chặn, admin thấy.
    assert (await client.get("/seller/sources", headers=_h(ctx["seller"]))).status_code == 403
    admin_view = (await client.get("/admin/sources", headers=_h(ctx["admin"]))).json()
    assert [s["id"] for s in admin_view] == [ctx["provider_id"]]
    assert admin_view[0]["listing_count"] == 1 and admin_view[0]["catalog_count"] == 0

    await _assign_to_seller(ctx)
    mine = (await client.get("/seller/sources", headers=_h(ctx["seller"]))).json()
    assert mine[0]["id"] == ctx["provider_id"] and mine[0]["seller_email"] == "ig_seller@example.com"

    other = await register_and_login(client, "ig_other@example.com")
    await make_seller("ig_other@example.com")
    other = await register_and_login(client, "ig_other@example.com")
    # Seller thường: khu Nguồn cung bị chặn ở backend, không chỉ ẩn trên UI.
    assert (await client.get("/seller/sources", headers=_h(other))).status_code == 403
    resp = await client.get(f"/seller/sources/{ctx['provider_id']}/catalog", headers=_h(other))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_assigns_source_to_seller_via_provider_update(client, mock_igbm):
    ctx = await _setup(client)
    async with SessionLocal() as db:
        seller_id = await db.scalar(select(Product.seller_id).where(Product.id == ctx["product"]["id"]))
    resp = await client.put(f"/admin/providers/{ctx['provider_id']}", json={"seller_id": seller_id},
                            headers=_h(ctx["admin"]))
    assert resp.status_code == 200, resp.text
    assert resp.json()["seller_id"] == seller_id and resp.json()["review_status"] == "approved"
    assert len((await client.get("/seller/sources", headers=_h(ctx["seller"]))).json()) == 1
    # Giao nguồn sàn trả tiền = seller thành seller nội bộ (như wizard).
    assert (await client.get("/me", headers=_h(ctx["seller"]))).json()["is_internal"] is True
    # Không phải seller → 400
    resp = await client.put(f"/admin/providers/{ctx['provider_id']}", json={"seller_id": ctx["buyer_id"]},
                            headers=_h(ctx["admin"]))
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_sync_fills_catalog_snapshot_and_browse_filters(client, mock_igbm):
    ctx = await _setup(client)
    await _assign_to_seller(ctx)
    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/sync", headers=_h(ctx["seller"]))
    assert resp.status_code == 200 and resp.json()["catalog_items"] == 11

    page = (await client.get(f"/seller/sources/{ctx['provider_id']}/catalog", headers=_h(ctx["seller"]))).json()
    assert page["total"] == 10  # in_stock mặc định: bỏ SKU 133947 (amount 0)
    assert page["items"][0]["amount"] >= page["items"][-1]["amount"]
    assert any(g["name"] == "Facebook" for g in page["groups"])
    attached = next(i for i in page["items"] if i["external_id"] == "145883")["attached"]
    assert attached[0]["variant_id"] == ctx["variant"]["id"]

    # Tìm không dấu + theo nhóm + trần giá vốn
    page = (await client.get(f"/seller/sources/{ctx['provider_id']}/catalog",
                             params={"q": "clone ngoai tut", "group": "Facebook"}, headers=_h(ctx["seller"]))).json()
    assert [i["external_id"] for i in page["items"]] == ["145883"]
    page = (await client.get(f"/seller/sources/{ctx['provider_id']}/catalog",
                             params={"max_cost": 300, "in_stock": "false"}, headers=_h(ctx["seller"]))).json()
    assert [i["external_id"] for i in page["items"]] == ["32749"]
    page = (await client.get(f"/seller/sources/{ctx['provider_id']}/catalog",
                             params={"q": "133947", "in_stock": "false"}, headers=_h(ctx["seller"]))).json()
    assert page["items"][0]["amount"] == 0


@pytest.mark.asyncio
async def test_import_creates_product_variant_listing_with_suggested_price(client, mock_igbm):
    ctx = await _setup(client)
    await _assign_to_seller(ctx)
    await client.post(f"/seller/sources/{ctx['provider_id']}/sync", headers=_h(ctx["seller"]))
    cat_id = ctx["product"]["category_id"]

    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/import", json={"items": [
        {"external_id": "32749", "category_id": cat_id, "title": "Hotmail trusted", "variant_name": "1 mail",
         "status": "active"},
        {"external_id": "157393", "category_id": cat_id, "price": 5000},
    ]}, headers=_h(ctx["seller"]))
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created[0]["price"] == suggest_price(280, 30) == 1000 and created[0]["margin_ok"]
    assert created[1]["price"] == 5000

    async with SessionLocal() as db:
        p1 = await db.get(Product, created[0]["product_id"])
        assert p1.provider_id == ctx["provider_id"] and p1.pricing_strategy == "fixed"
        assert p1.status.value == "active" and p1.service_type == "account"
        p2 = await db.get(Product, created[1]["product_id"])
        assert p2.status.value == "draft" and p2.service_type == "proxy" and p2.title == "Proxy dân cư VN | 30 Ngày"
        listing = await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == created[0]["variant_id"]))
        assert listing.cost_price == 280 and listing.upstream_amount == 50007

    # Sản phẩm active hiện ngay trên storefront với tồn kho từ catalog.
    detail = (await client.get(f"/products/{created[0]['product_id']}")).json()
    assert detail["variants"][0]["stock_state"] == "in_stock"

    # SKU không có trong snapshot → 404 rõ ràng.
    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/import", json={"items": [
        {"external_id": "999", "category_id": cat_id},
    ]}, headers=_h(ctx["seller"]))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_listings_update_reprice_attach_detach(client, mock_igbm):
    ctx = await _setup(client, sell_price=3000)
    await _assign_to_seller(ctx)
    await client.post(f"/seller/sources/{ctx['provider_id']}/sync", headers=_h(ctx["seller"]))

    rows = (await client.get(f"/seller/sources/{ctx['provider_id']}/listings", headers=_h(ctx["seller"]))).json()
    assert len(rows) == 1
    row = rows[0]
    assert row["cost_price"] == 2800 and row["price"] == 3000 and row["margin_ok"] is False
    assert row["margin_pct"] == 7.1 and row["sellable"] == 5026

    # Sửa giá + tên gói
    resp = await client.patch(f"/seller/sources/listings/{row['listing_id']}",
                              json={"price": 4500, "variant_name": "1 acc"}, headers=_h(ctx["seller"]))
    assert resp.status_code == 200 and resp.json()["price"] == 4500 and resp.json()["margin_ok"]
    assert resp.json()["variant_name"] == "1 acc"

    # Áp margin hàng loạt 50% → 2800×1.5=4200 → làm tròn 5000
    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/reprice",
                             json={"margin_pct": 50}, headers=_h(ctx["seller"]))
    assert resp.json()["changed"][0]["new_price"] == 5000
    # only_below_min: gói đang OK thì không đổi
    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/reprice",
                             json={"margin_pct": 100, "only_below_min": True}, headers=_h(ctx["seller"]))
    assert resp.json()["changed"] == []

    # Đổi SKU
    resp = await client.patch(f"/seller/sources/listings/{row['listing_id']}",
                              json={"external_id": "128630"}, headers=_h(ctx["seller"]))
    assert resp.json()["external_id"] == "128630" and resp.json()["cost_price"] == 3920

    # Gắn SKU vào gói có sẵn của sản phẩm khác (kho seller thường)
    other = (await client.post("/seller/products", json={
        "category_id": ctx["product"]["category_id"], "title": "Gói thường", "status": "active",
        "escrow_days": 1, "service_type": "account",
    }, headers=_h(ctx["seller"]))).json()
    v = (await client.post(f"/seller/products/{other['id']}/variants", json={
        "name": "Gói A", "price": 9000, "delivery_mode": "instant",
    }, headers=_h(ctx["seller"]))).json()
    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/attach",
                             json={"variant_id": v["id"], "external_id": "59917"}, headers=_h(ctx["seller"]))
    assert resp.status_code == 201, resp.text
    async with SessionLocal() as db:
        p = await db.get(Product, other["id"])
        assert p.provider_id == ctx["provider_id"] and p.pricing_strategy == "fixed"
    rows = (await client.get(f"/seller/sources/{ctx['provider_id']}/listings", headers=_h(ctx["seller"]))).json()
    assert len(rows) == 2

    # Gỡ → gói hết tồn
    resp = await client.delete(f"/seller/sources/listings/{resp.json()['listing_id']}", headers=_h(ctx["seller"]))
    assert resp.status_code == 204
    detail = (await client.get(f"/products/{other['id']}")).json()
    assert detail["variants"][0]["stock_state"] == "out"

    # Seller khác không sửa được listing của tôi
    other_tok = await register_and_login(client, "ig_other2@example.com")
    await make_seller("ig_other2@example.com")
    other_tok = await register_and_login(client, "ig_other2@example.com")
    resp = await client.patch(f"/seller/sources/listings/{row['listing_id']}", json={"price": 1},
                              headers=_h(other_tok))
    assert resp.status_code == 403  # seller thường không vào được Nguồn cung


@pytest.mark.asyncio
async def test_admin_import_needs_owner_when_source_unassigned(client, mock_igbm):
    ctx = await _setup(client)
    await client.post(f"/admin/sources/{ctx['provider_id']}/sync", headers=_h(ctx["admin"]))
    cat_id = ctx["product"]["category_id"]
    resp = await client.post(f"/admin/sources/{ctx['provider_id']}/import", json={"items": [
        {"external_id": "32749", "category_id": cat_id},
    ]}, headers=_h(ctx["admin"]))
    assert resp.status_code == 400
    async with SessionLocal() as db:
        seller_id = await db.scalar(select(Product.seller_id).where(Product.id == ctx["product"]["id"]))
    resp = await client.post(f"/admin/sources/{ctx['provider_id']}/import", json={
        "items": [{"external_id": "32749", "category_id": cat_id}], "owner_seller_id": seller_id,
    }, headers=_h(ctx["admin"]))
    assert resp.status_code == 201
    async with SessionLocal() as db:
        assert (await db.get(Product, resp.json()[0]["product_id"])).seller_id == seller_id
        assert await db.scalar(select(SupplierCatalogItem).where(SupplierCatalogItem.external_id == "32749")) is not None
        assert await db.scalar(select(ProductVariant).where(ProductVariant.id == resp.json()[0]["variant_id"])) is not None


# ----------------------------------------------------------------------
# Gộp nhiều SKU thành một sản phẩm nhiều phân loại; chuyển phân loại
# ----------------------------------------------------------------------

@pytest.mark.asyncio
async def test_import_groups_skus_into_one_product_and_moves_variant(client, mock_igbm):
    ctx = await _setup(client)
    await _assign_to_seller(ctx)
    await client.post(f"/seller/sources/{ctx['provider_id']}/sync", headers=_h(ctx["seller"]))
    cat_id = ctx["product"]["category_id"]

    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/import", json={"items": [
        {"external_id": "32749", "category_id": cat_id, "title": "Hotmail", "variant_name": "Trusted",
         "group_key": "g1", "status": "active"},
        {"external_id": "157393", "category_id": cat_id, "variant_name": "Proxy 30 ngày", "group_key": "g1",
         "price": 5000},
        # thêm phân loại vào sản phẩm có sẵn của ctx
        {"external_id": "59917", "category_id": cat_id, "variant_name": "Gmail 2FA",
         "product_id": ctx["product"]["id"], "price": 5000},
    ]}, headers=_h(ctx["seller"]))
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created[0]["product_id"] == created[1]["product_id"]
    assert created[0]["product_title"] == "Hotmail"
    assert created[2]["product_id"] == ctx["product"]["id"]

    rows = (await client.get(f"/seller/sources/{ctx['provider_id']}/listings", headers=_h(ctx["seller"]))).json()
    by_product: dict[int, list] = {}
    for r in rows:
        by_product.setdefault(r["product_id"], []).append(r["variant_name"])
    assert sorted(by_product[created[0]["product_id"]]) == ["Proxy 30 ngày", "Trusted"]
    assert "Gmail 2FA" in by_product[ctx["product"]["id"]]

    # Chuyển "Gmail 2FA" sang sản phẩm Hotmail.
    listing_id = created[2]["listing_id"]
    resp = await client.patch(f"/seller/sources/listings/{listing_id}",
                              json={"product_id": created[0]["product_id"]}, headers=_h(ctx["seller"]))
    assert resp.status_code == 200 and resp.json()["product_id"] == created[0]["product_id"]

    # Sản phẩm của seller khác → 404.
    other = await register_and_login(client, "ig_other2@example.com")
    await make_seller("ig_other2@example.com")
    resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Của người khác", "description": "x", "pricing_strategy": "fixed",
    }, headers=_h(other))
    if resp.status_code == 201:
        resp = await client.patch(f"/seller/sources/listings/{listing_id}",
                                  json={"product_id": resp.json()["id"]}, headers=_h(ctx["seller"]))
        assert resp.status_code == 404


# ----------------------------------------------------------------------
# Wizard admin: kinds → test config → tạo nguồn + giao/tạo seller nội bộ
# ----------------------------------------------------------------------

@pytest.mark.asyncio
async def test_admin_wizard_creates_source_with_new_internal_seller(client, mock_igbm):
    ctx = await _setup(client)
    admin = _h(ctx["admin"])
    from tests.test_igbm_adapter import MOCK_KEY

    kinds = (await client.get("/admin/sources/kinds", headers=admin)).json()
    igbm = next(k for k in kinds if k["adapter_type"] == "igbm")
    assert igbm["kind"] == "catalog" and any(f["key"] == "api_key" and f["secret"] for f in igbm["fields"])

    # Test config chưa lưu: key sai → không ok; key đúng → ok + số dư.
    bad = (await client.post("/admin/sources/test", json={
        "adapter_type": "igbm", "config": {"base_url": "http://igbm.test", "api_key": "wrong"},
    }, headers=admin)).json()
    assert bad["ok"] is False
    good = (await client.post("/admin/sources/test", json={
        "adapter_type": "igbm", "config": {"base_url": "http://igbm.test", "api_key": MOCK_KEY},
    }, headers=admin)).json()
    assert good["ok"] is True and "balance_vnd" in good["health"]

    resp = await client.post("/admin/sources", json={
        "adapter_type": "igbm", "name": "Shop tài khoản B",
        "config": {"base_url": "http://igbm.test", "api_key": MOCK_KEY, "min_margin_pct": 10},
        "new_seller": {"email": "Internal-B@example.com", "business_name": "Cửa hàng B"},
    }, headers=admin)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["kind"] == "catalog" and body["catalog_items"] == 11 and body["seller_email"] == "internal-b@example.com"

    sellers = (await client.get("/admin/sources/sellers", headers=admin)).json()
    me = next(s for s in sellers if s["id"] == body["seller_id"])
    assert me["is_internal"] and me["business_name"] == "Cửa hàng B" and me["source_count"] == 1
    assert sellers[0]["is_internal"]  # nội bộ xếp trước

    # Nguồn xuất hiện trong danh sách admin với seller nội bộ; email trùng → 400.
    rows = (await client.get("/admin/sources", headers=admin)).json()
    row = next(r for r in rows if r["id"] == body["provider_id"])
    assert row["seller_is_internal"] and row["catalog_count"] == 11
    resp = await client.post("/admin/sources", json={
        "adapter_type": "igbm", "name": "Trùng", "config": {"base_url": "http://igbm.test", "api_key": MOCK_KEY},
        "new_seller": {"email": "internal-b@example.com", "business_name": "B"},
    }, headers=admin)
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_internal_flag_gates_seller_and_is_set_when_assigning(client, mock_igbm):
    ctx = await _setup(client)
    admin = _h(ctx["admin"])
    me = (await client.get("/me", headers=_h(ctx["seller"]))).json()
    assert me["is_internal"] is False
    seller_id = await _assign_to_seller(ctx)

    resp = await client.patch(f"/admin/accounts/{seller_id}/internal", json={"is_internal": True}, headers=admin)
    assert resp.status_code == 200 and resp.json()["is_internal"] is True
    assert (await client.get("/me", headers=_h(ctx["seller"]))).json()["is_internal"] is True

    # Giao nguồn qua wizard cho seller có sẵn cũng bật cờ.
    other = await register_and_login(client, "ig_plain@example.com")
    await make_seller("ig_plain@example.com")
    other_id = (await client.get("/me", headers=_h(other))).json()["id"]
    from tests.test_igbm_adapter import MOCK_KEY
    resp = await client.post("/admin/sources", json={
        "adapter_type": "igbm", "name": "Shop C", "config": {"base_url": "http://igbm.test", "api_key": MOCK_KEY},
        "seller_id": other_id,
    }, headers=admin)
    assert resp.status_code == 201, resp.text
    assert (await client.get("/me", headers=_h(other))).json()["is_internal"] is True
    mine = (await client.get("/seller/sources", headers=_h(other))).json()
    assert [s["name"] for s in mine] == ["Shop C"] and mine[0]["kind"] == "catalog"
