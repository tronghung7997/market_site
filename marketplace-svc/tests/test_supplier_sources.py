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
from src.models.order import Order, OrderStatus
from src.models.supplier_listing import SupplierCatalogItem, SupplierListing, SupplierPurchase
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

    assert resp.json()["price_manual"] is True  # giá gõ tay → luật giá không ghi đè

    # Áp margin hàng loạt: phân loại đặt tay được giữ nguyên, trừ khi include_manual.
    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/reprice",
                             json={"margin_pct": 50}, headers=_h(ctx["seller"]))
    assert resp.json()["changed"] == [] and resp.json()["skipped_manual"][0]["price"] == 4500
    # 2800×1.5=4200 → làm tròn 5000
    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/reprice",
                             json={"margin_pct": 50, "include_manual": True}, headers=_h(ctx["seller"]))
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


# ----------------------------------------------------------------------
# Luật giá của nguồn, giá đặt tay, xem trước đổi giá
# ----------------------------------------------------------------------

async def _other_internal_seller(client, email: str) -> str:
    """Seller nội bộ KHÁC chủ nguồn — để kiểm tra "nguồn của người khác → 404"
    (seller thường bị chặn sớm hơn bằng 403, xem test cuối file)."""
    await register_and_login(client, email)
    await make_seller(email)
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email == email).values(is_internal=True))
        await db.commit()
    return await register_and_login(client, email)


async def _set_config(provider_id: int, **values):
    async with SessionLocal() as db:
        provider = await db.get(Provider, provider_id)
        provider.config = {**provider.config, **values}
        await db.commit()


async def _variant_price(variant_id: int) -> int:
    async with SessionLocal() as db:
        return (await db.get(ProductVariant, variant_id)).price


@pytest.mark.asyncio
async def test_sync_follows_cost_by_rule_but_keeps_manual_prices(client, mock_igbm):
    ctx = await _setup(client, sell_price=3000)
    await _assign_to_seller(ctx)
    # Rule off (nguồn cũ): đồng bộ không đụng giá.
    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/sync", headers=_h(ctx["seller"]))
    assert resp.json()["repriced"] == 0 and await _variant_price(ctx["variant"]["id"]) == 3000

    await _set_config(ctx["provider_id"], follow_cost=True, markup_pct=30, round_to=1000)
    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/sync", headers=_h(ctx["seller"]))
    # vốn 2.800 × 1,3 = 3.640 → 4.000
    assert resp.json()["repriced"] == 1 and await _variant_price(ctx["variant"]["id"]) == 4000

    rows = (await client.get(f"/seller/sources/{ctx['provider_id']}/listings", headers=_h(ctx["seller"]))).json()
    assert rows[0]["rule_price"] == 4000 and rows[0]["price_manual"] is False and rows[0]["group_name"] == "Facebook"

    # Đặt tay → đồng bộ sau không ghi đè.
    await client.patch(f"/seller/sources/listings/{rows[0]['listing_id']}", json={"price": 7000},
                       headers=_h(ctx["seller"]))
    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/sync", headers=_h(ctx["seller"]))
    assert resp.json()["repriced"] == 0 and await _variant_price(ctx["variant"]["id"]) == 7000

    # Trả về luật giá → giá theo luật ngay.
    resp = await client.patch(f"/seller/sources/listings/{rows[0]['listing_id']}", json={"price_manual": False},
                              headers=_h(ctx["seller"]))
    assert resp.status_code == 200 and resp.json()["price"] == 4000 and resp.json()["price_manual"] is False


@pytest.mark.asyncio
async def test_reprice_dry_run_previews_without_saving(client, mock_igbm):
    ctx = await _setup(client, sell_price=3000)
    await _assign_to_seller(ctx)
    await client.post(f"/seller/sources/{ctx['provider_id']}/sync", headers=_h(ctx["seller"]))
    await _set_config(ctx["provider_id"], markup_pct=25)

    # Không truyền margin → dùng luật của nguồn (25% → 3.500 → 4.000).
    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/reprice", json={"dry_run": True},
                             headers=_h(ctx["seller"]))
    body = resp.json()
    assert body["dry_run"] is True and body["margin_pct"] == 25
    assert body["changed"] == [{
        "listing_id": body["changed"][0]["listing_id"], "variant_id": ctx["variant"]["id"],
        "product_title": "Clone FB ngoại", "variant_name": "Gói 1", "cost_price": 2800,
        "old_price": 3000, "new_price": 4000,
    }]
    assert await _variant_price(ctx["variant"]["id"]) == 3000

    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/reprice", json={"margin_pct": 80, "dry_run": True},
                             headers=_h(ctx["seller"]))
    assert resp.json()["changed"][0]["new_price"] == 6000  # 5.040 → 6.000

    # Áp thật.
    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/reprice", json={}, headers=_h(ctx["seller"]))
    assert resp.json()["dry_run"] is False and await _variant_price(ctx["variant"]["id"]) == 4000

    # Seller khác không xem trước được nguồn không phải của mình.
    other = await _other_internal_seller(client, "ig_other3@example.com")
    resp = await client.post(f"/seller/sources/{ctx['provider_id']}/reprice", json={"dry_run": True},
                             headers=_h(other))
    assert resp.status_code == 404


# ----------------------------------------------------------------------
# Cài đặt nguồn: seller nội bộ sửa luật giá/ngưỡng; kết nối chỉ admin
# ----------------------------------------------------------------------

@pytest.mark.asyncio
async def test_settings_scope_and_validation(client, mock_igbm):
    from tests.test_igbm_adapter import MOCK_KEY

    ctx = await _setup(client)
    await _assign_to_seller(ctx)
    pid = ctx["provider_id"]

    seller_view = (await client.get(f"/seller/sources/{pid}/settings", headers=_h(ctx["seller"]))).json()
    assert seller_view["can_manage_connection"] is False
    assert seller_view["base_url"] is None and seller_view["api_key_hint"] is None
    assert seller_view["markup_pct"] == 30 and seller_view["follow_cost"] is False
    assert seller_view["min_margin_pct"] == 10 and seller_view["seller"]["email"] == "ig_seller@example.com"

    resp = await client.patch(f"/seller/sources/{pid}/settings", json={
        "markup_pct": 40, "round_to": 500, "follow_cost": True, "min_margin_pct": 12,
        "auto_pause_after_failures": 5, "low_balance_vnd": 150000,
    }, headers=_h(ctx["seller"]))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["markup_pct"], body["round_to"], body["follow_cost"]) == (40, 500, True)
    assert (body["min_margin_pct"], body["auto_pause_after_failures"], body["low_balance_vnd"]) == (12, 5, 150000)
    async with SessionLocal() as db:
        cfg = (await db.get(Provider, pid)).config
        assert cfg["api_key"] != MOCK_KEY  # vẫn mã hoá sau khi sửa config

    # Seller không đổi được kết nối / bật-tắt nguồn.
    for payload in ({"api_key": "stolen-key-123"}, {"is_active": False}, {"base_url": "https://evil.example"}):
        resp = await client.patch(f"/seller/sources/{pid}/settings", json=payload, headers=_h(ctx["seller"]))
        assert resp.status_code == 403, payload
    # 0% không phải "không chặn" → bị từ chối; round_to lạ → 422.
    for payload in ({"min_margin_pct": 0}, {"round_to": 7}, {"markup_pct": -1}):
        resp = await client.patch(f"/seller/sources/{pid}/settings", json=payload, headers=_h(ctx["seller"]))
        assert resp.status_code == 422, payload
    # Seller khác: 404; buyer: 403.
    other = await _other_internal_seller(client, "ig_other4@example.com")
    assert (await client.get(f"/seller/sources/{pid}/settings", headers=_h(other))).status_code == 404
    assert (await client.get(f"/seller/sources/{pid}/settings", headers=_h(ctx["buyer"]))).status_code == 403

    # Admin thấy + đổi kết nối; key mới vẫn mã hoá; kiểm tra kết nối bằng config đã lưu.
    admin_view = (await client.get(f"/admin/sources/{pid}/settings", headers=_h(ctx["admin"]))).json()
    assert admin_view["can_manage_connection"] and admin_view["base_url"] == "http://igbm.test"
    assert admin_view["api_key_hint"] == MOCK_KEY[-4:]
    resp = await client.patch(f"/admin/sources/{pid}/settings", json={"name": "Acc Station 2", "is_active": False},
                              headers=_h(ctx["admin"]))
    assert resp.status_code == 200 and resp.json()["name"] == "Acc Station 2" and resp.json()["is_active"] is False
    resp = await client.patch(f"/admin/sources/{pid}/settings", json={"api_key": "new-key-0000"},
                              headers=_h(ctx["admin"]))
    assert resp.status_code == 200 and resp.json()["api_key_hint"] == "0000"
    bad = (await client.post(f"/admin/sources/{pid}/test", headers=_h(ctx["admin"]))).json()
    assert bad["ok"] is False
    await client.patch(f"/admin/sources/{pid}/settings", json={"api_key": MOCK_KEY}, headers=_h(ctx["admin"]))
    good = (await client.post(f"/admin/sources/{pid}/test", headers=_h(ctx["admin"]))).json()
    assert good["ok"] is True and good["health"]["balance_vnd"] > 0
    assert (await client.post(f"/admin/sources/{pid}/test", headers=_h(ctx["seller"]))).status_code == 403


# ----------------------------------------------------------------------
# Storefront: phân loại bị chặn hiện hết hàng
# ----------------------------------------------------------------------

@pytest.mark.asyncio
async def test_blocked_listing_reads_as_out_of_stock(client, mock_igbm):
    ctx = await _setup(client, sell_price=3000)  # vốn 2.800 → lời 7% < 10%
    detail = (await client.get(f"/products/{ctx['product']['id']}")).json()
    assert detail["variants"][0]["stock_state"] == "out"

    await _set_config(ctx["provider_id"], min_margin_pct=5)
    detail = (await client.get(f"/products/{ctx['product']['id']}")).json()
    assert detail["variants"][0]["stock_state"] == "in_stock"

    # Giá trị rác trong config → ngưỡng mặc định, truy vấn không vỡ.
    await _set_config(ctx["provider_id"], min_margin_pct="abc")
    detail = (await client.get(f"/products/{ctx['product']['id']}")).json()
    assert detail["variants"][0]["stock_state"] == "out"

    await _set_config(ctx["provider_id"], min_margin_pct=5)
    async with SessionLocal() as db:
        await db.execute(update(Provider).where(Provider.id == ctx["provider_id"]).values(is_active=False))
        await db.commit()
    detail = (await client.get(f"/products/{ctx['product']['id']}")).json()
    assert detail["variants"][0]["stock_state"] == "out"


# ----------------------------------------------------------------------
# Đơn mua từ nguồn
# ----------------------------------------------------------------------

@pytest.mark.asyncio
async def test_purchase_log_records_cost_and_failures(client, mock_igbm, monkeypatch):
    from src.orders.service import provision_pending_order

    ctx = await _setup(client)
    await _assign_to_seller(ctx)
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)
    buyer = _h(ctx["buyer"])

    ok = (await client.post("/orders", json={"variant_id": ctx["variant"]["id"], "quantity": 2}, headers=buyer)).json()
    await provision_pending_order(ok["id"])

    # Lần mua lỗi: SKU hết hàng phía nguồn (bỏ precheck để tới được adapter).
    async def _no_precheck(*_a, **_k):
        return None
    monkeypatch.setattr("src.orders.service.precheck_external_purchase", _no_precheck)
    async with SessionLocal() as db:
        await db.execute(update(SupplierListing).where(SupplierListing.variant_id == ctx["variant"]["id"])
                         .values(external_product_id="133947", upstream_amount=50))
        await db.commit()
    bad = (await client.post("/orders", json={"variant_id": ctx["variant"]["id"], "quantity": 1}, headers=buyer)).json()
    await provision_pending_order(bad["id"])

    async with SessionLocal() as db:
        rows = {p.order_id: p for p in (await db.execute(select(SupplierPurchase))).scalars()}
        assert rows[ok["id"]].ok and rows[ok["id"]].cost_total == 5600 and rows[ok["id"]].trans_id
        assert rows[bad["id"]].ok is False and rows[bad["id"]].cost_total == 0 and rows[bad["id"]].error
        assert (await db.get(Order, bad["id"])).status == OrderStatus.cancelled

    page = (await client.get(f"/seller/sources/{ctx['provider_id']}/purchases", params={"days": 1},
                             headers=_h(ctx["seller"]))).json()
    assert page["summary"]["orders"] == 2 and page["summary"]["ok"] == 1 and page["summary"]["failed"] == 1
    assert page["summary"]["paid"] == 8000 and page["summary"]["cost"] == 5600 and page["summary"]["profit"] == 2400
    by_code = {i["order_code"]: i for i in page["items"]}
    assert by_code[ok["order_code"]]["result"] == "ok" and by_code[ok["order_code"]]["cost_estimated"] is False
    assert by_code[bad["order_code"]]["result"] == "failed" and by_code[bad["order_code"]]["refunded"] == 4000
    assert "order_id" in by_code[ok["order_code"]] and "provider_id" not in by_code[ok["order_code"]]

    only_failed = (await client.get(f"/seller/sources/{ctx['provider_id']}/purchases",
                                     params={"result": "failed"}, headers=_h(ctx["seller"]))).json()
    assert [i["order_code"] for i in only_failed["items"]] == [bad["order_code"]]
    search = (await client.get(f"/seller/sources/{ctx['provider_id']}/purchases",
                               params={"q": ok["order_code"].lower()}, headers=_h(ctx["seller"]))).json()
    assert search["total"] == 1

    # Thống kê 7 ngày trên danh sách nguồn.
    mine = (await client.get("/seller/sources", headers=_h(ctx["seller"]))).json()
    assert mine[0]["stats_7d"]["profit"] == 2400 and mine[0]["stats_7d"]["failed"] == 1

    # Seller khác: 404. Buyer: 403. Tham số lạ: 422.
    other = await _other_internal_seller(client, "ig_other5@example.com")
    assert (await client.get(f"/seller/sources/{ctx['provider_id']}/purchases", headers=_h(other))).status_code == 404
    assert (await client.get(f"/seller/sources/{ctx['provider_id']}/purchases", headers=buyer)).status_code == 403
    assert (await client.get(f"/seller/sources/{ctx['provider_id']}/purchases", params={"days": 3},
                             headers=_h(ctx["seller"]))).status_code == 422


@pytest.mark.asyncio
async def test_plain_seller_cannot_use_source_endpoints(client, mock_igbm):
    ctx = await _setup(client)
    await _assign_to_seller(ctx)
    plain = await register_and_login(client, "ig_plain2@example.com")
    await make_seller("ig_plain2@example.com")
    plain = await register_and_login(client, "ig_plain2@example.com")
    for path in ("purchases", "settings"):
        resp = await client.get(f"/seller/sources/{ctx['provider_id']}/{path}", headers=_h(plain))
        assert resp.status_code == 403, path
