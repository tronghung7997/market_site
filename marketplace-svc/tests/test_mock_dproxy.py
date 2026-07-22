from __future__ import annotations

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
