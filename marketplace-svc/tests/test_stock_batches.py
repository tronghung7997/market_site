"""Stock batches: each upload's format line and login notes, how buyers get
them with their lines, and how sellers edit, download and back-fill them."""
from sqlalchemy import select

from src.database import SessionLocal
from src.models.resource import Resource
from src.models.stock_batch import StockBatch
from tests.conftest import make_seller, register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _upload(client, token, variant_id, items, **extra):
    resp = await client.post(f"/seller/variants/{variant_id}/resources", json={"items": items, **extra}, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _batches(client, token, variant_id):
    resp = await client.get(f"/seller/variants/{variant_id}/stock-batches", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_an_upload_is_one_batch_across_its_requests(client):
    _, seller, _, vid, _ = await setup_buyable_product(client)

    first = await _upload(client, seller, vid, ["a1|p1|2fa", "a2|p2|2fa"],
                          format="UID|PASS|2FA", login_note="  # Đăng nhập m.facebook.com\nmã 2FA ở 2fa.live ")
    assert first["count"] == 2 and first["batch_id"]
    second = await _upload(client, seller, vid, ["a3|p3", "a4|p4|2fa"], batch_id=first["batch_id"])
    assert second["count"] == 2 and second["batch_id"] == first["batch_id"]

    listed = await _batches(client, seller, vid)
    [batch] = listed["batches"]
    assert batch["id"] == first["batch_id"]
    assert (batch["format"], batch["field_count"]) == ("UID|PASS|2FA", 3)
    assert batch["login_note"] == "Đăng nhập m.facebook.com mã 2FA ở 2fa.live"
    assert (batch["available"], batch["sold"], batch["total"], batch["mismatched"]) == (4, 0, 4, 1)
    # The fixture's three lines came without a format.
    assert listed["unformatted"] == {"in_stock": 3, "by_field_count": [{"field_count": 2, "count": 3}]}

    rows = (await client.get(f"/seller/variants/{vid}/resources", params={"batch": str(first["batch_id"])}, headers=_auth(seller))).json()
    assert len(rows) == 4 and {r["batch_id"] for r in rows} == {first["batch_id"]}
    legacy = (await client.get(f"/seller/variants/{vid}/resources", params={"batch": "none"}, headers=_auth(seller))).json()
    assert len(legacy) == 3 and {r["batch_id"] for r in legacy} == {None}


async def test_a_reupload_of_known_lines_leaves_no_empty_batch(client):
    _, seller, _, vid, _ = await setup_buyable_product(client)

    result = await _upload(client, seller, vid, ["uid1|pass1", "uid2|pass2"], format="UID|PASS")
    assert result["count"] == 0 and result["batch_id"] is None
    assert (await _batches(client, seller, vid))["batches"] == []
    async with SessionLocal() as db:
        assert (await db.execute(select(StockBatch))).first() is None


async def test_formats_are_one_line_and_batches_stay_with_their_seller(client):
    _, seller, _, vid, _ = await setup_buyable_product(client)
    own = await _upload(client, seller, vid, ["x1|y1"], format="USER|PASS")

    for bad in ("", "   ", "UID|PASS\nMAIL", "U" * 501):
        resp = await client.post(f"/seller/variants/{vid}/resources", json={"items": ["z|z"], "format": bad}, headers=_auth(seller))
        assert resp.status_code == 422, bad
        if bad.strip() and len(bad) <= 500:
            assert resp.json()["error_code"] == "STOCK_FORMAT_INVALID"

    # An account sent as the format is refused without being echoed back.
    account = "igname|pw-secret|TOTPSEED|sessionid=" + "s" * 520 + "|m@x.vn|"
    refused = await client.post(f"/seller/variants/{vid}/resources", json={"items": ["z|z"], "format": account}, headers=_auth(seller))
    assert refused.status_code == 422
    issue = refused.json()["detail"][0]
    assert issue["loc"] == ["body", "format"] and issue["ctx"] == {"max_length": 500}
    assert "input" not in issue and "pw-secret" not in refused.text

    await register_and_login(client, "batch_other@example.com")
    await make_seller("batch_other@example.com")
    other = await register_and_login(client, "batch_other@example.com")
    stolen = await client.post(f"/seller/variants/{vid}/resources", json={"items": ["o|o"], "batch_id": own["batch_id"]}, headers=_auth(other))
    assert stolen.status_code in (403, 404)
    edit = await client.patch(f"/seller/stock-batches/{own['batch_id']}", json={"format": "A|B"}, headers=_auth(other))
    assert edit.status_code == 404 and edit.json()["error_code"] == "STOCK_BATCH_NOT_FOUND"
    assert (await client.get(f"/seller/stock-batches/{own['batch_id']}/export.txt", headers=_auth(other))).status_code == 404
    assert (await client.get(f"/seller/variants/{vid}/stock-batches", headers=_auth(other))).status_code == 403
    assert (await client.post(
        f"/seller/variants/{vid}/stock-batches/assign", json={"format": "A|B", "field_count": 2}, headers=_auth(other),
    )).status_code == 403


async def test_an_order_from_several_batches_reads_block_by_block(client):
    buyer, seller, _, vid, _ = await setup_buyable_product(client)
    a = await _upload(client, seller, vid, ["ua1|pa1", "ua2|pa2"], format="UID|PASS", login_note="Đăng nhập bằng UID")
    b = await _upload(client, seller, vid, ["ub1|pb1|c_user=1", "ub2|pb2|c_user=2"], format="UID|PASS|COOKIE")

    order = await client.post("/orders", json={"variant_id": vid, "quantity": 7}, headers=_auth(buyer))
    assert order.status_code == 201, order.text
    code = order.json()["order_code"]

    page = (await client.get(f"/orders/{code}/resources", params={"limit": 3}, headers=_auth(buyer))).json()
    assert [item["batch_id"] for item in page["items"]] == [None, None, None]
    # Every batch of the order comes with the first page already.
    assert {(x["id"], x["format"], x["login_note"]) for x in page["batches"]} == {
        (a["batch_id"], "UID|PASS", "Đăng nhập bằng UID"), (b["batch_id"], "UID|PASS|COOKIE", None),
    }
    rest = (await client.get(f"/orders/{code}/resources", params={"after": page["next_after"]}, headers=_auth(buyer))).json()
    assert [item["batch_id"] for item in rest["items"]] == [a["batch_id"]] * 2 + [b["batch_id"]] * 2

    text = (await client.get(f"/orders/{code}/delivery.txt", headers=_auth(buyer))).text
    assert text == (
        "uid1|pass1\nuid2|pass2\nuid3|pass3\n"
        "\nUID|PASS\n# Đăng nhập bằng UID\nua1|pa1\nua2|pa2\n"
        "\nUID|PASS|COOKIE\nub1|pb1|c_user=1\nub2|pb2|c_user=2\n"
    )


async def test_editing_a_batch_with_sold_lines_moves_the_rest_to_a_copy(client):
    buyer, seller, _, vid, _ = await setup_buyable_product(client)
    batch = await _upload(client, seller, vid, ["s1|p1", "s2|p2", "s3|p3"], format="UID|PASS")
    untouched = await _upload(client, seller, vid, ["t1|q1"], format="USER|PW")

    # An unsold batch is edited in place.
    same = await client.patch(f"/seller/stock-batches/{untouched['batch_id']}", json={"login_note": "Đổi mật khẩu sau 24h"}, headers=_auth(seller))
    assert same.status_code == 200 and same.json()["id"] == untouched["batch_id"]
    assert same.json()["login_note"] == "Đổi mật khẩu sau 24h"

    order = await client.post("/orders", json={"variant_id": vid, "quantity": 4}, headers=_auth(buyer))
    code = order.json()["order_code"]  # three legacy lines + s1

    edited = await client.patch(f"/seller/stock-batches/{batch['batch_id']}", json={"format": "UID|PASS|NOTE", "login_note": "mới"}, headers=_auth(seller))
    assert edited.status_code == 200, edited.text
    copy = edited.json()
    assert copy["id"] != batch["batch_id"] and copy["format"] == "UID|PASS|NOTE" and copy["source"] == "split"

    async with SessionLocal() as db:
        rows = (await db.execute(select(Resource.order_id, Resource.batch_id).where(Resource.batch_id.in_([batch["batch_id"], copy["id"]])))).all()
    assert sorted((oid is not None, bid) for oid, bid in rows) == [(False, copy["id"]), (False, copy["id"]), (True, batch["batch_id"])]
    sold = (await client.get(f"/orders/{code}/resources", headers=_auth(buyer))).json()
    assert [(x["format"], x["login_note"]) for x in sold["batches"]] == [("UID|PASS", None)]

    cleared = await client.patch(f"/seller/stock-batches/{copy['id']}", json={"clear_note": True}, headers=_auth(seller))
    assert cleared.json()["login_note"] is None and cleared.json()["id"] == copy["id"]


async def test_older_stock_gets_a_format_by_field_count_or_by_line(client):
    buyer, seller, _, vid, _ = await setup_buyable_product(client)
    await _upload(client, seller, vid, ["k1|k2|k3", "k4|k5|k6", "lone"])  # no format: older API clients
    order = await client.post("/orders", json={"variant_id": vid, "quantity": 1}, headers=_auth(buyer))
    assert order.status_code == 201  # sells uid1|pass1, which keeps no batch

    before = (await _batches(client, seller, vid))["unformatted"]
    assert before["in_stock"] == 5
    assert sorted((x["field_count"], x["count"]) for x in before["by_field_count"]) == [(1, 1), (2, 2), (3, 2)]

    by_count = await client.post(f"/seller/variants/{vid}/stock-batches/assign", json={"format": "UID|PASS", "login_note": "cũ", "field_count": 2}, headers=_auth(seller))
    assert by_count.status_code == 200, by_count.text
    assert by_count.json()["count"] == 2 and by_count.json()["batch"]["source"] == "assign"

    lone = (await client.get(f"/seller/variants/{vid}/resources", params={"batch": "none", "search": "lone"}, headers=_auth(seller))).json()
    by_line = await client.post(f"/seller/variants/{vid}/stock-batches/assign", json={"format": "KEY", "resource_ids": [lone[0]["id"]]}, headers=_auth(seller))
    assert by_line.json()["count"] == 1

    nothing = await client.post(f"/seller/variants/{vid}/stock-batches/assign", json={"format": "X", "field_count": 9}, headers=_auth(seller))
    assert nothing.json() == {"batch": None, "count": 0}
    missing = await client.post(f"/seller/variants/{vid}/stock-batches/assign", json={"format": "X"}, headers=_auth(seller))
    assert missing.status_code == 422

    after = (await _batches(client, seller, vid))["unformatted"]
    assert after["by_field_count"] == [{"field_count": 3, "count": 2}]
    async with SessionLocal() as db:
        sold = (await db.execute(select(Resource.batch_id).where(Resource.order_id.is_not(None)))).scalars().all()
    assert sold == [None]


async def test_a_downloaded_batch_uploads_again_as_is(client):
    _, seller, _, vid, _ = await setup_buyable_product(client)
    batch = await _upload(client, seller, vid, ["e1|f1", "e2|f2"], format="MAIL|PASS", login_note="Đăng nhập outlook.com")

    resp = await client.get(f"/seller/stock-batches/{batch['batch_id']}/export.txt", headers=_auth(seller))
    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "no-store"
    assert resp.text == "MAIL|PASS\n# Đăng nhập outlook.com\ne1|f1\ne2|f2\n"


async def test_select_all_matching_stays_inside_the_batch_filter(client):
    _, seller, _, vid, _ = await setup_buyable_product(client)
    batch = await _upload(client, seller, vid, ["m1|n1", "m2|n2"], format="UID|PASS")

    resp = await client.post(
        f"/seller/variants/{vid}/resources/bulk-action",
        json={"action": "archive", "all_matching": True, "status": "available", "batch": str(batch["batch_id"])},
        headers=_auth(seller),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["count"] == 2
    legacy = (await client.get(f"/seller/variants/{vid}/resources", params={"batch": "none"}, headers=_auth(seller))).json()
    assert len(legacy) == 3 and not any(r["is_archived"] for r in legacy)
