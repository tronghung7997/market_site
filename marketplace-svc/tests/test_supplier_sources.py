"""Quản lý nguồn hàng (/seller/sources, /admin/sources) — src/suppliers/sources.py.

Dùng lại mock igbm + fixture của test_igbm_adapter: nguồn được giao cho
seller (Provider.seller_id), seller duyệt catalog đã đồng bộ, nhập SKU thành
sản phẩm, gắn/sửa/gỡ, áp margin; admin thấy mọi nguồn; seller khác không thấy.
"""
import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
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
        await db.commit()
        return seller_id


@pytest.mark.asyncio
async def test_seller_sees_only_assigned_sources_and_admin_sees_all(client, mock_igbm):
    ctx = await _setup(client)
    # Chưa giao → seller không thấy, admin thấy.
    assert (await client.get("/seller/sources", headers=_h(ctx["seller"]))).json() == []
    admin_view = (await client.get("/admin/sources", headers=_h(ctx["admin"]))).json()
    assert [s["id"] for s in admin_view] == [ctx["provider_id"]]
    assert admin_view[0]["listing_count"] == 1 and admin_view[0]["catalog_count"] == 0

    await _assign_to_seller(ctx)
    mine = (await client.get("/seller/sources", headers=_h(ctx["seller"]))).json()
    assert mine[0]["id"] == ctx["provider_id"] and mine[0]["seller_email"] == "ig_seller@example.com"

    other = await register_and_login(client, "ig_other@example.com")
    await make_seller("ig_other@example.com")
    other = await register_and_login(client, "ig_other@example.com")
    assert (await client.get("/seller/sources", headers=_h(other))).json() == []
    resp = await client.get(f"/seller/sources/{ctx['provider_id']}/catalog", headers=_h(other))
    assert resp.status_code == 404


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
    assert resp.status_code == 404


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
