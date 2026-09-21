"""Admin-tunable seller tiers: product cap, withdrawal ceiling, fee discount, escrow reduction."""
import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.log_entry import LogEntry
from src.models.order import Order
from tests.conftest import make_admin, make_seller, register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seller_with_category(client, email="tier_seller@example.com"):
    admin = "tier_admin@example.com"
    await register_and_login(client, admin)
    await make_admin(admin)
    admin_token = await register_and_login(client, admin)
    await client.post("/admin/categories", json={"name": "TierCat", "slug": "tiercat"}, headers=_auth(admin_token))
    cat_id = (await client.get("/categories")).json()[-1]["id"]
    await register_and_login(client, email)
    await make_seller(email)
    seller_token = await register_and_login(client, email)
    return admin_token, seller_token, cat_id


async def _product(client, token, cat_id, title, status="active"):
    resp = await client.post("/seller/products", json={"category_id": cat_id, "title": title, "status": status}, headers=_auth(token))
    return resp


@pytest.mark.asyncio
async def test_config_seeds_defaults_updates_and_audits(client):
    admin_token, _, _ = await _seller_with_category(client)
    cfg = await client.get("/admin/seller-tier-config", headers=_auth(admin_token))
    assert cfg.status_code == 200, cfg.text
    by_tier = {t["tier"]: t for t in cfg.json()["tiers"]}
    assert [t["tier"] for t in cfg.json()["tiers"]] == ["new", "verified", "trusted", "enterprise"]
    assert by_tier["new"]["max_active_products"] == 3 and by_tier["enterprise"]["max_active_products"] is None
    assert by_tier["new"]["withdraw_limit_per_request"] == 2_000_000 and by_tier["trusted"]["fee_discount_pp"] == 2

    upd = await client.patch("/admin/seller-tier-config", json={"tiers": {
        "new": {"max_active_products": 1},
        "verified": {"max_active_products": None, "withdraw_limit_per_request": 12_345_678},
    }}, headers=_auth(admin_token))
    assert upd.status_code == 200, upd.text
    by_tier = {t["tier"]: t for t in upd.json()["tiers"]}
    assert by_tier["new"]["max_active_products"] == 1
    assert by_tier["verified"]["max_active_products"] is None and by_tier["verified"]["withdraw_limit_per_request"] == 12_345_678
    assert by_tier["trusted"]["max_active_products"] == 10   # untouched
    async with SessionLocal() as db:
        entry = (await db.execute(select(LogEntry).where(LogEntry.metadata_["event"].astext == "seller_tier_config_changed"))).scalar_one()
    assert entry.metadata_["changed"]["new"]["max_active_products"] == [3, 1]
    assert entry.metadata_["changed"]["verified"]["max_active_products"] == [5, None]

    assert (await client.patch("/admin/seller-tier-config", json={"tiers": {"gold": {"fee_discount_pp": 1}}}, headers=_auth(admin_token))).status_code == 422
    assert (await client.patch("/admin/seller-tier-config", json={"tiers": {"new": {"fee_discount_pp": 101}}}, headers=_auth(admin_token))).status_code == 422
    public = await client.get("/public/seller-tiers")
    assert public.status_code == 200 and public.json()["tiers"][0]["max_active_products"] == 1


@pytest.mark.asyncio
async def test_active_product_cap_applies_to_create_status_and_bulk(client):
    admin_token, seller_token, cat_id = await _seller_with_category(client)
    assert (await client.patch("/admin/seller-tier-config", json={"tiers": {"new": {"max_active_products": 2}}}, headers=_auth(admin_token))).status_code == 200

    p1 = await _product(client, seller_token, cat_id, "One")
    p2 = await _product(client, seller_token, cat_id, "Two")
    assert p1.status_code == 201 and p2.status_code == 201
    third = await _product(client, seller_token, cat_id, "Three")
    assert third.status_code == 409 and third.json()["error_code"] == "PRODUCT_LIMIT_REACHED"
    assert third.json()["params"] == {"limit": 2}
    # Drafts are free; only "on sale" counts.
    draft = await _product(client, seller_token, cat_id, "Draft", status="draft")
    assert draft.status_code == 201
    activate = await client.put(f"/seller/products/{draft.json()['id']}/status", json={"status": "active"}, headers=_auth(seller_token))
    assert activate.status_code == 409 and activate.json()["error_code"] == "PRODUCT_LIMIT_REACHED"
    # Pausing one frees a slot.
    assert (await client.put(f"/seller/products/{p1.json()['id']}/status", json={"status": "paused"}, headers=_auth(seller_token))).status_code == 200
    assert (await client.put(f"/seller/products/{draft.json()['id']}/status", json={"status": "active"}, headers=_auth(seller_token))).status_code == 200
    # Bulk: activates up to the cap, reports the rest with reason tier_limit.
    draft2 = await _product(client, seller_token, cat_id, "Draft2", status="draft")
    bulk = await client.post("/seller/products/bulk-status", json={"ids": [p1.json()["id"], draft2.json()["id"]], "status": "active"}, headers=_auth(seller_token))
    assert bulk.status_code == 200, bulk.text
    assert bulk.json()["updated"] == [] and {s["reason"] for s in bulk.json()["skipped"]} == {"tier_limit"}
    # The seller console sees tier + cap.
    listing = (await client.get("/seller/products", headers=_auth(seller_token))).json()
    assert listing["counts"]["tier"] == "new" and listing["counts"]["max_active_products"] == 2 and listing["counts"]["active"] == 2
    # Upgrading the seller lifts the cap immediately.
    seller_id = (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    up = await client.patch(f"/admin/accounts/{seller_id}/tier", json={"seller_tier": "enterprise"}, headers=_auth(admin_token))
    assert up.status_code == 200, up.text
    assert (await client.put(f"/seller/products/{p1.json()['id']}/status", json={"status": "active"}, headers=_auth(seller_token))).status_code == 200


@pytest.mark.asyncio
async def test_tier_levers_drive_withdraw_limit_fee_and_escrow(client):
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    seller_id = (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test", "account_id": seller_id, "amount": 5_000_000}, headers=_auth(admin_token))
    bank = {"bank_name": "MB", "bank_account_number": "0123456789", "bank_account_holder": "SELLER"}

    # Withdrawal ceiling comes from the config, not the old constant.
    assert (await client.patch("/admin/seller-tier-config", json={"tiers": {"new": {"withdraw_limit_per_request": 1_000_000, "fee_discount_pp": 4, "escrow_reduction_days": 1}}}, headers=_auth(admin_token))).status_code == 200
    wallet = (await client.get("/wallet", headers=_auth(seller_token))).json()
    assert wallet["withdraw_policy"]["limit_per_request"] == 1_000_000
    assert (await client.post("/wallet/withdraw", json={"amount": 1_500_000, **bank}, headers=_auth(seller_token))).status_code == 400
    assert (await client.post("/wallet/withdraw", json={"amount": 900_000, **bank}, headers=_auth(seller_token))).status_code == 200

    # Fee: 10 % platform fee minus a 4-point tier discount = 6 % of 1 000.
    assert (await client.patch("/admin/fee-config", json={"platform_fee_percent": 10}, headers=_auth(admin_token))).status_code == 200
    before = (await client.get("/wallet", headers=_auth(seller_token))).json()["available_balance"]
    order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    assert order.status_code == 201
    async with SessionLocal() as db:
        o = await db.get(Order, order.json()["id"])
        from datetime import datetime, timedelta, timezone
        # Product hold 2 days minus 1 tier day = 1 day.
        assert timedelta(hours=23) < o.escrow_expires_at - datetime.now(timezone.utc) <= timedelta(days=1)
    assert (await client.post(f"/orders/{order.json()['id']}/confirm", headers=_auth(buyer_token))).status_code == 200
    after = (await client.get("/wallet", headers=_auth(seller_token))).json()["available_balance"]
    assert after - before == 940
