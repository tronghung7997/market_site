"""GET /admin/logs resolves ids to records; /related explains a row."""
import pytest

from src.audit.service import log_event
from src.database import SessionLocal
from tests.test_orders import setup_buyable_product


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _setup(client):
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    order = (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))).json()
    me = (await client.get("/me", headers=_auth(admin_token))).json()
    return _auth(admin_token), _auth(seller_token), order, me["id"]


@pytest.mark.asyncio
async def test_log_rows_name_the_actor_and_records(client):
    admin, _, order, admin_id = await _setup(client)
    async with SessionLocal() as db:
        await log_event(db, "info", "manual note", request_id="req-explorer-1", metadata={
            "event": "admin_order_note", "actor_id": admin_id, "actor_type": "admin",
            "subject_type": "order", "subject_id": order["id"], "seller_id": order["seller_id"],
        })
        await log_event(db, "info", "second step", request_id="req-explorer-1", metadata={"event": "admin_order_note_mail"})
        await db.commit()

    rows = (await client.get("/admin/logs", params={"event": "admin_order_note"}, headers=admin)).json()
    assert len(rows) == 1
    row = rows[0]
    assert row["actor"]["kind"] == "account" and row["actor"]["id"] == admin_id
    assert row["actor"]["href"] == f"/admin/accounts?account={admin_id}"
    kinds = {(r["kind"], r["id"]) for r in row["refs"]}
    assert ("order", order["id"]) in kinds and ("account", order["seller_id"]) in kinds
    order_ref = next(r for r in row["refs"] if r["kind"] == "order")
    assert order_ref["label"] == order["order_code"]
    assert order_ref["href"] == f"/admin/orders/{order['id']}"

    related = (await client.get(f"/admin/logs/{row['id']}/related", headers=admin)).json()
    assert "second step" in [r["message"] for r in related]


@pytest.mark.asyncio
async def test_account_filter_matches_actor_subject_and_role_keys(client):
    admin, _, order, _ = await _setup(client)
    seller_id = order["seller_id"]
    async with SessionLocal() as db:
        await log_event(db, "info", "as seller", metadata={"event": "x_seller", "seller_id": seller_id})
        await log_event(db, "info", "as subject", metadata={"event": "x_subject", "subject_type": "account", "subject_id": seller_id})
        await log_event(db, "info", "unrelated", metadata={"event": "x_other", "seller_id": seller_id + 999})
        await db.commit()
    events = {r["metadata"]["event"] for r in (await client.get("/admin/logs", params={"account_id": seller_id}, headers=admin)).json()
              if (r["metadata"] or {}).get("event", "").startswith("x_")}
    assert events == {"x_seller", "x_subject"}


@pytest.mark.asyncio
async def test_log_explorer_is_admin_only(client):
    _, seller, _, _ = await _setup(client)
    assert (await client.get("/admin/logs", headers=seller)).status_code == 403
    assert (await client.get("/admin/logs/1/related", headers=seller)).status_code == 403
