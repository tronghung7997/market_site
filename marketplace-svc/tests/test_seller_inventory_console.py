"""Seller inventory console: package list, package page, multi-scope export,
report, restock preview, admin-tunable low-stock threshold."""
import csv
import io
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update
from tests.conftest import make_admin, make_seller, register_and_login

from src.database import SessionLocal
from src.models.product import ProductVariant
from src.models.resource import Resource, ResourceStatus
from src.resources.inventory import mask_data


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _admin(client, email="inv_console_admin@example.com"):
    token = await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


async def _seller(client, email):
    token = await register_and_login(client, email)
    await make_seller(email)
    return await register_and_login(client, email)


async def _category(client, admin_token, name, slug, parent_id=None):
    resp = await client.post(
        "/admin/categories", json={"name": name, "slug": slug, "parent_id": parent_id}, headers=_auth(admin_token),
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


async def _product(client, token, cat_id, title, status="active"):
    resp = await client.post(
        "/seller/products", json={"category_id": cat_id, "title": title, "status": "active"}, headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    pid = resp.json()["id"]
    if status != "active":
        paused = await client.put(f"/seller/products/{pid}/status", json={"status": status}, headers=_auth(token))
        assert paused.status_code == 200, paused.text
    return pid


async def _variant(client, token, product_id, name, price=1000, delivery_mode="instant"):
    resp = await client.post(
        f"/seller/products/{product_id}/variants",
        json={"name": name, "price": price, "delivery_mode": delivery_mode},
        headers=_auth(token),
    )
    return resp.json()["id"]


async def _stock(client, token, variant_id, items):
    resp = await client.post(f"/seller/variants/{variant_id}/resources", json={"items": items}, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _mark(variant_id, data_prefix, *, status=None, assigned_at=None, created_at=None, archived=None):
    async with SessionLocal() as db:
        values = {}
        if status is not None:
            values["status"] = status
        if assigned_at is not None:
            values["assigned_at"] = assigned_at
        if created_at is not None:
            values["created_at"] = created_at
        if archived is not None:
            values["is_archived"] = archived
        await db.execute(
            update(Resource).where(Resource.variant_id == variant_id, Resource.data.like(f"{data_prefix}%")).values(**values)
        )
        await db.commit()


async def _fixture(client):
    """Two categories, three products, five instant packages + one manual."""
    admin = await _admin(client)
    social = await _category(client, admin, "Mạng xã hội", "inv-social")
    fb = await _category(client, admin, "Facebook", "inv-fb", parent_id=social)
    mail = await _category(client, admin, "Email", "inv-mail")
    token = await _seller(client, "inv_console_seller@example.com")
    p_clone = await _product(client, token, fb, "Facebook Clone")
    p_trust = await _product(client, token, fb, "FB Trust")
    p_gmail = await _product(client, token, mail, "Gmail US", status="paused")
    v_full = await _variant(client, token, p_clone, "Full 2FA", price=220)
    v_cookie = await _variant(client, token, p_clone, "Cookies", price=130)
    v_old = await _variant(client, token, p_clone, "Old 2022", price=300)
    v_uid = await _variant(client, token, p_trust, "UID|Pass|2fa", price=130)
    v_manual = await _variant(client, token, p_trust, "Manual hand-over", delivery_mode="manual")
    v_gmail = await _variant(client, token, p_gmail, "Session", price=400)

    await _stock(client, token, v_full, [f"full{i}|pw{i}|2fa{i}|m{i}@x.com" for i in range(30)])
    await _stock(client, token, v_cookie, ["c1|pw|ck", "c2|pw|ck", "c3|pw|ck"])
    await _stock(client, token, v_old, ["old1|pw", "old2|pw"])
    await _stock(client, token, v_uid, [f"uid{i}|pw|2fa" for i in range(5)])
    await _stock(client, token, v_gmail, [f"g{i}|json" for i in range(25)])

    now = datetime.now(timezone.utc)
    # 5 sold (assigned) in the last week + 2 returned as error, on the big package.
    await _mark(v_full, "full0", status=ResourceStatus.assigned, assigned_at=now - timedelta(days=2))
    for i in range(1, 5):
        await _mark(v_full, f"full{i}|", status=ResourceStatus.assigned, assigned_at=now - timedelta(days=2))
    await _mark(v_full, "full5|", status=ResourceStatus.error, assigned_at=now - timedelta(days=3))
    await _mark(v_full, "full6|", status=ResourceStatus.error, assigned_at=now - timedelta(days=3))
    # Old package: sold out, seller stopped selling it.
    await _mark(v_old, "old", status=ResourceStatus.assigned, assigned_at=now - timedelta(days=200))
    async with SessionLocal() as db:
        await db.execute(update(ProductVariant).where(ProductVariant.id == v_old).values(is_active=False))
        await db.commit()
    return {
        "admin": admin, "token": token, "cats": {"fb": fb, "mail": mail, "social": social},
        "products": {"clone": p_clone, "trust": p_trust, "gmail": p_gmail},
        "variants": {"full": v_full, "cookie": v_cookie, "old": v_old, "uid": v_uid, "manual": v_manual, "gmail": v_gmail},
    }


# ---------------------------------------------------------------------------
# Package list
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_packages_grouped_default_hides_inactive_and_counts_by_threshold(client):
    f = await _fixture(client)
    body = (await client.get("/seller/inventory/packages", headers=_auth(f["token"]))).json()

    assert body["low_stock_threshold"] == 20
    ids = [row["variant_id"] for row in body["items"]]
    # Active products only by default, inactive package hidden, manual variant never listed.
    assert f["variants"]["old"] not in ids
    assert f["variants"]["manual"] not in ids
    assert f["variants"]["gmail"] not in ids
    assert set(ids) == {f["variants"]["full"], f["variants"]["cookie"], f["variants"]["uid"]}
    # Grouped view paginates products; rows of one product are contiguous.
    assert body["view"] == "grouped" and body["total"] == 2
    products_in_order = [row["product_id"] for row in body["items"]]
    assert products_in_order == sorted(products_in_order, key=products_in_order.index)

    counts = body["counts"]
    assert counts["all"] == 4          # full, cookie, old, uid (active products)
    assert counts["inactive"] == 1     # old
    assert counts["low"] == 2          # cookie (3), uid (5) — full has 23 available
    assert counts["out"] == 0
    assert counts["error"] == 1        # full has 2 error rows
    assert counts["available_total"] == 23 + 3 + 5
    assert counts["sold_30d"] == 5 + 2  # assigned/error with assigned_at in last 30 days
    assert counts["products"] == 2
    assert {c["name"]: (c["count"], c["parent_name"]) for c in body["categories"]} == {"Facebook": (4, "Mạng xã hội"), "Email": (1, None)}

    full = next(r for r in body["items"] if r["variant_id"] == f["variants"]["full"])
    assert full["available"] == 23 and full["assigned"] == 5 and full["error"] == 2
    assert full["category_parent_id"] == f["cats"]["social"] and full["category_parent_name"] == "Mạng xã hội"
    assert full["stock_state"] == "in_stock" and full["last_restock_at"]
    cookie = next(r for r in body["items"] if r["variant_id"] == f["variants"]["cookie"])
    assert cookie["stock_state"] == "low"


@pytest.mark.asyncio
async def test_packages_filters_category_status_and_inactive_tab(client):
    f = await _fixture(client)
    h = _auth(f["token"])
    mail_only = (await client.get(
        f"/seller/inventory/packages?category_ids={f['cats']['mail']}&product_status=all", headers=h,
    )).json()
    assert [r["variant_id"] for r in mail_only["items"]] == [f["variants"]["gmail"]]
    assert mail_only["items"][0]["product_status"] == "paused"
    # A parent category pulls in every child branch; several ids combine.
    social = (await client.get(f"/seller/inventory/packages?category_ids={f['cats']['social']}&view=flat", headers=h)).json()
    assert {r["variant_id"] for r in social["items"]} == {f["variants"]["full"], f["variants"]["cookie"], f["variants"]["uid"]}
    both = (await client.get(
        f"/seller/inventory/packages?category_ids={f['cats']['social']},{f['cats']['mail']}&product_status=all&view=flat", headers=h,
    )).json()
    assert both["total"] == 4

    inactive = (await client.get("/seller/inventory/packages?stock=inactive", headers=h)).json()
    assert [r["variant_id"] for r in inactive["items"]] == [f["variants"]["old"]]
    assert inactive["items"][0]["stock_state"] == "inactive"

    shown = (await client.get("/seller/inventory/packages?include_inactive=true&view=flat&sort=available_asc", headers=h)).json()
    assert shown["view"] == "flat" and shown["total"] == 4
    assert [r["variant_id"] for r in shown["items"]][:2] == [f["variants"]["old"], f["variants"]["cookie"]]

    low = (await client.get("/seller/inventory/packages?stock=low&view=flat", headers=h)).json()
    assert {r["variant_id"] for r in low["items"]} == {f["variants"]["cookie"], f["variants"]["uid"]}

    searched = (await client.get("/seller/inventory/packages?search=UID&view=flat", headers=h)).json()
    assert [r["variant_id"] for r in searched["items"]] == [f["variants"]["uid"]]

    other = await _seller(client, "inv_console_other@example.com")
    assert (await client.get("/seller/inventory/packages", headers=_auth(other))).json()["counts"]["all"] == 0


@pytest.mark.asyncio
async def test_package_detail_siblings_and_bulk_status(client):
    f = await _fixture(client)
    h = _auth(f["token"])
    detail = (await client.get(f"/seller/inventory/packages/{f['variants']['uid']}", headers=h)).json()
    assert detail["variant_name"] == "UID|Pass|2fa" and detail["available"] == 5
    assert detail["expected_field_count"] == 3
    # Siblings only list instant-delivery packages of the same product.
    assert [s["variant_id"] for s in detail["siblings"]] == [f["variants"]["uid"]]

    manual = await client.get(f"/seller/inventory/packages/{f['variants']['manual']}", headers=h)
    assert manual.status_code == 400

    other = await _seller(client, "inv_console_other2@example.com")
    assert (await client.get(f"/seller/inventory/packages/{f['variants']['uid']}", headers=_auth(other))).status_code == 403

    resp = await client.post(
        "/seller/inventory/packages/bulk-status",
        json={"variant_ids": [f["variants"]["old"], f["variants"]["uid"], 999_999], "is_active": True},
        headers=h,
    )
    body = resp.json()
    assert body["updated"] == [f["variants"]["old"], f["variants"]["uid"]]
    assert body["skipped"] == [{"id": 999_999, "reason": "not_found"}]
    listed = (await client.get("/seller/inventory/packages?view=flat", headers=h)).json()
    assert f["variants"]["old"] in [r["variant_id"] for r in listed["items"]]

    foreign = await client.post(
        "/seller/inventory/packages/bulk-status",
        json={"variant_ids": [f["variants"]["old"]], "is_active": False}, headers=_auth(other),
    )
    assert foreign.json() == {"updated": [], "skipped": [{"id": f["variants"]["old"], "reason": "not_owner"}], "is_active": False}


# ---------------------------------------------------------------------------
# Resources: filters, select-all bulk, restock preview
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_resource_list_filters_and_select_all_matching_archive(client):
    f = await _fixture(client)
    h = _auth(f["token"])
    vid = f["variants"]["full"]
    base = f"/seller/variants/{vid}/resources"

    assigned = await client.get(f"{base}?has_order=false&status=assigned", headers=h)
    assert assigned.status_code == 200, assigned.text
    assert assigned.headers["X-Total-Count"] == "5"
    oldest = (await client.get(f"{base}?sort=oldest&per_page=2", headers=h)).json()
    newest = (await client.get(f"{base}?sort=newest&per_page=2", headers=h)).json()
    assert oldest[0]["id"] < newest[0]["id"]

    since = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    future = await client.get(f"{base}", params={"created_from": since}, headers=h)
    assert future.status_code == 200, future.text
    assert future.headers["X-Total-Count"] == "0"

    # "Select all matching": archive every available row of the package; assigned rows are skipped, not fatal.
    resp = await client.post(
        f"{base}/bulk-action", json={"action": "archive", "all_matching": True, "status": "available"}, headers=h,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["count"] == 23
    detail = (await client.get(f"/seller/inventory/packages/{vid}", headers=h)).json()
    assert detail["available"] == 0 and detail["archived"] == 23

    restore = await client.post(
        f"{base}/bulk-action", json={"action": "restore", "all_matching": True, "archived_only": True}, headers=h,
    )
    assert restore.json()["count"] == 23

    empty = await client.post(f"{base}/bulk-action", json={"action": "archive"}, headers=h)
    assert empty.status_code == 422


@pytest.mark.asyncio
async def test_restock_preview_and_skip_counters(client):
    f = await _fixture(client)
    h = _auth(f["token"])
    vid = f["variants"]["uid"]
    items = ["new1|pw|2fa", "new1|pw|2fa", "uid0|pw|2fa", "broken|pw", "new2|pw|2fa"]
    preview = (await client.post(f"/seller/variants/{vid}/resources/preview", json={"items": items}, headers=h)).json()
    assert preview == {
        "total_lines": 5,
        "duplicate_in_file": 1,
        "existing_in_stock": 1,
        "to_add": 3,
        "expected_field_count": 3,
        "malformed": [{"line": 4, "fields": 2}],
        "malformed_total": 1,
    }
    added = await _stock(client, h["Authorization"].split()[1], vid, items)
    assert added == {"count": 3, "skipped_duplicate": 1, "skipped_existing": 1}


# ---------------------------------------------------------------------------
# Export + report
# ---------------------------------------------------------------------------

def test_mask_data_modes():
    assert mask_data("user|pass|2fa|mail@x.com", "middle") == "user|••••••|••••••|mail@x.com"
    assert mask_data("user|pass", "middle") == "user|••••••"
    assert mask_data("LICENSE-KEY-9901", "middle") == "LICE••••••9901"
    assert mask_data("LICENSE-KEY-9901", "edges", "*") == "LICE******9901"
    assert mask_data("short", "edges") == "sh••••••"
    assert mask_data("anything", "none") == "anything"
    assert mask_data("anything", "id_only") == ""


@pytest.mark.asyncio
async def test_export_multi_scope_masked_csv_txt_and_preview(client):
    f = await _fixture(client)
    h = _auth(f["token"])
    fb = f["cats"]["fb"]
    preview = (await client.get(
        f"/seller/inventory/export?category_ids={f['cats']['social']}&statuses=available&preview=5&mask=middle", headers=h,
    )).json()
    assert preview["packages"] == 3            # parent category → Facebook branch: full, cookie, uid (old inactive → excluded)
    assert preview["total"] == 23 + 3 + 5
    assert preview["row_limit"] == 50_000
    assert preview["columns"] == ["product", "variant", "id", "status", "data", "order", "created_at"]
    assert preview["headers"]["variant"] == "Variation" and preview["rows"][0]["status"] == "ready"
    assert len(preview["rows"]) == 5
    assert "••••••" in preview["rows"][0]["data"] and "|pw" not in preview["rows"][0]["data"]

    with_inactive = (await client.get(
        f"/seller/inventory/export?category_ids={fb}&include_inactive=true&preview=1", headers=h,
    )).json()
    assert with_inactive["packages"] == 4

    csv_resp = await client.get(
        f"/seller/inventory/export?variant_ids={f['variants']['cookie']},{f['variants']['uid']}"
        "&format=csv&columns=variant,id,status,data&mask=id_only",
        headers=h,
    )
    assert csv_resp.status_code == 200
    assert "attachment" in csv_resp.headers["content-disposition"]
    assert csv_resp.text.startswith("\ufeff")          # BOM so Excel reads UTF-8 headers
    rows = list(csv.reader(io.StringIO(csv_resp.text.lstrip("\ufeff"))))
    assert rows[0] == ["Variation", "ID", "Status"]    # data column dropped by id_only
    assert len(rows) == 1 + 3 + 5

    vi_resp = await client.get(
        f"/seller/inventory/export?variant_ids={f['variants']['uid']}&format=csv&columns=index,variant,status,data&locale=vi",
        headers=h,
    )
    vi_rows = list(csv.reader(io.StringIO(vi_resp.text.lstrip("\ufeff"))))
    assert vi_rows[0] == ["STT", "Phân loại", "Trạng thái", "Nội dung"]
    assert [r[0] for r in vi_rows[1:]] == ["1", "2", "3", "4", "5"] and vi_rows[1][2] == "sẵn sàng"

    txt = await client.get(
        f"/seller/inventory/export?product_ids={f['products']['trust']}&format=txt&mask=edges&mask_char=*", headers=h,
    )
    lines = txt.text.strip().splitlines()
    assert len(lines) == 5 and all(line.startswith("uid") and "******" in line for line in lines)

    # Foreign ids silently fall out of scope.
    other = await _seller(client, "inv_console_other3@example.com")
    foreign = (await client.get(
        f"/seller/inventory/export?variant_ids={f['variants']['full']}&preview=1", headers=_auth(other),
    )).json()
    assert foreign["packages"] == 0 and foreign["total"] == 0


@pytest.mark.asyncio
async def test_export_row_limit_from_admin_config(client):
    f = await _fixture(client)
    resp = await client.patch("/admin/seller-config", json={"inventory_export_row_limit": 100}, headers=_auth(f["admin"]))
    assert resp.status_code == 200 and resp.json()["inventory_export_row_limit"] == 100
    preview = (await client.get("/seller/inventory/export?preview=1", headers=_auth(f["token"]))).json()
    assert preview["row_limit"] == 100


@pytest.mark.asyncio
@pytest.mark.parametrize("tz", ["Asia/Ho_Chi_Minh", "Asia/Saigon"])
async def test_report_groups_presets_and_csv(client, tz):
    f = await _fixture(client)
    h = _auth(f["token"])
    by_variant = (await client.get(
        f"/seller/inventory/report?range=30d&tz={tz}&group_by=variant", headers=h,
    )).json()
    assert by_variant["packages"] == 4        # full, cookie, uid, gmail (paused product still in scope; old inactive)
    full = next(r for r in by_variant["rows"] if r["key"] == str(f["variants"]["full"]))
    assert full["label"] == "Full 2FA" and full["sublabel"] == "Facebook Clone"
    assert full["product_title"] == "Facebook Clone" and full["category_name"] == "Facebook"
    assert full["added"] == 30 and full["sold"] == 7 and full["error"] == 2 and full["stock"] == 23
    assert full["prev"] == {"added": 0, "sold": 0, "error": 0, "expired": 0, "archived": 0, "stock": 23, "revenue": 0}
    assert by_variant["totals"]["sold"] == 7 and by_variant["prev_totals"]["sold"] == 0
    # Rows come sold-first so the package that moved sits on top.
    assert by_variant["rows"][0]["key"] == str(f["variants"]["full"])

    by_cat = (await client.get("/seller/inventory/report?range=this_year&group_by=category", headers=h)).json()
    assert {r["label"]: (r["added"], r["category_parent_name"]) for r in by_cat["rows"]} == {"Facebook": (38, "Mạng xã hội"), "Email": (25, None)}
    by_product = (await client.get("/seller/inventory/report?range=this_year&group_by=product", headers=h)).json()
    assert {r["label"]: r["category_name"] for r in by_product["rows"]} == {"Facebook Clone": "Facebook", "FB Trust": "Facebook", "Gmail US": "Email"}
    assert by_cat["range"]["key"] == "this_year"

    low_only = (await client.get("/seller/inventory/report?range=this_month&group_by=variant&low_only=true", headers=h)).json()
    assert {r["key"] for r in low_only["rows"]} == {str(f["variants"]["cookie"]), str(f["variants"]["uid"])}

    daily = (await client.get(f"/seller/inventory/report?range=7d&tz={tz}&group_by=day&basis=assigned", headers=h)).json()
    assert len(daily["rows"]) == 7 and sum(r["sold"] for r in daily["rows"]) == 7
    assert daily["prev_totals"] is None

    weekly = (await client.get("/seller/inventory/report?range=this_quarter&group_by=week", headers=h)).json()
    assert weekly["rows"] and all(r["key"] <= weekly["range"]["to_date"] for r in weekly["rows"])

    csv_resp = await client.get("/seller/inventory/report?range=today&group_by=product&format=csv", headers=h)
    rows = list(csv.reader(io.StringIO(csv_resp.text)))
    assert rows[0][:3] == ["Product", "Category", "Added"] and rows[-1][0] == "Total"

    bad = await client.get("/seller/inventory/report?range=custom&from=2026-02-01&to=2026-01-01", headers=h)
    assert bad.status_code == 400
    assert (await client.get("/seller/inventory/report?range=yesterday", headers=h)).status_code == 422


# ---------------------------------------------------------------------------
# Admin config feeds every threshold consumer
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_admin_low_stock_threshold_drives_products_inventory_and_dashboard(client):
    f = await _fixture(client)
    h = _auth(f["token"])
    admin = _auth(f["admin"])
    assert (await client.get("/admin/seller-config", headers=admin)).json()["low_stock_threshold"] == 20
    assert (await client.get("/admin/seller-config", headers=h)).status_code == 403

    resp = await client.patch("/admin/seller-config", json={"low_stock_threshold": 10}, headers=admin)
    assert resp.status_code == 200 and resp.json()["low_stock_threshold"] == 10
    assert (await client.patch("/admin/seller-config", json={"low_stock_threshold": 0}, headers=admin)).status_code == 422

    packages = (await client.get("/seller/inventory/packages?view=flat", headers=h)).json()
    assert packages["low_stock_threshold"] == 10 and packages["counts"]["low"] == 2   # cookie (3), uid (5)
    products = (await client.get("/seller/products", headers=h)).json()
    assert products["counts"]["low_stock_threshold"] == 10
    # Product-level stock: Facebook Clone = 26, FB Trust = 5 → one low product.
    assert products["counts"]["low_stock"] == 1
    overview = (await client.get("/seller/dashboard?range=7d", headers=h)).json()
    assert overview["inventory"]["low_stock"] == 1

    # Dashboard calendar presets resolve too.
    for key in ("today", "this_week", "this_month", "this_quarter", "this_year"):
        r = await client.get(f"/seller/dashboard?range={key}&tz=Asia/Ho_Chi_Minh", headers=h)
        assert r.status_code == 200, key
        assert r.json()["range"]["key"] == key
