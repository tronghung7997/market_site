"""Maintenance mode, money kill-switches and the announcement bar."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.log_entry import LogEntry
from src.site_status import pausable
from src.site_status.service import announcement_is_live
from tests.conftest import make_admin, register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _admin(client, email="st_admin@example.com"):
    await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


@pytest.mark.asyncio
async def test_kill_switches_block_only_their_flow_and_are_audited(client):
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    seller_id = (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test", "account_id": seller_id, "amount": 500_000}, headers=_auth(admin_token))
    withdraw_body = {"amount": 100_000, "bank_name": "MB", "bank_account_number": "0123456789", "bank_account_holder": "SELLER"}

    on = await client.patch(
        "/admin/site-status",
        json={"withdrawals_frozen": True, "orders_frozen": True, "freeze_reason": "suspected ledger bug"},
        headers=_auth(admin_token),
    )
    assert on.status_code == 200, on.text
    assert on.json()["withdrawals_frozen"] is True and on.json()["deposits_frozen"] is False

    order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    assert order.status_code == 503 and order.json()["error_code"] == "ORDERS_FROZEN"
    withdraw = await client.post("/wallet/withdraw", json=withdraw_body, headers=_auth(seller_token))
    assert withdraw.status_code == 503 and withdraw.json()["error_code"] == "WITHDRAWALS_FROZEN"
    # Deposits untouched, browsing untouched, admin untouched.
    assert (await client.get("/wallet/deposit-methods", headers=_auth(buyer_token))).status_code == 200
    assert (await client.get("/products")).status_code == 200
    assert (await client.get("/admin/withdrawals", headers=_auth(admin_token))).status_code == 200
    # Public status never leaks the internal reason.
    public = (await client.get("/public/site-status")).json()
    assert public["orders_frozen"] is True and "freeze_reason" not in public

    off = await client.patch("/admin/site-status", json={"withdrawals_frozen": False, "orders_frozen": False}, headers=_auth(admin_token))
    assert off.status_code == 200
    assert (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))).status_code == 201
    assert (await client.post("/wallet/withdraw", json=withdraw_body, headers=_auth(seller_token))).status_code == 200

    async with SessionLocal() as db:
        rows = list((await db.execute(
            select(LogEntry).where(LogEntry.metadata_["event"].astext == "site_runtime_config_changed").order_by(LogEntry.id)
        )).scalars())
    assert len(rows) == 2
    assert rows[0].level == "warning"
    assert rows[0].metadata_["changed"]["orders_frozen"] == [False, True]
    assert rows[0].metadata_["changed"]["freeze_reason"] == ["", "suspected ledger bug"]


@pytest.mark.asyncio
async def test_maintenance_blocks_non_admins_but_keeps_ops_paths_open(client):
    buyer_token, _, admin_token, instant_vid, _ = await setup_buyable_product(client)
    on = await client.patch(
        "/admin/site-status",
        json={"maintenance_enabled": True, "maintenance_message_vi": "Bảo trì ngân hàng", "maintenance_message_en": "Bank maintenance"},
        headers=_auth(admin_token),
    )
    assert on.status_code == 200, on.text

    # Storefront and buyer APIs are shut…
    for path, headers in (("/products", None), ("/wallet", _auth(buyer_token)), ("/orders", _auth(buyer_token))):
        resp = await client.get(path, headers=headers)
        assert resp.status_code == 503, path
        assert resp.json()["error_code"] == "MAINTENANCE"
    assert (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))).status_code == 503
    # …but health, the public status, /me, sign-in and the admin console are not.
    assert (await client.get("/health")).status_code == 200
    public = (await client.get("/public/site-status")).json()
    assert public["maintenance_enabled"] is True and public["maintenance_message_vi"] == "Bảo trì ngân hàng"
    assert (await client.get("/me", headers=_auth(buyer_token))).status_code == 200
    assert (await client.post("/auth/login", json={"email": "ord_buyer@example.com", "password": "StrongPass123!"})).status_code == 200
    assert (await client.get("/admin/accounts", headers=_auth(admin_token))).status_code == 200
    # An admin token opens every route, even storefront ones.
    assert (await client.get("/products", headers=_auth(admin_token))).status_code == 200
    # Payment webhooks are not gated (a bad signature is still a 4xx, never 503).
    hook = await client.post("/webhooks/sepay", json={})
    assert hook.status_code != 503

    off = await client.patch("/admin/site-status", json={"maintenance_enabled": False}, headers=_auth(admin_token))
    assert off.status_code == 200
    assert (await client.get("/products")).status_code == 200


@pytest.mark.asyncio
async def test_pausable_job_skips_during_maintenance(client):
    admin_token = await _admin(client)
    calls: list[int] = []

    async def job() -> None:
        calls.append(1)

    wrapped = pausable(job)
    await wrapped()
    assert calls == [1]
    await client.patch("/admin/site-status", json={"maintenance_enabled": True}, headers=_auth(admin_token))
    await wrapped()
    assert calls == [1]
    await client.patch("/admin/site-status", json={"maintenance_enabled": False}, headers=_auth(admin_token))
    await wrapped()
    assert calls == [1, 1]


@pytest.mark.asyncio
async def test_announcement_schedule_version_and_public_shape(client):
    admin_token = await _admin(client)
    assert (await client.get("/public/site-status")).json()["announcement"] is None

    now = datetime.now(timezone.utc)
    resp = await client.patch(
        "/admin/site-status",
        json={
            "announcement_enabled": True, "announcement_level": "warn",
            "announcement_text_vi": "Ngân hàng bảo trì 23h–1h", "announcement_text_en": "Bank maintenance 23:00–01:00",
            "announcement_link_url": "/legal/escrow",
            "announcement_starts_at": (now - timedelta(hours=1)).isoformat(),
            "announcement_ends_at": (now + timedelta(hours=1)).isoformat(),
        },
        headers=_auth(admin_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["announcement_version"] == 2
    live = (await client.get("/public/site-status")).json()["announcement"]
    assert live == {"level": "warn", "text_vi": "Ngân hàng bảo trì 23h–1h", "text_en": "Bank maintenance 23:00–01:00", "link_url": "/legal/escrow", "version": 2}

    # Editing only the schedule keeps the version; editing the text bumps it.
    same = await client.patch("/admin/site-status", json={"announcement_ends_at": (now + timedelta(hours=2)).isoformat()}, headers=_auth(admin_token))
    assert same.json()["announcement_version"] == 2
    bumped = await client.patch("/admin/site-status", json={"announcement_text_vi": "Đã xong"}, headers=_auth(admin_token))
    assert bumped.json()["announcement_version"] == 3

    # A window in the future hides it; clearing the window shows it again.
    future = await client.patch("/admin/site-status", json={"announcement_starts_at": (now + timedelta(days=1)).isoformat()}, headers=_auth(admin_token))
    assert future.status_code == 200
    assert (await client.get("/public/site-status")).json()["announcement"] is None
    cleared = await client.patch("/admin/site-status", json={"clear_announcement_window": True}, headers=_auth(admin_token))
    assert cleared.json()["announcement_starts_at"] is None
    assert (await client.get("/public/site-status")).json()["announcement"]["version"] == 3

    bad = await client.patch("/admin/site-status", json={"announcement_level": "purple"}, headers=_auth(admin_token))
    assert bad.status_code == 422
    user_token = await register_and_login(client, "st_user@example.com")
    assert (await client.patch("/admin/site-status", json={"maintenance_enabled": True}, headers=_auth(user_token))).status_code == 403


@pytest.mark.no_db
def test_announcement_is_live_pure():
    base = {"announcement_enabled": True, "announcement_text_vi": "x", "announcement_text_en": "",
            "announcement_starts_at": None, "announcement_ends_at": None}
    now = datetime(2026, 9, 18, 12, tzinfo=timezone.utc)
    assert announcement_is_live(base, now)
    assert not announcement_is_live({**base, "announcement_enabled": False}, now)
    assert not announcement_is_live({**base, "announcement_text_vi": ""}, now)
    assert not announcement_is_live({**base, "announcement_starts_at": "2026-09-18T13:00:00+00:00"}, now)
    assert not announcement_is_live({**base, "announcement_ends_at": "2026-09-18T11:00:00+00:00"}, now)
