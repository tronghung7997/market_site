"""Admin › Danh mục console: directory with counts, moves, reorder, safe delete, product filter."""

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.account import Account
from src.models.category import Category
from src.models.product import Product, ProductStatus
from tests.conftest import make_admin, register_and_login


async def _admin(client, email):
    await register_and_login(client, email)
    await make_admin(email)
    token = await register_and_login(client, email)
    return {"Authorization": f"Bearer {token}"}


async def _product(seller_email: str, category_id: int, status=ProductStatus.active, title="P") -> int:
    async with SessionLocal() as db:
        seller = await db.scalar(select(Account).where(Account.email == seller_email))
        product = Product(seller_id=seller.id, category_id=category_id, title=title, description="t", status=status)
        db.add(product)
        await db.commit()
        return product.id


@pytest.mark.asyncio
async def test_admin_directory_includes_hidden_and_counts(client):
    h = await _admin(client, "cat_dir_admin@example.com")
    root = (await client.post("/admin/categories", json={"name": "Mạng xã hội", "name_en": "Social", "slug": "adc-social"}, headers=h)).json()
    child = (await client.post("/admin/categories", json={"name": "Facebook", "slug": "adc-fb", "parent_id": root["id"]}, headers=h)).json()
    hidden = (await client.post("/admin/categories", json={"name": "Ẩn", "slug": "adc-hidden"}, headers=h)).json()
    await client.patch(f"/admin/categories/{hidden['id']}", json={"is_active": False}, headers=h)
    await register_and_login(client, "cat_dir_seller@example.com")
    await _product("cat_dir_seller@example.com", child["id"])
    await _product("cat_dir_seller@example.com", child["id"], status=ProductStatus.draft)
    await _product("cat_dir_seller@example.com", root["id"])

    resp = await client.get("/admin/categories", headers=h)
    assert resp.status_code == 200, resp.text
    rows = {r["slug"]: r for r in resp.json()["items"]}
    assert "adc-hidden" in rows and rows["adc-hidden"]["is_active"] is False
    # Public tree still hides it.
    public = await client.get("/categories")
    assert all(c["slug"] != "adc-hidden" for c in public.json())

    assert rows["adc-social"]["name_en"] == "Social"
    assert rows["adc-social"]["child_count"] == 1
    assert rows["adc-social"]["product_count"] == 1
    assert rows["adc-social"]["branch_product_count"] == 3
    assert rows["adc-social"]["branch_active_product_count"] == 2
    assert rows["adc-fb"]["product_count"] == 2
    assert rows["adc-fb"]["active_product_count"] == 1
    assert rows["adc-fb"]["seller_count"] == 1
    summary = resp.json()["summary"]
    assert summary["hidden"] >= 1 and summary["total"] >= 3

    # New children land after existing siblings.
    second = (await client.post("/admin/categories", json={"name": "TikTok", "slug": "adc-tt", "parent_id": root["id"]}, headers=h)).json()
    assert second["sort_order"] > child["sort_order"]


@pytest.mark.asyncio
async def test_admin_directory_requires_admin(client):
    token = await register_and_login(client, "cat_dir_user@example.com")
    resp = await client.get("/admin/categories", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_move_category_rejects_cycles_and_updates_en_name(client):
    h = await _admin(client, "cat_move_admin@example.com")
    a = (await client.post("/admin/categories", json={"name": "A", "slug": "adc-a"}, headers=h)).json()
    b = (await client.post("/admin/categories", json={"name": "B", "slug": "adc-b", "parent_id": a["id"]}, headers=h)).json()
    c = (await client.post("/admin/categories", json={"name": "C", "slug": "adc-c"}, headers=h)).json()

    # A under its own grandchild-to-be → refused.
    resp = await client.patch(f"/admin/categories/{a['id']}", json={"parent_id": b["id"]}, headers=h)
    assert resp.status_code == 400
    resp = await client.patch(f"/admin/categories/{a['id']}", json={"parent_id": a["id"]}, headers=h)
    assert resp.status_code == 400
    resp = await client.patch(f"/admin/categories/{a['id']}", json={"parent_id": 999_999}, headers=h)
    assert resp.status_code == 404

    # B moves under C, then back to the root with an explicit null.
    resp = await client.patch(f"/admin/categories/{b['id']}", json={"parent_id": c["id"]}, headers=h)
    assert resp.status_code == 200 and resp.json()["parent_id"] == c["id"]
    resp = await client.patch(f"/admin/categories/{b['id']}", json={"parent_id": None}, headers=h)
    assert resp.status_code == 200 and resp.json()["parent_id"] is None
    # Omitting parent_id leaves it alone.
    resp = await client.patch(f"/admin/categories/{b['id']}", json={"name": "B2"}, headers=h)
    assert resp.json()["parent_id"] is None

    resp = await client.patch(f"/admin/categories/{b['id']}", json={"name_en": "Bee"}, headers=h)
    assert resp.status_code == 200
    en = await client.get("/categories", headers={"Accept-Language": "en"})
    assert any(cat["name"] == "Bee" for cat in en.json())
    await client.patch(f"/admin/categories/{b['id']}", json={"name_en": ""}, headers=h)
    rows = {r["slug"]: r for r in (await client.get("/admin/categories", headers=h)).json()["items"]}
    assert rows["adc-b"]["name_en"] is None

    # Slug collision is a 409, not a 500.
    resp = await client.patch(f"/admin/categories/{b['id']}", json={"slug": "adc-c"}, headers=h)
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_reorder_siblings(client):
    h = await _admin(client, "cat_order_admin@example.com")
    root = (await client.post("/admin/categories", json={"name": "R", "slug": "adc-r"}, headers=h)).json()
    ids = []
    for slug in ("adc-r1", "adc-r2", "adc-r3"):
        ids.append((await client.post("/admin/categories", json={"name": slug, "slug": slug, "parent_id": root["id"]}, headers=h)).json()["id"])
    resp = await client.post("/admin/categories/reorder", json={"ids": [ids[2], ids[0], ids[1]]}, headers=h)
    assert resp.status_code == 204, resp.text
    rows = {r["id"]: r for r in (await client.get("/admin/categories", headers=h)).json()["items"]}
    assert [rows[i]["sort_order"] for i in (ids[2], ids[0], ids[1])] == [0, 1, 2]
    # Mixed levels are refused.
    resp = await client.post("/admin/categories/reorder", json={"ids": [root["id"], ids[0]]}, headers=h)
    assert resp.status_code == 400
    resp = await client.post("/admin/categories/reorder", json={"ids": [ids[0], 999_999]}, headers=h)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_blocked_by_children_then_allowed(client):
    h = await _admin(client, "cat_del_admin@example.com")
    parent = (await client.post("/admin/categories", json={"name": "Del", "slug": "adc-del"}, headers=h)).json()
    child = (await client.post("/admin/categories", json={"name": "DelKid", "slug": "adc-del-kid", "parent_id": parent["id"]}, headers=h)).json()
    resp = await client.delete(f"/admin/categories/{parent['id']}", headers=h)
    assert resp.status_code == 400
    assert "danh mục con" in resp.json()["detail"]
    assert (await client.delete(f"/admin/categories/{child['id']}", headers=h)).status_code == 204
    assert (await client.delete(f"/admin/categories/{parent['id']}", headers=h)).status_code == 204
    async with SessionLocal() as db:
        assert await db.get(Category, parent["id"]) is None


@pytest.mark.asyncio
async def test_admin_products_filter_by_category_branch(client):
    h = await _admin(client, "cat_prod_admin@example.com")
    root = (await client.post("/admin/categories", json={"name": "PR", "slug": "adc-pr"}, headers=h)).json()
    kid = (await client.post("/admin/categories", json={"name": "PK", "slug": "adc-pk", "parent_id": root["id"]}, headers=h)).json()
    other = (await client.post("/admin/categories", json={"name": "PO", "slug": "adc-po"}, headers=h)).json()
    await client.patch(f"/admin/categories/{kid['id']}", json={"is_active": False}, headers=h)
    await register_and_login(client, "cat_prod_seller@example.com")
    in_root = await _product("cat_prod_seller@example.com", root["id"], title="in-root")
    in_kid = await _product("cat_prod_seller@example.com", kid["id"], title="in-hidden-kid")
    await _product("cat_prod_seller@example.com", other["id"], title="elsewhere")

    resp = await client.get("/admin/products", params={"category_id": root["id"]}, headers=h)
    assert resp.status_code == 200, resp.text
    got = {p["id"] for p in resp.json()["items"]}
    assert got == {in_root, in_kid}
