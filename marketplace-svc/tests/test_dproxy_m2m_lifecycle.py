"""Vòng đời SAU khi mua qua DProxy M2M partner-purchase: đối soát định kỳ,
hoàn tiền (dispute/quá hạn provision) → thu hồi thượng nguồn, và health khi
tài khoản chỉ bán theo lệnh mua (pool trống / không đọc được inventory).

Bổ sung cho tests/test_dproxy_reconciliation.py (chỉ cover binding từ pool)
và tests/test_dproxy_orders.py (chỉ cover tới lúc giao)."""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, update

from src.adapters.dproxy import DProxyAdapter
from src.database import SessionLocal
from src.models.alert import Alert
from src.models.order import Order, OrderStatus
from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationSource, ProxyAllocationStatus
from src.orders.service import provision_pending_order
from src.models.proxy_allocation import UpstreamRevocation
from src.scheduler import (
    DPROXY_MISSING_GRACE_ROUNDS,
    PROVISION_DEADLINE_SECONDS,
    dproxy_reconciliation_job,
    provision_sweep_job,
    upstream_revocation_job,
)
from src.security.crypto import encrypt_str

from .test_dproxy_orders import (
    PLAN_ID,
    PREFIX,
    _config_sample,
    _patch_dproxy_http,
    _place_config_order,
    _resp,
    _sample,
    setup_dproxy_config_product,
)


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())


async def _buy(client, monkeypatch, suffix, *, label="ext-m2m"):
    buyer_token, admin_token, product_id, provider_id = await setup_dproxy_config_product(client, suffix=suffix)
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    _patch_dproxy_http(monkeypatch, _resp(200, _config_sample(label, partner_order_id=f"{PREFIX}{order_id}")))
    await provision_pending_order(order_id)
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.delivered
    return buyer_token, admin_token, order_id, provider_id


def _dispute_calls(calls):
    return [c for c in calls if c["url"].endswith("/partner-dispute")]


# ---------------------------------------------------------------------------
# Reconciliation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reconciliation_never_flags_purchased_allocation_missing_from_inventory(client, monkeypatch):
    """external_id của đơn M2M là ORDER UUID của DProxy — không bao giờ có
    trong /proxies/user. Quét theo list mà không phân biệt nguồn thì sau
    GRACE_ROUNDS mọi đơn M2M bị flip sang `error` + alert critical."""
    _, _, order_id, _ = await _buy(client, monkeypatch, "_recon_m2m")

    # Inventory hoàn toàn không liên quan tới đơn M2M.
    _patch_dproxy_http(monkeypatch, _resp(200, [_sample("ext-pool-only")]))
    for _ in range(DPROXY_MISSING_GRACE_ROUNDS + 1):
        await dproxy_reconciliation_job()

    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.source == ProxyAllocationSource.purchase.value
        assert allocation.status == ProxyAllocationStatus.allocated
        assert allocation.consecutive_misses == 0
        alerts = (await db.execute(
            select(Alert).where(Alert.type == "dproxy_allocation_disappeared")
        )).scalars().all()
        assert not any(a.target_id == order_id for a in alerts)


@pytest.mark.asyncio
async def test_reconciliation_expires_purchased_allocation_by_clock(client, monkeypatch):
    _, _, order_id, _ = await _buy(client, monkeypatch, "_recon_m2m_exp")
    async with SessionLocal() as db:
        await db.execute(
            update(ProxyAllocation).where(ProxyAllocation.order_id == order_id)
            .values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
        )
        await db.commit()

    _patch_dproxy_http(monkeypatch, _resp(200, []))
    await dproxy_reconciliation_job()

    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.status == ProxyAllocationStatus.expired
        alerts = (await db.execute(select(Alert).where(Alert.target_id == order_id))).scalars().all()
        assert alerts == []


@pytest.mark.asyncio
async def test_buyer_proxy_state_for_purchased_allocation_has_no_rotate(client, monkeypatch):
    buyer_token, _, order_id, _ = await _buy(client, monkeypatch, "_state_m2m")
    resp = await client.get(f"/orders/{order_id}/proxy", headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "allocated"
    assert body["rotation_available"] is False
    assert body["public_ip"] == "1.2.3.4"

    resp = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "PROXY_ROTATION_UNSUPPORTED"


# ---------------------------------------------------------------------------
# Refund → partner-dispute
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_full_refund_sends_partner_dispute_and_releases_binding(client, monkeypatch):
    buyer_token, admin_token, order_id, _ = await _buy(client, monkeypatch, "_refund_m2m")
    resp = await client.post(
        f"/orders/{order_id}/dispute", json={"reason": "Proxy chết"},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert resp.status_code == 201, resp.text
    dispute_id = resp.json()["id"]

    calls = _patch_dproxy_http(monkeypatch, _resp(200, {"success": True, "data": {"status": "disputed"}}))
    resp = await client.post(
        f"/admin/disputes/{dispute_id}/refund", json={"admin_note": "ok"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text
    # partner-dispute được XẾP cùng transaction hoàn tiền, gửi sau commit.
    assert _dispute_calls(calls) == []
    await upstream_revocation_job()

    disputes = _dispute_calls(calls)
    assert len(disputes) == 1
    assert disputes[0]["json"]["partner_order_id"] == f"{PREFIX}{order_id}"
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.refunded
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.status == ProxyAllocationStatus.released


@pytest.mark.asyncio
async def test_refund_still_succeeds_when_partner_dispute_fails(client, monkeypatch):
    """Thu hồi thượng nguồn là best-effort: DProxy sập không được chặn việc
    hoàn tiền cho buyer. Binding local vẫn release để không dùng lại."""
    buyer_token, admin_token, order_id, _ = await _buy(client, monkeypatch, "_refund_m2m_down")
    resp = await client.post(
        f"/orders/{order_id}/dispute", json={"reason": "Proxy chết"},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    dispute_id = resp.json()["id"]

    calls = _patch_dproxy_http(monkeypatch, _resp(503))
    resp = await client.post(
        f"/admin/disputes/{dispute_id}/refund", json={"admin_note": "ok"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text
    assert _dispute_calls(calls) == []
    await upstream_revocation_job()
    assert len(_dispute_calls(calls)) == 3  # retried inside one attempt, row stays queued
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.refunded
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.status == ProxyAllocationStatus.released
        row = await db.scalar(select(UpstreamRevocation).where(UpstreamRevocation.order_id == order_id))
        assert row.status == "pending" and row.attempts == 1


@pytest.mark.asyncio
async def test_partial_refund_keeps_proxy(client, monkeypatch):
    buyer_token, admin_token, order_id, _ = await _buy(client, monkeypatch, "_partial_m2m")
    resp = await client.post(
        f"/orders/{order_id}/dispute", json={"reason": "Chậm"},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    dispute_id = resp.json()["id"]
    calls = _patch_dproxy_http(monkeypatch, _resp(200, {"success": True}))
    resp = await client.post(
        f"/admin/disputes/{dispute_id}/partial-refund", json={"admin_note": "ok", "refund_amount": 1000},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text
    assert _dispute_calls(calls) == []
    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.status == ProxyAllocationStatus.allocated


# ---------------------------------------------------------------------------
# Provision deadline → partner-dispute
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_provision_deadline_refund_sends_partner_dispute(client, monkeypatch):
    """Mọi retry đều timeout không có nghĩa DProxy chưa cấp node. Sau khi
    hoàn tiền buyer phải gửi partner-dispute để họ thu node + hoàn credit —
    và alert phải mang partner_order_id để admin đối soát."""
    buyer_token, _, product_id, _ = await setup_dproxy_config_product(client, suffix="_deadline_m2m")
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    async with SessionLocal() as db:
        await db.execute(
            update(Order).where(Order.id == order_id).values(
                created_at=datetime.now(timezone.utc) - timedelta(seconds=PROVISION_DEADLINE_SECONDS + 60),
            )
        )
        await db.commit()

    calls = _patch_dproxy_http(monkeypatch, _resp(200, {"success": True, "data": {"status": "disputed"}}))
    await provision_sweep_job()
    assert _dispute_calls(calls) == []  # không gọi HTTP khi đang giữ lock đơn
    await upstream_revocation_job()

    disputes = _dispute_calls(calls)
    assert len(disputes) == 1
    assert disputes[0]["json"]["partner_order_id"] == f"{PREFIX}{order_id}"
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.cancelled
        alert = await db.scalar(select(Alert).where(Alert.type == "provision_stuck", Alert.target_id == order_id))
        assert alert is not None
        assert f"{PREFIX}{order_id}" in alert.message
        assert "đã xếp partner-dispute" in alert.message


@pytest.mark.asyncio
async def test_provision_deadline_dispute_stays_queued_while_dproxy_is_down(client, monkeypatch):
    buyer_token, _, product_id, _ = await setup_dproxy_config_product(client, suffix="_deadline_m2m_down")
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    async with SessionLocal() as db:
        await db.execute(
            update(Order).where(Order.id == order_id).values(
                created_at=datetime.now(timezone.utc) - timedelta(seconds=PROVISION_DEADLINE_SECONDS + 60),
            )
        )
        await db.commit()

    _patch_dproxy_http(monkeypatch, _resp(503))
    await provision_sweep_job()
    await upstream_revocation_job()

    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.cancelled
        alert = await db.scalar(select(Alert).where(Alert.type == "provision_stuck", Alert.target_id == order_id))
        assert f"{PREFIX}{order_id}" in alert.message
        row = await db.scalar(select(UpstreamRevocation).where(UpstreamRevocation.order_id == order_id))
        assert row.reason == "provision_deadline"
        assert row.status == "pending" and row.attempts == 1


# ---------------------------------------------------------------------------
# Health for a purchase-only account
# ---------------------------------------------------------------------------


def _adapter(**config) -> DProxyAdapter:
    base = {"base_url": "https://dproxy.example.com", "api_key": encrypt_str("k")}
    base.update(config)
    return DProxyAdapter(base, provider_id=1)


PLANS = [{"id": PLAN_ID, "name": "VN Resi 7d", "proxy_count": 1, "duration_days": 7, "price": 1.5, "currency": "USD"}]


@pytest.mark.asyncio
async def test_empty_pool_is_healthy_when_provider_sells_by_purchase(monkeypatch):
    _patch_dproxy_http(monkeypatch, [_resp(200, PLANS), _resp(200, [])])
    health = await _adapter(plan_ids={"residential|VN|7": PLAN_ID}).check_health()
    assert health["status"] == "healthy"
    assert health["purchase_ready"] is True
    assert health["plans"][0]["id"] == PLAN_ID


@pytest.mark.asyncio
async def test_empty_pool_is_still_a_warning_for_pool_only_provider(monkeypatch):
    _patch_dproxy_http(monkeypatch, [_resp(200, PLANS), _resp(200, [])])
    health = await _adapter().check_health()
    assert health["status"] == "warning"
    assert health["purchase_ready"] is False


@pytest.mark.asyncio
async def test_catalog_is_loaded_even_when_inventory_read_is_forbidden(monkeypatch):
    """Key M2M có thể không đọc được /proxies/user (chưa verify live). Admin
    vẫn cần catalog để map plan — health không được chặn nó."""
    _patch_dproxy_http(monkeypatch, [_resp(200, PLANS), _resp(403)])
    health = await _adapter(plan_ids={"residential|VN|7": PLAN_ID}).check_health()
    # Key chỉ có quyền M2M vẫn bán được — cảnh báo, không chặn wizard.
    assert health["status"] == "warning"
    assert health["purchase_ready"] is True
    assert health["plans"][0]["id"] == PLAN_ID


@pytest.mark.asyncio
async def test_inventory_forbidden_without_plan_mapping_is_unhealthy(monkeypatch):
    _patch_dproxy_http(monkeypatch, [_resp(200, PLANS), _resp(403)])
    health = await _adapter().check_health()
    assert health["status"] == "unhealthy"


@pytest.mark.asyncio
async def test_default_timeout_is_longer_for_purchase_calls():
    assert _adapter().timeout == 30.0
    assert _adapter(timeout_seconds=7).timeout == 7.0


# ---------------------------------------------------------------------------
# Several proxies on one order — one revocation per line
# ---------------------------------------------------------------------------


def _line_id(order_id: int, line_no: int) -> str:
    return f"{PREFIX}{order_id}" if line_no == 1 else f"{PREFIX}{order_id}-{line_no}"


@pytest.mark.asyncio
async def test_full_refund_of_a_three_proxy_order_disputes_every_line(client, monkeypatch):
    buyer_token, admin_token, product_id, _ = await setup_dproxy_config_product(client, suffix="_bulk_refund")
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch, quantity=3)
    _patch_dproxy_http(monkeypatch, [
        _resp(200, _config_sample(f"ext-bulkref-{n}", partner_order_id=_line_id(order_id, n))) for n in (1, 2, 3)
    ])
    await provision_pending_order(order_id)
    resp = await client.post(
        f"/orders/{order_id}/dispute", json={"reason": "Proxy chết"},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert resp.status_code == 201, resp.text

    calls = _patch_dproxy_http(monkeypatch, _resp(200, {"success": True, "data": {"status": "disputed"}}))
    resp = await client.post(
        f"/admin/disputes/{resp.json()['id']}/refund", json={"admin_note": "ok"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text
    await upstream_revocation_job()

    assert sorted(c["json"]["partner_order_id"] for c in _dispute_calls(calls)) == sorted(
        _line_id(order_id, n) for n in (1, 2, 3)
    )
    async with SessionLocal() as db:
        statuses = (await db.execute(
            select(ProxyAllocation.status).where(ProxyAllocation.order_id == order_id)
        )).scalars().all()
        assert statuses == [ProxyAllocationStatus.released] * 3


@pytest.mark.asyncio
async def test_provision_deadline_disputes_every_line_of_the_order(client, monkeypatch):
    """Đơn 3 proxy quá hạn provision: không biết lệnh mua nào đã tới DProxy,
    nên xếp partner-dispute cho id deterministic của TỪNG dòng (404 = không
    có lệnh đó, outbox tự đóng)."""
    buyer_token, _, product_id, _ = await setup_dproxy_config_product(client, suffix="_bulk_deadline")
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch, quantity=3)
    async with SessionLocal() as db:
        await db.execute(
            update(Order).where(Order.id == order_id).values(
                created_at=datetime.now(timezone.utc) - timedelta(seconds=PROVISION_DEADLINE_SECONDS + 60),
            )
        )
        await db.commit()

    calls = _patch_dproxy_http(monkeypatch, _resp(200, {"success": True, "data": {"status": "disputed"}}))
    await provision_sweep_job()
    assert _dispute_calls(calls) == []
    async with SessionLocal() as db:
        rows = (await db.execute(
            select(UpstreamRevocation).where(UpstreamRevocation.order_id == order_id).order_by(UpstreamRevocation.id)
        )).scalars().all()
        assert [(r.partner_order_id, r.reason) for r in rows] == [
            (_line_id(order_id, n), "provision_deadline") for n in (1, 2, 3)
        ]
        alert = await db.scalar(select(Alert).where(Alert.type == "provision_stuck", Alert.target_id == order_id))
        assert "3 dòng" in alert.message and f"{PREFIX}{order_id}-3" in alert.message
    await upstream_revocation_job()
    assert sorted(c["json"]["partner_order_id"] for c in _dispute_calls(calls)) == sorted(
        _line_id(order_id, n) for n in (1, 2, 3)
    )
