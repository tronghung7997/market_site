"""Delivered goods at scale: stock orders keep their lines in `resources` only,
lists never carry delivered text, lines are read page by page or streamed, and
text deliveries are encrypted at rest."""
import base64
import hashlib
import importlib.util
from pathlib import Path

from cryptography.fernet import Fernet
from sqlalchemy import select, text, update

from src.database import SessionLocal, engine
from src.models.log_entry import LogEntry
from src.models.order import Order
from tests.conftest import register_and_login
from src.security.crypto import FERNET_PREFIX, decrypt_str, encrypt_str
from tests.test_orders import setup_buyable_product

_ROOT = Path(__file__).resolve().parents[1]


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _instant_order(client, quantity: int = 3):
    buyer, seller, admin, instant_vid, manual_vid = await setup_buyable_product(client)
    resp = await client.post("/orders", json={"variant_id": instant_vid, "quantity": quantity}, headers=_auth(buyer))
    assert resp.status_code == 201, resp.text
    return resp.json(), buyer, seller, admin, manual_vid


async def test_stock_orders_keep_no_text_copy_and_report_a_line_count(client):
    order, buyer, *_ = await _instant_order(client, quantity=2)

    assert order["delivered_data"] is None
    assert order["has_delivery"] is True and order["delivery_count"] == 2
    detail = (await client.get(f"/orders/{order['order_code']}", headers=_auth(buyer))).json()
    assert detail["delivered_data"] is None and detail["delivery_count"] == 2
    async with engine.connect() as conn:
        stored = (await conn.execute(text("SELECT delivered_data FROM orders WHERE id = :id"), {"id": order["id"]})).scalar()
    assert stored is None


async def test_order_lists_never_carry_delivered_text(client):
    order, buyer, seller, *_ = await _instant_order(client, quantity=1)

    buyer_rows = (await client.get("/orders", headers=_auth(buyer))).json()["items"]
    seller_rows = (await client.get("/seller/orders", headers=_auth(seller))).json()["items"]
    for rows in (buyer_rows, seller_rows):
        row = next(r for r in rows if r["id"] == order["id"])
        assert row["delivered_data"] is None
        assert row["has_delivery"] is True and row["delivery_count"] == 1


async def test_order_lines_are_paged_with_stable_numbering(client):
    order, buyer, seller, *_ = await _instant_order(client, quantity=3)
    code = order["order_code"]

    first = (await client.get(f"/orders/{code}/resources", params={"limit": 2}, headers=_auth(buyer))).json()
    assert first["total"] == 3
    assert [item["line_no"] for item in first["items"]] == [1, 2]
    assert first["next_after"] == first["items"][-1]["id"]
    rest = (await client.get(
        f"/orders/{code}/resources", params={"limit": 2, "after": first["next_after"]}, headers=_auth(seller),
    )).json()
    assert [item["line_no"] for item in rest["items"]] == [3]
    assert rest["next_after"] is None
    assert {item["data"] for item in first["items"] + rest["items"]} == {"uid1|pass1", "uid2|pass2", "uid3|pass3"}

    third = rest["items"][0]["id"]
    picked = (await client.get(f"/orders/{code}/resources", params={"ids": f"{third},999999"}, headers=_auth(buyer))).json()
    assert [(item["id"], item["line_no"]) for item in picked["items"]] == [(third, 3)]
    await client.post(f"/seller/variants/{order['variant_id']}/resources", json={"items": ["uid4|pass4"]}, headers=_auth(seller))
    other = (await client.post("/orders", json={"variant_id": order["variant_id"], "quantity": 1}, headers=_auth(buyer))).json()
    foreign = (await client.get(f"/orders/{other['order_code']}/resources", params={"ids": str(third)}, headers=_auth(buyer))).json()
    assert foreign["items"] == []

    too_big = await client.get(f"/orders/{code}/resources", params={"limit": 201}, headers=_auth(buyer))
    assert too_big.status_code == 422
    assert (await client.get(f"/orders/{code}/resources", params={"ids": "1,x"}, headers=_auth(buyer))).status_code == 422
    stranger = await register_and_login(client, "stranger-lines@example.com")
    assert (await client.get(f"/orders/{code}/resources", headers=_auth(stranger))).status_code == 403


async def test_order_lines_carry_short_lines_and_only_the_head_of_long_ones(client):
    buyer, seller, _, instant_vid, _ = await setup_buyable_product(client)
    long_line = "cookie_uid|pw|2fa|mail|" + "c" * 60_000
    await client.post(f"/seller/variants/{instant_vid}/resources", json={"items": [long_line]}, headers=_auth(seller))
    order = (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 4}, headers=_auth(buyer))).json()
    code = order["order_code"]

    resp = await client.get(f"/orders/{code}/resources", headers=_auth(buyer))
    short, cookie = resp.json()["items"][0], resp.json()["items"][3]
    assert short["data"] == "uid1|pass1" and short["data_preview"] is None and short["data_length"] == 10
    assert cookie["data"] is None and cookie["data_length"] == len(long_line)
    assert cookie["data_preview"] == long_line[:240] + "…"
    assert len(resp.content) < 5_000, "a 60 KB line never rides along in the list"
    by_id = (await client.get(f"/orders/{code}/resources", params={"ids": str(cookie["id"])}, headers=_auth(buyer))).json()
    assert by_id["items"][0]["data"] is None and by_id["items"][0]["line_no"] == 4

    for token in (buyer, seller):
        full = await client.get(f"/orders/{code}/resources/{cookie['id']}/data.txt", headers=_auth(token))
        assert full.status_code == 200
        assert full.text == long_line
        assert full.headers["cache-control"] == "no-store"

    stranger = await register_and_login(client, "line_stranger@example.com")
    denied = await client.get(f"/orders/{code}/resources/{cookie['id']}/data.txt", headers=_auth(stranger))
    assert denied.status_code == 403
    await client.post(f"/seller/variants/{instant_vid}/resources", json={"items": ["in_stock|pw"]}, headers=_auth(seller))
    stock = (await client.get(f"/seller/variants/{instant_vid}/resources?status=available", headers=_auth(seller))).json()
    foreign = await client.get(f"/orders/{code}/resources/{stock[0]['id']}/data.txt", headers=_auth(buyer))
    assert foreign.status_code == 404, "only lines delivered on this order are reachable through it"


async def test_delivery_download_streams_every_delivered_line_and_is_audited(client):
    order, buyer, seller, *_ = await _instant_order(client, quantity=3)
    code = order["order_code"]

    resp = await client.get(f"/orders/{code}/delivery.txt", headers=_auth(buyer))
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/plain")
    assert f'filename="{code}.txt"' in resp.headers["content-disposition"]
    assert sorted(resp.text.splitlines()) == ["uid1|pass1", "uid2|pass2", "uid3|pass3"]
    assert (await client.get(f"/orders/{code}/delivery.txt", headers=_auth(seller))).status_code == 200

    stranger = await register_and_login(client, "stranger-download@example.com")
    assert (await client.get(f"/orders/{code}/delivery.txt", headers=_auth(stranger))).status_code == 403
    async with SessionLocal() as db:
        events = [
            entry.metadata_ for entry in (await db.scalars(select(LogEntry))).all()
            if (entry.metadata_ or {}).get("event") == "order_delivery_downloaded"
        ]
    assert sorted(e["role"] for e in events) == ["buyer", "seller"]
    assert {(e["subject_type"], e["subject_id"]) for e in events} == {("order", order["id"])}


async def test_delivery_stream_holds_no_connection_between_batches(client, monkeypatch):
    import src.orders.delivery as delivery

    order, *_ = await _instant_order(client, quantity=3)
    monkeypatch.setattr(delivery, "DELIVERY_STREAM_BATCH", 1)
    chunks, checked_out = [], []
    async for chunk in delivery.stream_delivery_lines(order["id"]):
        chunks.append(chunk)
        checked_out.append(engine.pool.checkedout())
    assert len(chunks) == 3
    assert checked_out == [0, 0, 0]


async def test_text_deliveries_are_encrypted_at_rest(client):
    buyer, seller, _, _, manual_vid = await setup_buyable_product(client)
    order = (await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1}, headers=_auth(buyer))).json()
    assert (await client.post(f"/seller/orders/{order['id']}/accept", headers=_auth(seller))).status_code == 200
    delivered = await client.post(
        f"/seller/orders/{order['order_code']}/deliver", json={"data": "manual|secret-line"}, headers=_auth(seller),
    )
    assert delivered.status_code == 200, delivered.text

    async with engine.connect() as conn:
        stored = (await conn.execute(text("SELECT delivered_data FROM orders WHERE id = :id"), {"id": order["id"]})).scalar()
    assert stored.startswith("gAAAAA") and "secret-line" not in stored
    detail = (await client.get(f"/orders/{order['order_code']}", headers=_auth(buyer))).json()
    assert detail["delivered_data"] == "manual|secret-line"


async def test_text_deliveries_come_with_the_order_but_not_the_list(client):
    buyer, seller, _, _, manual_vid = await setup_buyable_product(client)
    order = (await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1}, headers=_auth(buyer))).json()
    assert order["has_delivery"] is False and order["delivery_count"] is None
    assert (await client.post(f"/seller/orders/{order['id']}/accept", headers=_auth(seller))).status_code == 200
    await client.post(f"/seller/orders/{order['order_code']}/deliver", json={"data": "hand|over"}, headers=_auth(seller))

    detail = (await client.get(f"/orders/{order['order_code']}", headers=_auth(buyer))).json()
    assert detail["delivered_data"] == "hand|over" and detail["delivery_count"] is None
    row = next(r for r in (await client.get("/orders", headers=_auth(buyer))).json()["items"] if r["id"] == order["id"])
    assert row["delivered_data"] is None and row["has_delivery"] is True
    download = await client.get(f"/orders/{order['order_code']}/delivery.txt", headers=_auth(buyer))
    assert download.text == "hand|over\n"


async def test_buyer_finds_an_order_by_a_delivered_account_exactly(client):
    order, buyer, *_ = await _instant_order(client, quantity=3)

    found = (await client.get("/orders", params={"search": "UID2"}, headers=_auth(buyer))).json()
    partial = (await client.get("/orders", params={"search": "uid"}, headers=_auth(buyer))).json()
    assert [row["id"] for row in found["items"]] == [order["id"]]
    assert partial["items"] == []


async def test_admin_order_console_is_paged_with_counts_and_facets(client):
    order, buyer, seller, admin, _ = await _instant_order(client, quantity=1)
    await client.post("/orders", json={"variant_id": order["variant_id"], "quantity": 1}, headers=_auth(buyer))

    page = (await client.get("/admin/orders", params={"per_page": 1}, headers=_auth(admin))).json()
    assert page["total"] == 2 and len(page["items"]) == 1 and page["per_page"] == 1
    assert page["items"][0]["delivered_data"] is None
    assert sum(page["status_counts"].values()) == 2 and page["scope_value"] == 2 * order["total_amount"]
    assert [f["count"] for f in page["buyers"]] == [2] and [f["count"] for f in page["sellers"]] == [2]

    searched = (await client.get("/admin/orders", params={"q": order["order_code"]}, headers=_auth(admin))).json()
    assert [row["id"] for row in searched["items"]] == [order["id"]]
    assert (await client.get("/admin/orders", headers=_auth(buyer))).status_code == 403


async def test_seeded_orders_are_hidden_from_order_lists(client):
    order, buyer, seller, admin, _ = await _instant_order(client, quantity=1)
    async with SessionLocal() as db:
        await db.execute(update(Order).where(Order.id == order["id"]).values(is_seeded=True))
        await db.commit()

    buyer_list = (await client.get("/orders", headers=_auth(buyer))).json()
    stats = (await client.get("/orders/stats", headers=_auth(buyer))).json()
    seller_list = (await client.get("/seller/orders", headers=_auth(seller))).json()
    admin_list = (await client.get("/admin/orders", params={"q": order["order_code"]}, headers=_auth(admin))).json()
    assert buyer_list["items"] == [] and stats["total"] == 0
    assert seller_list["items"] == [] and seller_list["total"] == 0
    assert admin_list["items"] == [] and admin_list["total"] == 0 and admin_list["sellers"] == []


async def test_admin_orders_overview_is_computed_in_sql(client):
    order, buyer, seller, admin, _ = await _instant_order(client, quantity=1)

    overview = (await client.get("/admin/orders/overview", headers=_auth(admin))).json()
    assert overview["today_count"] == 1 and overview["today_value"] == order["total_amount"]
    assert overview["all_count"] == 1 and len(overview["daily"]) == 14
    assert overview["daily"][-1]["value"] == order["total_amount"]
    assert (await client.get("/admin/orders/overview", params={"tz": "Mars/Base"}, headers=_auth(admin))).status_code == 400
    assert (await client.get("/admin/orders/overview", headers=_auth(buyer))).status_code == 403


async def test_seller_csv_export_streams_orders_with_optional_delivered_data(client):
    order, buyer, seller, *_ = await _instant_order(client, quantity=2)

    plain = await client.get("/seller/orders/export.csv", headers=_auth(seller))
    assert plain.status_code == 200 and plain.headers["content-type"].startswith("text/csv")
    header, *rows = plain.text.lstrip("﻿").splitlines()
    assert "Delivered_Data" not in header and any(order["order_code"] in row for row in rows)

    with_data = await client.get("/seller/orders/export.csv", params={"include_data": "true"}, headers=_auth(seller))
    assert "Delivered_Data" in with_data.text.splitlines()[0]
    assert "uid1|pass1" in with_data.text or "uid2|pass2" in with_data.text
    assert (await client.get("/seller/orders/export.csv", headers=_auth(buyer))).status_code == 403
    async with SessionLocal() as db:
        events = [
            e.metadata_ for e in (await db.scalars(select(LogEntry))).all()
            if (e.metadata_ or {}).get("event") == "seller_orders_exported"
        ]
    assert [e["include_data"] for e in events] == [False, True]


async def test_order_row_access_never_reads_the_stored_text(client):
    order, *_ = await _instant_order(client, quantity=1)
    async with SessionLocal() as db:
        row = await db.get(Order, order["id"])
        assert row.status.value in ("delivered", "completed")


async def _text_order_ids(client, count: int) -> list[int]:
    buyer, seller, _, _, manual_vid = await setup_buyable_product(client)
    ids = []
    for _ in range(count):
        order = (await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1}, headers=_auth(buyer))).json()
        ids.append(order["id"])
    return ids


async def test_migration_encrypts_legacy_delivery_texts_and_downgrades(client):
    rev = _load(_ROOT / "alembic" / "versions" / "ge1a2b3c4d5e6_encrypt_order_delivered_data.py", "encrypt_order_delivery_rev")
    ids = await _text_order_ids(client, 2)
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE orders SET delivered_data = :d WHERE id = :id"), [
            {"id": ids[0], "d": "legacy|plain"}, {"id": ids[1], "d": encrypt_str("already|sealed")},
        ])
        await conn.run_sync(lambda sync: rev._rewrite(sync, encrypted=True, transform=encrypt_str))
        stored = dict((await conn.execute(text("SELECT id, delivered_data FROM orders WHERE id = ANY(:ids)"), {"ids": ids})).all())
        assert all(value.startswith(FERNET_PREFIX) for value in stored.values())
        assert decrypt_str(stored[ids[0]]) == "legacy|plain" and decrypt_str(stored[ids[1]]) == "already|sealed"

        await conn.run_sync(lambda sync: rev._rewrite(sync, encrypted=False, transform=rev._decrypt))
        plain = dict((await conn.execute(text("SELECT id, delivered_data FROM orders WHERE id = ANY(:ids)"), {"ids": ids})).all())
    assert plain == {ids[0]: "legacy|plain", ids[1]: "already|sealed"}


async def test_key_rotation_reencrypts_delivery_texts(client):
    rotate = _load(_ROOT / "scripts" / "rotate_encryption_key.py", "rotate_encryption_key_orders")
    old_secret = "previous-encryption-key-for-order-rotation"
    old_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(old_secret.encode()).digest()))
    ids = await _text_order_ids(client, 3)
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE orders SET delivered_data = :d WHERE id = :id"), [
            {"id": ids[0], "d": old_fernet.encrypt(b"old|key").decode()},
            {"id": ids[1], "d": "never|encrypted"},
            {"id": ids[2], "d": encrypt_str("current|key")},
        ])

    async with SessionLocal() as db:
        stats = await rotate._rotate_order_deliveries(db, old_fernet)
        await db.commit()
    assert stats["rotated"] == 2 and stats["current"] >= 1 and stats["undecryptable"] == []
    async with engine.connect() as conn:
        stored = dict((await conn.execute(text("SELECT id, delivered_data FROM orders WHERE id = ANY(:ids)"), {"ids": ids})).all())
    assert {i: decrypt_str(v) for i, v in stored.items()} == {ids[0]: "old|key", ids[1]: "never|encrypted", ids[2]: "current|key"}


async def test_admin_orders_pulse_flags_disputes_stuck_orders_and_bursts(client):
    from datetime import datetime, timedelta, timezone
    from src.models.order import Dispute, OrderStatus

    order, buyer, seller, admin, _ = await _instant_order(client, quantity=1)
    async with SessionLocal() as db:
        source = await db.get(Order, order["id"])
        # Nine more orders from the same buyer at the same shop within minutes: a burst.
        for _ in range(9):
            db.add(Order(
                buyer_id=source.buyer_id, seller_id=source.seller_id, variant_id=source.variant_id,
                product_id=source.product_id, quantity=1, total_amount=source.total_amount,
                status=OrderStatus.completed,
            ))
        stuck = Order(
            buyer_id=source.buyer_id, seller_id=source.seller_id, variant_id=source.variant_id,
            product_id=source.product_id, quantity=1, total_amount=source.total_amount,
            status=OrderStatus.pending, created_at=datetime.now(timezone.utc) - timedelta(minutes=20),
        )
        db.add(stuck)
        db.add(Dispute(order_id=source.id, buyer_id=source.buyer_id, reason="Không đăng nhập được"))
        await db.commit()
        stuck_id = stuck.id

    pulse = (await client.get("/admin/orders/pulse", headers=_auth(admin))).json()
    assert pulse["today_count"] >= 10 and len(pulse["spark"]) == 7
    assert [row["id"] for row in pulse["disputed"]] == [order["id"]]
    assert [row["id"] for row in pulse["stuck"]] == [stuck_id]
    assert pulse["disputes_7d"] == 1 and pulse["orders_7d"] == 11
    [burst] = pulse["bursts"]
    assert burst["count"] == 11 and burst["new_buyer"] is True
    assert burst["buyer_id"] == order["buyer_id"]
    assert (await client.get("/admin/orders/pulse", params={"tz": "Mars/Base"}, headers=_auth(admin))).status_code == 400
    assert (await client.get("/admin/orders/pulse", headers=_auth(seller))).status_code == 403
