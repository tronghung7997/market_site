from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from scripts import mock_dproxy


pytestmark = pytest.mark.no_db

API_HEADERS = {"Authorization": "Bearer mock-dproxy-token"}
CONTROL_HEADERS = {"X-Mock-Control-Key": "mock-dproxy-control"}
DASHBOARD_AUTH = ("admin", "mock-dashboard-password")


@pytest.fixture(autouse=True)
def _reset_mock_state():
    mock_dproxy.reset_state()


@pytest.fixture
async def dproxy_client():
    async with AsyncClient(
        transport=ASGITransport(app=mock_dproxy.app), base_url="http://mock-dproxy"
    ) as client:
        yield client


@pytest.mark.asyncio
async def test_list_contract_and_auth(dproxy_client: AsyncClient):
    assert (await dproxy_client.get("/")).status_code == 401
    dashboard = await dproxy_client.get("/", auth=DASHBOARD_AUTH)
    assert dashboard.status_code == 200
    assert "Mock DProxy" in dashboard.text
    assert "text/html" in dashboard.headers["content-type"]

    assert (await dproxy_client.get("/api/v1/proxies/user")).status_code == 401

    response = await dproxy_client.get("/api/v1/proxies/user", headers=API_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 3
    assert body[0]["status"] == "active"
    assert body[0]["proxies"]["status"]["msg"] == "online"
    assert body[0]["proxies"]["rotation"]["rotate_endpoint"].endswith("/rotate")
    assert "_rotation_count" not in body[0]


@pytest.mark.asyncio
async def test_rotate_changes_ip_and_enforces_cooldown(dproxy_client: AsyncClient):
    assignments = (await dproxy_client.get("/api/v1/proxies/user", headers=API_HEADERS)).json()
    item = assignments[0]
    path = item["proxies"]["rotation"]["rotate_endpoint"]
    old_ip = item["proxies"]["ip_public"]
    other_ips = {assignment["proxies"]["ip_public"] for assignment in assignments[1:]}

    rotated = await dproxy_client.post(path, headers=API_HEADERS)
    assert rotated.status_code == 200
    assert rotated.json()["ip_public"] != old_ip
    assert rotated.json()["ip_public"] not in other_ips

    cooldown = await dproxy_client.post(path, headers=API_HEADERS)
    assert cooldown.status_code == 429
    assert int(cooldown.headers["retry-after"]) >= 1


@pytest.mark.asyncio
async def test_control_api_drives_offline_expired_and_failure_cases(dproxy_client: AsyncClient):
    assignments = (await dproxy_client.get("/api/v1/proxies/user", headers=API_HEADERS)).json()
    assignment_id = assignments[0]["id"]

    patched = await dproxy_client.patch(
        f"/_mock/assignments/{assignment_id}",
        headers=CONTROL_HEADERS,
        json={"proxy_status": "offline", "expires_in_seconds": -1},
    )
    assert patched.status_code == 200
    assert patched.json()["proxies"]["status"]["msg"] == "offline"

    mode = await dproxy_client.put(
        "/_mock/mode", headers=CONTROL_HEADERS, json={"mode": "list_malformed"}
    )
    assert mode.json()["mode"] == "list_malformed"
    malformed = await dproxy_client.get("/api/v1/proxies/user", headers=API_HEADERS)
    assert isinstance(malformed.json(), dict)

    reset = await dproxy_client.post("/_mock/reset", headers=CONTROL_HEADERS)
    assert reset.json() == {"ok": True, "assignment_count": 3}
    normal = await dproxy_client.get("/api/v1/proxies/user", headers=API_HEADERS)
    assert len(normal.json()) == 3


@pytest.mark.asyncio
async def test_control_api_requires_separate_secret(dproxy_client: AsyncClient):
    assert (await dproxy_client.get("/_mock/state")).status_code == 401
    assert (await dproxy_client.get("/_mock/state", headers=API_HEADERS)).status_code == 401
    assert (await dproxy_client.get("/_mock/state", headers=CONTROL_HEADERS)).status_code == 200


@pytest.mark.asyncio
async def test_default_assignment_ids_are_canonical_uuids(dproxy_client: AsyncClient):
    """review fixes Blocker 3 requires strict UUID parsing on the real
    adapter side — the mock's default fixtures must keep satisfying that,
    or every other test collapses silently (empty inventory)."""
    assignments = (await dproxy_client.get("/api/v1/proxies/user", headers=API_HEADERS)).json()
    assert len(assignments) == 3
    for item in assignments:
        assert str(UUID(item["id"])) == item["id"]  # already canonical form
        assert item["proxies"]["rotation"]["rotate_endpoint"] == f"/api/v1/proxies/user/{item['id']}/rotate"


@pytest.mark.asyncio
async def test_patch_credentials_independently(dproxy_client: AsyncClient):
    """review fixes Blocker 1's regression needs to change ONE credential
    field at a time over the real HTTP boundary."""
    assignments = (await dproxy_client.get("/api/v1/proxies/user", headers=API_HEADERS)).json()
    assignment_id = assignments[0]["id"]
    original = assignments[0]

    patched = await dproxy_client.patch(
        f"/_mock/assignments/{assignment_id}", headers=CONTROL_HEADERS,
        json={"password": "new-password-only"},
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["password"] == "new-password-only"
    assert body["username"] == original["username"]
    assert body["proxies"]["host"] == original["proxies"]["host"]
    assert body["proxies"]["port"] == original["proxies"]["port"]
    assert body["proxies"]["ip_public"] == original["proxies"]["ip_public"]

    patched2 = await dproxy_client.patch(
        f"/_mock/assignments/{assignment_id}", headers=CONTROL_HEADERS,
        json={"username": "new-user", "host": "10.0.0.5", "port": 9999, "public_ip": "198.51.100.7"},
    )
    assert patched2.status_code == 200
    body2 = patched2.json()
    assert body2["username"] == "new-user"
    assert body2["proxies"]["host"] == "10.0.0.5"
    assert body2["proxies"]["port"] == 9999
    assert body2["proxies"]["ip_public"] == "198.51.100.7"
    assert body2["password"] == "new-password-only"  # untouched by this second patch


@pytest.mark.asyncio
async def test_password_only_rotate_behavior_leaves_ip_and_expiry_untouched(dproxy_client: AsyncClient):
    assignments = (await dproxy_client.get("/api/v1/proxies/user", headers=API_HEADERS)).json()
    item = assignments[0]
    assignment_id = item["id"]
    path = item["proxies"]["rotation"]["rotate_endpoint"]
    old_ip = item["proxies"]["ip_public"]
    old_expiry = item["expired_at"]
    old_password = item["password"]

    mode = await dproxy_client.patch(
        f"/_mock/assignments/{assignment_id}", headers=CONTROL_HEADERS,
        json={"rotate_behavior": "password_only"},
    )
    assert mode.status_code == 200

    rotated = await dproxy_client.post(path, headers=API_HEADERS)
    assert rotated.status_code == 200
    assert rotated.json()["ip_public"] == old_ip  # unchanged — password_only behavior

    refreshed = (await dproxy_client.get("/api/v1/proxies/user", headers=API_HEADERS)).json()
    updated = next(a for a in refreshed if a["id"] == assignment_id)
    assert updated["proxies"]["ip_public"] == old_ip
    assert updated["expired_at"] == old_expiry
    assert updated["password"] != old_password


@pytest.mark.asyncio
async def test_dashboard_html_has_online_offline_controls(dproxy_client: AsyncClient):
    """review fixes docs/superpowers/plans/2026-07-22-dproxy-consolidated-review.md
    P1 "Mock dashboard chưa đáp ứng checklist" — a manual tester needs
    online/offline buttons wired to PATCH /_mock/assignments/{id}, not just
    curl. Checks the served HTML/JS contains the controls and calls the
    right endpoint/payload shape, not just that the page renders."""
    dashboard = await dproxy_client.get("/", auth=DASHBOARD_AUTH)
    assert dashboard.status_code == 200
    html = dashboard.text

    assert "setOnline" in html
    assert "Đặt Offline" in html
    assert "Đặt Online" in html
    assert "/_mock/assignments/" in html
    assert '"proxy_status":"offline"' in html or "proxy_status:'offline'" in html
    assert '"proxy_status":"online"' in html or "proxy_status:'online'" in html
    # Rotate must be disabled in the row markup when the assignment is
    # offline — not just left clickable and erroring server-side.
    assert "disabled" in html
    assert "rotate(" in html


@pytest.mark.asyncio
async def test_online_offline_dashboard_endpoint_round_trips(dproxy_client: AsyncClient):
    """The exact PATCH payloads the dashboard's setOnline() sends — confirms
    the mock's own control API accepts them and the assignment's usability
    flips accordingly (online -> is_active/status/proxy_status all "on";
    offline -> proxy_status alone is enough, matching what reconciliation
    treats as "not online")."""
    assignments = (await dproxy_client.get("/api/v1/proxies/user", headers=API_HEADERS)).json()
    assignment_id = assignments[0]["id"]

    offline = await dproxy_client.patch(
        f"/_mock/assignments/{assignment_id}", headers=CONTROL_HEADERS,
        json={"proxy_status": "offline"},
    )
    assert offline.status_code == 200
    assert offline.json()["proxies"]["status"]["msg"] == "offline"

    online = await dproxy_client.patch(
        f"/_mock/assignments/{assignment_id}", headers=CONTROL_HEADERS,
        json={"proxy_status": "online", "status": "active", "is_active": True},
    )
    assert online.status_code == 200
    body = online.json()
    assert body["proxies"]["status"]["msg"] == "online"
    assert body["status"] == "active"
    assert body["is_active"] is True


PLAN_VN_7D = "1906e1af-70df-4a53-8874-53b8e5a51935"
PLAN_US_30D = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"


@pytest.mark.asyncio
async def test_store_plans_match_sales_plan_contract(dproxy_client: AsyncClient):
    default = await dproxy_client.get("/api/v1/store/plans", headers=API_HEADERS)
    assert default.status_code == 200
    body = default.json()
    assert isinstance(body, list)
    assert {item["id"] for item in body} == {PLAN_VN_7D, PLAN_US_30D}
    for item in body:
        for key in ("id", "name", "proxy_count", "duration_days", "price", "currency"):
            assert key in item
        assert "_proxy_type" not in item
        assert "_country" not in item

    assert (await dproxy_client.put(
        "/_mock/plans", json={"plans": []},
    )).status_code == 401

    updated = await dproxy_client.put(
        "/_mock/plans", headers=CONTROL_HEADERS,
        json={"plans": [{
            "id": PLAN_VN_7D, "name": "Only VN", "proxy_count": 1,
            "duration_days": 7, "price": 1, "currency": "USD",
        }]},
    )
    assert updated.status_code == 200
    refreshed = await dproxy_client.get("/api/v1/store/plans", headers=API_HEADERS)
    assert [item["id"] for item in refreshed.json()] == [PLAN_VN_7D]


@pytest.mark.asyncio
async def test_partner_purchase_returns_documented_m2m_shape(dproxy_client: AsyncClient):
    before = (await dproxy_client.get("/api/v1/proxies/user", headers=API_HEADERS)).json()
    assert len(before) == 3

    purchased = await dproxy_client.post(
        "/api/v1/customer/marketplace/partner-purchase", headers=API_HEADERS,
        json={
            "partner_order_id": "THM-987654",
            "plan_id": PLAN_US_30D,
            "quantity": 1,
            "channel": "proxora",
            "metadata": {"proxora_order_id": "99"},
        },
    )
    assert purchased.status_code == 200
    body = purchased.json()
    assert body["success"] is True
    data = body["data"]
    assert data["partner_order_id"] == "THM-987654"
    assert data["status"] == "fulfilled"
    assert data["quantity"] == 1
    assert str(UUID(data["order_id"])) == data["order_id"]
    proxy = data["proxies"][0]
    assert set(proxy) >= {"ip", "port", "username", "password", "formatted_string", "socks5_url", "expires_at"}
    assert data["export_text"] == proxy["formatted_string"]
    assert proxy["formatted_string"] == f"{proxy['ip']}:{proxy['port']}:{proxy['username']}:{proxy['password']}"
    expires_at = datetime.fromisoformat(proxy["expires_at"])
    assert 29.9 <= (expires_at - datetime.now(timezone.utc)).total_seconds() / 86400 <= 30.1

    after = (await dproxy_client.get("/api/v1/proxies/user", headers=API_HEADERS)).json()
    assert len(after) == 4
    assert data["order_id"] not in {a["id"] for a in before}


@pytest.mark.asyncio
async def test_partner_purchase_rejects_quantity_other_than_one(dproxy_client: AsyncClient):
    resp = await dproxy_client.post(
        "/api/v1/customer/marketplace/partner-purchase", headers=API_HEADERS,
        json={"partner_order_id": "THM-Q", "plan_id": PLAN_VN_7D, "quantity": 3},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_partner_purchase_is_idempotent_on_partner_order_id(dproxy_client: AsyncClient):
    payload = {
        "partner_order_id": "THM-DUP",
        "plan_id": PLAN_VN_7D,
        "quantity": 1,
        "channel": "proxora",
    }
    first = await dproxy_client.post(
        "/api/v1/customer/marketplace/partner-purchase", headers=API_HEADERS, json=payload,
    )
    second = await dproxy_client.post(
        "/api/v1/customer/marketplace/partner-purchase", headers=API_HEADERS, json=payload,
    )
    assert first.status_code == second.status_code == 200
    assert first.json()["data"]["order_id"] == second.json()["data"]["order_id"]
    after = (await dproxy_client.get("/api/v1/proxies/user", headers=API_HEADERS)).json()
    assert len(after) == 4
