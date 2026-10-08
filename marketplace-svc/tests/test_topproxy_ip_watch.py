"""TopProxy proxy tĩnh: giao proxy TRUNG GIAN, theo dõi khi IP gốc / cổng vào đổi.

Response thật của `listproxy.php`/`muaproxy.php` có hai IP khác nhau (xác nhận
bằng panel đơn proxy 22491, 2026-10-07): `ip` = proxy gốc, IP trong `proxy` =
proxy trung gian. Buyer cầm trung gian; gốc chỉ để hiển thị và phát hiện đổi.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import undefer

from src.adapters.topproxy import StaticSnapshot, TopProxyContractError, TopProxyUnavailableError
from src.database import SessionLocal
from src.models.alert import Alert
from src.models.order import Order
from src.models.proxy_allocation import ProxyAllocation, ProxyIpChange
from src.proxies.ip_watch import apply_snapshots, topproxy_ip_watch_job, with_front

from .conftest import register_and_login
from .test_proxy_dashboard import _h, _topproxy_lines
from .test_topproxy_adapter import _adapter

ORIGIN = "123.18.180.117"
FRONT_HOST = "113.160.166.150"


def _row(idproxy=22491, *, origin=ORIGIN, front=FRONT_HOST, port=44579):
    return {
        "status": 100, "idproxy": idproxy, "loaiproxy": "VNPT", "ip": origin, "port": port, "user": "u", "password": "p",
        "type": "HTTPS", "proxy": f"{front}:{port}:u:p", "time": 1791453945,
    }


# ---------------------------------------------------------------------------
# Adapter — thuần
# ---------------------------------------------------------------------------


@pytest.mark.no_db
def test_assignment_delivers_the_intermediate_and_keeps_the_origin_aside():
    a = _adapter()._assignment_from_row(_row(), fallback_days=1, proxy_type="HTTP", network="VNPT")
    assert (a.host, a.port) == (FRONT_HOST, 44579)  # buyer connects to the intermediate
    assert a.public_ip == ORIGIN  # exit IP = origin
    assert a.proxy_id == f"{FRONT_HOST}:44579"  # front stored so the watcher can compare
    text = a.delivered_text()
    assert FRONT_HOST in text


@pytest.mark.no_db
def test_assignment_without_origin_has_no_exit_ip_instead_of_the_wrong_one():
    row = _row()
    del row["ip"]
    a = _adapter()._assignment_from_row(row, fallback_days=1, proxy_type="HTTP", network="VNPT")
    assert a.host == FRONT_HOST and a.public_ip is None


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_snapshots_normalise_listproxy_per_loaiproxy():
    adapter = _adapter()
    adapter._call_once = AsyncMock(return_value=[
        _row(1, origin="1.1.1.1", front="2.2.2.2", port=100),
        {"status": 100, "idproxy": 2, "ip": "3.3.3.3", "proxy": "garbage"},  # unparseable → skipped
        {"status": 104, "idproxy": 3, "ip": "4.4.4.4", "proxy": "5.5.5.5:1:u:p"},  # error row → skipped
    ])
    snaps = await adapter.list_static_snapshots("VNPT")
    assert list(snaps) == ["1"]
    assert snaps["1"] == StaticSnapshot(
        external_id="1", front_host="2.2.2.2", front_port=100, origin_ip="1.1.1.1",
        expires_at=datetime.fromtimestamp(1791453945, tz=timezone.utc),
    )
    assert adapter._call_once.await_args.args[1]["loaiproxy"] == "VNPT"  # `all` returns nothing upstream

    adapter._call_once = AsyncMock(return_value=[])
    assert await adapter.list_static_snapshots("FPT") == {}  # no proxies of that kind is valid
    adapter._call_once = AsyncMock(return_value={"status": 101})
    with pytest.raises(TopProxyContractError):
        await adapter.list_static_snapshots("VNPT")


@pytest.mark.no_db
def test_with_front_rewrites_only_host_and_port():
    text = "Host: 1.1.1.1\nPort: 80\nUsername: u\nPassword: host: 9\nLoại proxy: HTTP"
    assert with_front(text, "2.2.2.2", 8080) == "Host: 2.2.2.2\nPort: 8080\nUsername: u\nPassword: host: 9\nLoại proxy: HTTP"


# ---------------------------------------------------------------------------
# Theo dõi — trên dòng TopProxy tĩnh thật trong DB
# ---------------------------------------------------------------------------

NOW = datetime(2026, 10, 7, 12, 0, tzinfo=timezone.utc)


def _snap(external_id, *, origin, front="27.73.10.20", port=41234):
    return {external_id: StaticSnapshot(
        external_id=external_id, front_host=front, front_port=port, origin_ip=origin, expires_at=None,
    )}


async def _static_allocation(orders) -> tuple[int, str]:
    async with SessionLocal() as db:
        a = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == orders["static"].id))
        return a.id, a.external_id


async def _watch(allocation_id, snaps, now=NOW):
    async with SessionLocal() as db:
        out = await apply_snapshots(db, [allocation_id], snaps, now)
        await db.commit()
    return out


@pytest.mark.asyncio
async def test_first_run_baselines_a_legacy_line_without_reporting_a_change(client):
    buyer_token, orders = await _topproxy_lines(client, "_w_base")
    allocation_id, external_id = await _static_allocation(orders)
    # Legacy line: last_public_ip holds the intermediate IP, external_proxy_id is NULL.
    out = await _watch(allocation_id, _snap(external_id, origin=ORIGIN))
    assert out["baselined"] == 1 and out["origin_changed"] == 0
    async with SessionLocal() as db:
        a = await db.get(ProxyAllocation, allocation_id)
        assert a.last_public_ip == ORIGIN and a.external_proxy_id == "27.73.10.20:41234"
        assert a.public_ip_change_count == 0 and a.previous_public_ip is None
        assert (await db.scalar(select(ProxyIpChange.id))) is None
    line = (await client.get("/me/proxies?q=" + orders["static"].order_code, headers=_h(buyer_token))).json()["items"][0]
    assert line["public_ip"] == ORIGIN and line["previous_ip"] is None and line["ip_change_count"] == 0


@pytest.mark.asyncio
async def test_origin_change_is_recorded_and_shown_old_to_new(client):
    buyer_token, orders = await _topproxy_lines(client, "_w_origin")
    allocation_id, external_id = await _static_allocation(orders)
    await _watch(allocation_id, _snap(external_id, origin=ORIGIN))
    later = NOW + timedelta(hours=1)
    out = await _watch(allocation_id, _snap(external_id, origin="14.224.1.9"), now=later)
    assert out["origin_changed"] == 1 and out["front_changed"] == 0

    # Same snapshot again: nothing new.
    again = await _watch(allocation_id, _snap(external_id, origin="14.224.1.9"), now=later + timedelta(hours=1))
    assert again["origin_changed"] == 0

    line_id = f"{orders['static'].order_code}#01"
    line = (await client.get("/me/proxies?q=" + orders["static"].order_code, headers=_h(buyer_token))).json()["items"][0]
    assert line["public_ip"] == "14.224.1.9" and line["previous_ip"] == ORIGIN
    assert line["ip_change_count"] == 1 and line["ip_changed_at"].startswith("2026-10-07T13:00")
    # Host/port the buyer holds did not move.
    assert (line["host"], line["port"]) == ("27.73.10.20", 41234)

    resp = await client.get("/me/proxies/ip-changes", params={"line_id": line_id}, headers=_h(buyer_token))
    assert resp.status_code == 200
    assert resp.json() == [{"old_ip": ORIGIN, "new_ip": "14.224.1.9", "at": later.isoformat()}]


@pytest.mark.asyncio
async def test_front_change_rewrites_the_handover_text_and_alerts_admin(client):
    buyer_token, orders = await _topproxy_lines(client, "_w_front")
    allocation_id, external_id = await _static_allocation(orders)
    await _watch(allocation_id, _snap(external_id, origin=ORIGIN))
    out = await _watch(allocation_id, _snap(external_id, origin=ORIGIN, front="27.73.99.1", port=50000), now=NOW + timedelta(hours=1))
    assert out["front_changed"] == 1 and out["origin_changed"] == 0

    line = (await client.get("/me/proxies?q=" + orders["static"].order_code, headers=_h(buyer_token))).json()["items"][0]
    assert (line["host"], line["port"]) == ("27.73.99.1", 50000)
    assert line["username"] == "tpu" and line["password"] == "tpp"  # credentials untouched
    async with SessionLocal() as db:
        order = await db.get(Order, orders["static"].id, options=[undefer(Order.delivered_data)])
        assert "Host: 27.73.99.1" in order.delivered_data and "Port: 50000" in order.delivered_data
        assert "27.73.10.20:" not in order.delivered_data
        kinds = (await db.execute(select(ProxyIpChange.kind))).scalars().all()
        assert kinds == ["front"]
        assert await db.scalar(select(Alert.id).where(Alert.type == "topproxy_front_changed")) is not None
    # Front moves are not part of the buyer's IP history.
    resp = await client.get("/me/proxies/ip-changes", params={"line_id": f"{orders['static'].order_code}#01"}, headers=_h(buyer_token))
    assert resp.json() == []


@pytest.mark.asyncio
async def test_missing_from_snapshot_changes_nothing(client):
    _token, orders = await _topproxy_lines(client, "_w_missing")
    allocation_id, _ = await _static_allocation(orders)
    out = await _watch(allocation_id, {})
    assert out == {"checked": 0, "baselined": 0, "origin_changed": 0, "front_changed": 0}


@pytest.mark.asyncio
async def test_ip_history_is_private_to_the_line_owner(client):
    buyer_token, orders = await _topproxy_lines(client, "_w_owner")
    line_id = f"{orders['static'].order_code}#01"
    other = await register_and_login(client, "w_intruder@example.com")
    resp = await client.get("/me/proxies/ip-changes", params={"line_id": line_id}, headers=_h(other))
    assert resp.status_code == 404 and resp.json()["error_code"] == "PROXY_NOT_FOUND"
    assert (await client.get("/me/proxies/ip-changes", params={"line_id": line_id})).status_code in (401, 403)
    assert (await client.get("/me/proxies/ip-changes", params={"line_id": "bogus"}, headers=_h(buyer_token))).status_code == 404


# ---------------------------------------------------------------------------
# Job — gom theo loaiproxy, chịu lỗi nhà cung cấp
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_job_polls_each_loaiproxy_once_and_survives_supplier_errors(client, monkeypatch):
    _token, orders = await _topproxy_lines(client, "_w_job")
    allocation_id, external_id = await _static_allocation(orders)
    calls: list[str] = []

    async def fake_list(self, loaiproxy):
        calls.append(loaiproxy)
        return _snap(external_id, origin=ORIGIN)

    monkeypatch.setattr("src.adapters.topproxy.TopProxyAdapter.list_static_snapshots", fake_list)
    await topproxy_ip_watch_job()
    assert calls == ["Viettel"]  # the xoay provider is skipped, one call for the one kind
    async with SessionLocal() as db:
        assert (await db.get(ProxyAllocation, allocation_id)).last_public_ip == ORIGIN

    for error in (TopProxyUnavailableError("down"), TopProxyContractError("bad")):
        monkeypatch.setattr(
            "src.adapters.topproxy.TopProxyAdapter.list_static_snapshots", AsyncMock(side_effect=error),
        )
        await topproxy_ip_watch_job()  # logged, never raised
    async with SessionLocal() as db:
        assert (await db.get(ProxyAllocation, allocation_id)).last_public_ip == ORIGIN


# ---------------------------------------------------------------------------
# Trọn luồng trên mock TopProxy: mua → giao trung gian → họ đổi IP gốc → job bắt được
# ---------------------------------------------------------------------------

from .test_topproxy_bulk_orders import _mock_topproxy, _order_and_lines, _place, _setup  # noqa: E402,F401  (autouse fixture)
from scripts import mock_topproxy  # noqa: E402
from src.orders.service import provision_pending_order  # noqa: E402


@pytest.mark.asyncio
async def test_bought_proxy_is_the_intermediate_and_a_supplier_side_change_is_caught(client):
    buyer_token, product_id, _provider_id = await _setup(client, "_ipw")
    placed = await _place(client, buyer_token, product_id, 1)
    assert placed.status_code in (200, 201), placed.text
    order_id = placed.json()["id"]
    await provision_pending_order(order_id)

    order, [line] = await _order_and_lines(order_id)
    supplier = mock_topproxy._proxies[int(line.external_id)]
    front, origin = supplier["ip"], supplier["origin"]
    assert front != origin
    # Delivered: the intermediate, not the origin; the origin is kept aside as the exit IP.
    assert f"Host: {front}" in order.delivered_data and origin not in order.delivered_data
    assert line.last_public_ip == origin and line.external_proxy_id == f"{front}:{supplier['port']}"

    # Quiet poll: nothing to report.
    await topproxy_ip_watch_job()
    # The supplier moves the origin IP; the intermediate stays.
    supplier["origin"] = "9.9.9.9"
    await topproxy_ip_watch_job()

    order, [line] = await _order_and_lines(order_id)
    assert (line.last_public_ip, line.previous_public_ip, line.public_ip_change_count) == ("9.9.9.9", origin, 1)
    assert f"Host: {front}" in order.delivered_data  # buyer's connection details untouched
    body = (await client.get(f"/me/proxies?q={order.order_code}", headers=_h(buyer_token))).json()["items"][0]
    assert (body["host"], body["public_ip"], body["previous_ip"]) == (front, "9.9.9.9", origin)
