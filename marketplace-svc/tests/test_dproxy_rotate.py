"""Task 5 — buyer-authorized proxy IP rotation. See
docs/superpowers/specs/2026-07-22-dproxy-integration.md.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.order import Order, OrderStatus
from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationStatus
from src.orders.service import provision_pending_order

from .conftest import register_and_login
from .test_dproxy_orders import _patch_dproxy_http, _place_order, _resp, _sample, setup_dproxy_product


async def _deliver_dproxy_order(client, monkeypatch, suffix, external_id="ext-rot"):
    buyer_token, admin_token, product_id, provider_id = await setup_dproxy_product(client, suffix=suffix)
    order_id = await _place_order(client, buyer_token, product_id, monkeypatch)
    _patch_dproxy_http(monkeypatch, _resp(200, [_sample(external_id)]))
    await provision_pending_order(order_id)
    return buyer_token, admin_token, order_id, provider_id


async def _get_allocation(order_id: int) -> ProxyAllocation:
    async with SessionLocal() as db:
        return await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))


class TestProxyRotate:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_rotate_requires_ownership(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_own")
        other_token = await register_and_login(client, "dpx_rot_other@example.com")

        resp = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {other_token}"})
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_rotate_requires_delivered_or_completed_status(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_status")
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            order.status = OrderStatus.disputed
            await db.commit()

        resp = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_rotate_without_any_allocation(self, client, monkeypatch):
        buyer_token, _, product_id, _ = await setup_dproxy_product(client, suffix="_noalloc")
        order_id = await _place_order(client, buyer_token, product_id, monkeypatch)
        # never provisioned — order stays pending, no allocation exists
        resp = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_rotate_when_allocation_expired(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_expired")
        async with SessionLocal() as db:
            allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
            allocation.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
            await db.commit()

        resp = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_rotate_when_rotation_not_available(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_norotate")
        async with SessionLocal() as db:
            allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
            allocation.rotation_available = False
            await db.commit()

        resp = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_first_rotate_succeeds_and_refreshes_public_ip(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_ok")

        rotated = _sample("ext-rot")
        rotated["proxies"]["ip_public"] = "9.9.9.9"
        calls = _patch_dproxy_http(monkeypatch, [_resp(200, {"ok": True}), _resp(200, [rotated])])

        resp = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["public_ip"] == "9.9.9.9"
        assert body["ok"] is True
        assert len(calls) == 2  # rotate call + re-list

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert "9.9.9.9" in order.delivered_data
            allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
            assert allocation.last_public_ip == "9.9.9.9"
            assert allocation.last_rotated_at is not None

    @pytest.mark.asyncio
    async def test_immediate_second_rotate_is_cooldown_blocked(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_cooldown")
        _patch_dproxy_http(monkeypatch, [_resp(200, {"ok": True}), _resp(200, [_sample("ext-rot")])])
        first = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert first.status_code == 200

        calls = _patch_dproxy_http(monkeypatch, [_resp(200, {"ok": True}), _resp(200, [_sample("ext-rot")])])
        second = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert second.status_code == 429
        assert "giây" in second.json()["detail"]
        assert int(second.headers["retry-after"]) > 0
        assert len(calls) == 0  # cooldown blocks BEFORE calling DProxy

    @pytest.mark.asyncio
    async def test_rotate_after_cooldown_elapses_succeeds(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_cooldown_ok")
        _patch_dproxy_http(monkeypatch, [_resp(200, {"ok": True}), _resp(200, [_sample("ext-rot")])])
        first = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert first.status_code == 200

        async with SessionLocal() as db:
            allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
            allocation.last_rotated_at = datetime.now(timezone.utc) - timedelta(hours=1)
            await db.commit()

        _patch_dproxy_http(monkeypatch, [_resp(200, {"ok": True}), _resp(200, [_sample("ext-rot")])])
        second = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert second.status_code == 200

    @pytest.mark.asyncio
    async def test_concurrent_rotate_clicks_only_one_reaches_dproxy(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_race")
        calls = _patch_dproxy_http(
            monkeypatch,
            [_resp(200, {"ok": True}), _resp(200, [_sample("ext-rot")]),
             _resp(200, {"ok": True}), _resp(200, [_sample("ext-rot")])],
        )

        results = await asyncio.gather(
            client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"}),
            client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"}),
        )
        statuses = sorted(r.status_code for r in results)
        assert statuses == [200, 429]
        # the FOR UPDATE lock serializes the two requests; the loser sees the
        # winner's fresh last_rotated_at and never calls DProxy at all.
        assert len(calls) == 2

    @pytest.mark.asyncio
    async def test_tampered_stored_rotate_path_is_never_trusted(self, client, monkeypatch):
        """rotate_path in the DB is metadata only — the adapter always
        rebuilds the call path from external_id (expected_rotate_path), so
        even a corrupted/malicious stored value can't redirect the call."""
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_tamper", external_id="ext-safe")
        async with SessionLocal() as db:
            allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
            allocation.rotate_path = "https://evil.example.com/steal"
            await db.commit()

        calls = _patch_dproxy_http(monkeypatch, [_resp(200, {"ok": True}), _resp(200, [_sample("ext-safe")])])
        resp = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 200, resp.text
        assert "ext-safe/rotate" in calls[0]["url"]
        assert "evil.example.com" not in calls[0]["url"]

    @pytest.mark.asyncio
    async def test_redirect_from_upstream_surfaces_as_502(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_redirect")
        _patch_dproxy_http(monkeypatch, _resp(302))
        resp = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 502

    @pytest.mark.asyncio
    async def test_upstream_4xx_surfaces_as_502(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_4xx")
        _patch_dproxy_http(monkeypatch, _resp(400))
        resp = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 502

    @pytest.mark.asyncio
    async def test_upstream_5xx_surfaces_as_502(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_5xx")
        _patch_dproxy_http(monkeypatch, _resp(500))
        resp = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 502

    @pytest.mark.asyncio
    async def test_malformed_post_rotate_list_surfaces_as_502(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_malformed")
        _patch_dproxy_http(monkeypatch, [_resp(200, {"ok": True}), _resp(200, {"not": "a list"})])
        resp = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 502

    @pytest.mark.asyncio
    async def test_rotate_never_consumes_order_balance_units(self, client, monkeypatch):
        from src.models.usage import OrderBalance

        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_nobalance")
        async with SessionLocal() as db:
            before = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            units_used_before = before.units_used if before else None

        _patch_dproxy_http(monkeypatch, [_resp(200, {"ok": True}), _resp(200, [_sample("ext-rot")])])
        resp = await client.post(f"/orders/{order_id}/proxy/rotate", headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 200

        async with SessionLocal() as db:
            after = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            # proxy rotation is resource lifecycle, not seller-gateway metered
            # forwarding — units_used (if a balance exists at all for this
            # pricing strategy) must be completely unaffected by rotate.
            assert (after.units_used if after else None) == units_used_before


class TestProxyState:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_state_endpoint_is_sanitized(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_state")
        resp = await client.get(f"/orders/{order_id}/proxy", headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 200
        body = resp.json()
        assert set(body.keys()) == {
            "status", "public_ip", "expires_at", "rotation_available",
            "cooldown_remaining_seconds", "last_rotated_at",
        }
        assert body["public_ip"] == "1.2.3.4"
        assert body["rotation_available"] is True

    @pytest.mark.asyncio
    async def test_state_endpoint_requires_ownership(self, client, monkeypatch):
        buyer_token, _, order_id, _ = await _deliver_dproxy_order(client, monkeypatch, "_state_own")
        other_token = await register_and_login(client, "dpx_state_other@example.com")
        resp = await client.get(f"/orders/{order_id}/proxy", headers={"Authorization": f"Bearer {other_token}"})
        assert resp.status_code == 404
