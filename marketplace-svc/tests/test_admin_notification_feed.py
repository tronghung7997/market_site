"""Admin bell feed: alerts grouped by type, per-admin unread marker, auth."""
import pytest

from src.alerts.service import upsert_incident
from src.database import SessionLocal
from tests.conftest import make_admin, register_and_login


async def _admin(client, email: str):
    await register_and_login(client, email)
    await make_admin(email)
    return {"Authorization": f"Bearer {await register_and_login(client, email)}"}


async def _incident(fp: str, type_: str, severity: str, message: str) -> None:
    async with SessionLocal() as db:
        await upsert_incident(
            db, fingerprint=fp, type_=type_, severity=severity,
            target_type="provider", target_id=1, message=message,
        )
        await db.commit()


@pytest.mark.asyncio
async def test_feed_groups_by_type_and_tracks_seen_per_admin(client):
    a = await _admin(client, "feed-a@test.com")
    b = await _admin(client, "feed-b@test.com")
    for i in range(3):
        await _incident(f"dp-{i}", "dproxy_unavailable", "warning", f"DProxy không phản hồi #{i}")
    await _incident("ledger-1", "ledger_mismatch", "critical", "Sổ cái lệch")

    feed = await client.get("/admin/notifications/feed", headers=a)
    assert feed.status_code == 200, feed.text
    body = feed.json()
    by_type = {g["type"]: g for g in body["items"]}
    assert by_type["dproxy_unavailable"]["count"] == 3
    assert by_type["dproxy_unavailable"]["href"] == "/admin/alerts?type=dproxy_unavailable"
    assert by_type["ledger_mismatch"]["count"] == 1
    assert by_type["ledger_mismatch"]["severity"] == "critical"
    assert body["items"][0]["type"] == "ledger_mismatch"  # newest first
    assert body["unread_count"] == 2 and all(g["unread"] for g in body["items"])

    assert (await client.post("/admin/notifications/seen", headers=a)).status_code == 204
    seen = (await client.get("/admin/notifications/feed", headers=a)).json()
    assert seen["unread_count"] == 0 and not any(g["unread"] for g in seen["items"])
    # B has not opened the bell.
    assert (await client.get("/admin/notifications/feed", headers=b)).json()["unread_count"] == 2

    # The same type firing again is unread again for A.
    await _incident("dp-9", "dproxy_unavailable", "warning", "DProxy không phản hồi #9")
    again = (await client.get("/admin/notifications/feed", headers=a)).json()
    assert again["unread_count"] == 1
    assert {g["type"]: g["unread"] for g in again["items"]} == {"dproxy_unavailable": True, "ledger_mismatch": False}

    limited = (await client.get("/admin/notifications/feed?limit=1", headers=a)).json()
    assert len(limited["items"]) == 1 and limited["unread_count"] == 1


@pytest.mark.asyncio
async def test_feed_requires_admin(client):
    assert (await client.get("/admin/notifications/feed")).status_code in (401, 403)
    buyer = {"Authorization": f"Bearer {await register_and_login(client, 'feed-buyer@test.com')}"}
    assert (await client.get("/admin/notifications/feed", headers=buyer)).status_code == 403
    assert (await client.post("/admin/notifications/seen", headers=buyer)).status_code == 403
