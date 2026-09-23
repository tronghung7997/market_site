"""DProxy M2M theo contract LIVE (probe bằng key thật 2026-09-23), khác tài
liệu nhà cung cấp ở mấy điểm quyết định luồng tiền:

- response mua: `order_id: null`, KHÔNG có `status`, có `proxies[].assignment_id`
  và `total_cost_usd`; node mua xuất hiện trong /proxies/user dưới đúng id đó;
- gói hết hàng vẫn trả 200 success nhưng giao lại một assignment CÓ SẴN đã hết
  hạn — phải bị từ chối, hoàn tiền, xếp partner-dispute và báo admin;
- /store/quote báo tồn (available/available_count) mà không tạo đơn;
- credit-summary là hạn mức trả sau (available_spending_usd…).

Mọi lệnh gọi HTTP được định tuyến theo PATH (không theo thứ tự) để các lệnh
đọc phụ quanh lệnh mua (quote trước, list sau) chạy như production.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.alert import Alert
from src.models.order import Order, OrderStatus
from src.models.product import Product
from src.models.provider import Provider
from src.models.proxy_allocation import (
    ProxyAllocation, ProxyAllocationSource, ProxyAllocationStatus, UpstreamRevocation,
)
from src.models.wallet import Wallet
from src.money.service import get_effective_rate
from src.orders.service import provision_pending_order
from src.scheduler import (
    UPSTREAM_REVOKE_MAX_ATTEMPTS,
    dproxy_credit_check_job,
    dproxy_reconciliation_job,
    upstream_revocation_job,
)

from .test_dproxy_orders import (
    PLAN_ID,
    PREFIX,
    _place_config_order,
    _place_order,
    label_to_uuid,
    setup_dproxy_config_product,
    setup_dproxy_product,
)

ASSIGNMENT = label_to_uuid("live-assignment")


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())


def _json(status: int, body=None) -> httpx.Response:
    return httpx.Response(status, json=body, request=httpx.Request("GET", "https://dproxy.example.com/x"))


def _route(monkeypatch, routes: dict):
    """routes: path suffix → Response | callable(kwargs) -> Response. Path
    không khai báo → 599 để test lộ ra lệnh gọi ngoài dự kiến."""
    original = httpx.AsyncClient.request
    calls: list[dict] = []

    async def fake(self, method, url, *args, **kwargs):
        url = str(url)
        if "dproxy.example.com" not in url:
            return await original(self, method, url, *args, **kwargs)
        path = url.split("dproxy.example.com", 1)[1]
        calls.append({"method": method, "path": path, **kwargs})
        for suffix, handler in routes.items():
            if path.endswith(suffix):
                return handler(kwargs) if callable(handler) else handler
        return _json(599, {"detail": f"unexpected {path}"})

    monkeypatch.setattr(httpx.AsyncClient, "request", fake)
    return calls


def _live_purchase(partner_order_id: str, *, assignment_id=ASSIGNMENT, expires_in_days=7.0, cost=1.0) -> dict:
    expires = datetime.now(timezone.utc) + timedelta(days=expires_in_days)
    return {
        "success": True,
        "data": {
            "success": True, "order_id": None, "partner_order_id": partner_order_id, "channel": "proxora",
            "plan_name": "Residential Proxy", "quantity": 1, "total_cost_usd": cost,
            "proxies": [{
                "assignment_id": assignment_id, "ip": "115.77.31.221", "port": 20160,
                "username": "u_23_live", "password": "pw-live",
                "formatted_string": "115.77.31.221:20160:u_23_live:pw-live",
                "expires_at": expires.isoformat(),
            }],
        },
    }


def _inventory_row(assignment_id=ASSIGNMENT, *, expires_in_days=7.0, rotatable=True) -> dict:
    return {
        "id": assignment_id,
        "assigned_at": datetime.now(timezone.utc).isoformat(),
        "expired_at": (datetime.now(timezone.utc) + timedelta(days=expires_in_days)).isoformat(),
        "status": "active", "username": "u_23_live", "password": "pw-live", "is_active": True,
        "proxies": {
            "host": "s4.dproxy.info", "port": 20160, "status": {"msg": "online"},
            "proxy_id": "54f6fb0c-45cf-4a6a-9ecf-2797f50f94f8", "ip_public": "115.77.31.221",
            "proxies_type": {"name": "residential"},
            "rotation": {
                "available": rotatable, "mode": "pppoe", "cooldown_seconds": None, "last_rotated_at": None,
                "rotate_endpoint": f"/api/v1/proxies/user/{assignment_id}/rotate",
            },
        },
    }


QUOTE_OK = _json(200, {"available": True, "available_count": 475, "unit_price": 1.0, "currency": "USD"})
QUOTE_EMPTY = _json(200, {"available": False, "available_count": 0, "unit_price": 0.1, "currency": "USD"})


async def _live_product(client, suffix: str):
    """Sản phẩm config với hai lệnh đọc phụ BẬT (mặc định production)."""
    buyer_token, admin_token, product_id, provider_id = await setup_dproxy_config_product(client, suffix=suffix)
    async with SessionLocal() as db:
        provider = await db.get(Provider, provider_id)
        config = dict(provider.config)
        config.pop("precheck_availability", None)
        config.pop("enrich_rotation", None)
        provider.config = config
        await db.commit()
    return buyer_token, admin_token, product_id, provider_id


async def _available(buyer_token, client) -> int:
    me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    async with SessionLocal() as db:
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == me.json()["id"]))
        return wallet.available_balance


def _paths(calls, suffix):
    return [c for c in calls if c["path"].endswith(suffix)]


# ---------------------------------------------------------------------------
# Purchase
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_live_shape_delivers_and_binds_assignment_with_rotation(client, monkeypatch):
    buyer_token, _, product_id, provider_id = await _live_product(client, "_live_ok")
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    partner_order_id = f"{PREFIX}{order_id}"
    calls = _route(monkeypatch, {
        "/store/quote": QUOTE_OK,
        "/partner-purchase": _json(200, _live_purchase(partner_order_id)),
        "/proxies/user": _json(200, [_inventory_row()]),
    })

    await provision_pending_order(order_id)

    assert [c["path"].rsplit("/", 1)[-1] for c in calls] == ["quote", "partner-purchase", "user"]
    rate = None
    async with SessionLocal() as db:
        rate = await get_effective_rate(db)
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.delivered
        assert "115.77.31.221" in order.delivered_data
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.source == ProxyAllocationSource.purchase.value
        assert allocation.external_id == ASSIGNMENT
        assert allocation.partner_order_id == partner_order_id
        assert allocation.upstream_order_id is None
        assert allocation.upstream_cost_usd == Decimal("1.0000")
        assert allocation.upstream_cost_vnd == (rate if rate else None)
        # Khối rotation đọc từ /proxies/user theo assignment_id.
        assert allocation.rotation_available is True
        assert allocation.rotate_path == f"/api/v1/proxies/user/{ASSIGNMENT}/rotate"

    state = await client.get(f"/orders/{order_id}/proxy", headers={"Authorization": f"Bearer {buyer_token}"})
    assert state.status_code == 200, state.text
    assert state.json()["rotation_available"] is True


@pytest.mark.asyncio
async def test_static_node_keeps_rotation_off(client, monkeypatch):
    buyer_token, _, product_id, _ = await _live_product(client, "_live_static")
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    _route(monkeypatch, {
        "/store/quote": QUOTE_OK,
        "/partner-purchase": _json(200, _live_purchase(f"{PREFIX}{order_id}")),
        "/proxies/user": _json(200, [_inventory_row(rotatable=False)]),
    })
    await provision_pending_order(order_id)
    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.rotation_available is False


@pytest.mark.asyncio
async def test_inventory_lookup_failure_never_breaks_a_paid_delivery(client, monkeypatch):
    buyer_token, _, product_id, _ = await _live_product(client, "_live_nolist")
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    _route(monkeypatch, {
        "/store/quote": QUOTE_OK,
        "/partner-purchase": _json(200, _live_purchase(f"{PREFIX}{order_id}")),
        "/proxies/user": _json(403, {"detail": "no"}),
    })
    await provision_pending_order(order_id)
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.delivered
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.rotation_available is False


@pytest.mark.asyncio
async def test_stale_expired_assignment_is_refused_refunded_and_disputed(client, monkeypatch):
    """Đúng response live của gói hết hàng: success + proxy cũ đã hết hạn."""
    buyer_token, _, product_id, provider_id = await _live_product(client, "_live_stale")
    before = await _available(buyer_token, client)
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    partner_order_id = f"{PREFIX}{order_id}"
    calls = _route(monkeypatch, {
        "/store/quote": QUOTE_OK,
        "/partner-purchase": _json(200, _live_purchase(partner_order_id, expires_in_days=-70)),
        "/proxies/user": _json(200, []),
    })

    await provision_pending_order(order_id)

    assert _paths(calls, "/proxies/user") == []  # không đọc rotation cho node bị từ chối
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.cancelled
        assert "hoàn về ví" in order.cancel_reason
        assert await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id)) is None
        revocation = await db.scalar(select(UpstreamRevocation).where(UpstreamRevocation.order_id == order_id))
        assert revocation.partner_order_id == partner_order_id
        assert revocation.reason == "purchase_violation"
        assert revocation.status == "pending"
        alert = await db.scalar(select(Alert).where(
            Alert.type == "provision_operational", Alert.target_id == order_id,
        ))
        assert alert.severity == "critical"
        assert "hết hạn" in alert.message and partner_order_id in alert.message
    assert await _available(buyer_token, client) == before


@pytest.mark.asyncio
async def test_duration_shorter_than_sold_is_refused(client, monkeypatch):
    buyer_token, _, product_id, _ = await _live_product(client, "_live_short")
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch, days=7)
    _route(monkeypatch, {
        "/store/quote": QUOTE_OK,
        "/partner-purchase": _json(200, _live_purchase(f"{PREFIX}{order_id}", expires_in_days=2)),
    })
    await provision_pending_order(order_id)
    async with SessionLocal() as db:
        assert (await db.get(Order, order_id)).status == OrderStatus.cancelled


@pytest.mark.asyncio
async def test_assignment_already_sold_to_another_order_is_refused(client, monkeypatch):
    buyer_token, _, product_id, provider_id = await _live_product(client, "_live_reuse")
    first = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    _route(monkeypatch, {
        "/store/quote": QUOTE_OK,
        "/partner-purchase": _json(200, _live_purchase(f"{PREFIX}{first}")),
        "/proxies/user": _json(200, [_inventory_row()]),
    })
    await provision_pending_order(first)

    second = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    _route(monkeypatch, {
        "/store/quote": QUOTE_OK,
        # DProxy trả lại ĐÚNG node của đơn trước cho một lệnh mua mới.
        "/partner-purchase": _json(200, _live_purchase(f"{PREFIX}{second}")),
        "/proxies/user": _json(200, [_inventory_row()]),
    })
    await provision_pending_order(second)

    async with SessionLocal() as db:
        assert (await db.get(Order, first)).status == OrderStatus.delivered
        assert (await db.get(Order, second)).status == OrderStatus.cancelled
        alert = await db.scalar(select(Alert).where(Alert.type == "provision_operational", Alert.target_id == second))
        assert f"#{first}" in alert.message
        assert await db.scalar(select(UpstreamRevocation).where(UpstreamRevocation.order_id == second)) is not None


@pytest.mark.asyncio
async def test_out_of_stock_quote_refuses_before_buying(client, monkeypatch):
    buyer_token, _, product_id, _ = await _live_product(client, "_live_quote_empty")
    before = await _available(buyer_token, client)
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    calls = _route(monkeypatch, {"/store/quote": QUOTE_EMPTY})

    await provision_pending_order(order_id)

    assert _paths(calls, "/partner-purchase") == []
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.cancelled
        assert "hết hàng" in order.cancel_reason
        alert = await db.scalar(select(Alert).where(Alert.type == "provision_operational", Alert.target_id == order_id))
        assert alert.severity == "warning"
        assert await db.scalar(select(UpstreamRevocation).where(UpstreamRevocation.order_id == order_id)) is None
    assert await _available(buyer_token, client) == before


@pytest.mark.asyncio
async def test_retry_after_a_purchase_attempt_skips_the_quote(client, monkeypatch):
    """Lần mua trước có thể đã được fulfill và lấy node cuối — quote lúc
    retry báo hết hàng không được làm mình bỏ đơn đã tiêu credit."""
    buyer_token, _, product_id, _ = await _live_product(client, "_live_retry")
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    _route(monkeypatch, {"/store/quote": QUOTE_OK, "/partner-purchase": _json(503, {})})
    await provision_pending_order(order_id)
    async with SessionLocal() as db:
        assert (await db.get(Order, order_id)).status == OrderStatus.pending

    calls = _route(monkeypatch, {
        "/store/quote": QUOTE_EMPTY,
        "/partner-purchase": _json(200, _live_purchase(f"{PREFIX}{order_id}")),
        "/proxies/user": _json(200, [_inventory_row()]),
    })
    await provision_pending_order(order_id)

    assert _paths(calls, "/store/quote") == []
    async with SessionLocal() as db:
        assert (await db.get(Order, order_id)).status == OrderStatus.delivered


@pytest.mark.asyncio
async def test_out_of_credit_pauses_provider_and_next_order_is_not_charged(client, monkeypatch):
    buyer_token, _, product_id, provider_id = await _live_product(client, "_live_402")
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    _route(monkeypatch, {
        "/store/quote": QUOTE_OK,
        "/partner-purchase": _json(402, {"detail": "Hạn mức tín dụng không đủ"}),
    })
    await provision_pending_order(order_id)

    async with SessionLocal() as db:
        assert (await db.get(Order, order_id)).status == OrderStatus.cancelled
        assert (await db.get(Provider, provider_id)).is_active is False
        alert = await db.scalar(select(Alert).where(
            Alert.type == "provider_out_of_credit", Alert.target_type == "provider", Alert.target_id == provider_id,
        ))
        assert alert is not None and alert.severity == "critical"

    before = await _available(buyer_token, client)
    resp = await client.post(
        "/orders", json={"product_id": product_id, "user_config": {"type": "residential", "network": "VN", "days": 7, "quantity": 1}},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "PRODUCT_UNAVAILABLE"
    assert await _available(buyer_token, client) == before


@pytest.mark.asyncio
async def test_injected_selection_on_a_pool_product_never_buys(client, monkeypatch):
    """Sản phẩm `credit` (bind từ pool): buyer tự thêm type/network/days vào
    user_config không được mở đường partner-purchase."""
    buyer_token, _, product_id, provider_id = await setup_dproxy_product(client, suffix="_inject")
    async with SessionLocal() as db:
        provider = await db.get(Provider, provider_id)
        provider.config = {**provider.config, "plan_id": PLAN_ID}
        await db.commit()
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)
    resp = await client.post(
        "/orders", json={"product_id": product_id, "user_config": {
            "package_size": 1, "type": "residential", "network": "VN", "days": 7,
        }},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert resp.status_code == 201, resp.text
    order_id = resp.json()["id"]
    calls = _route(monkeypatch, {"/proxies/user": _json(200, [_inventory_row()])})
    await provision_pending_order(order_id)
    assert _paths(calls, "/partner-purchase") == []
    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.source == ProxyAllocationSource.pool.value


# ---------------------------------------------------------------------------
# Upstream revocation outbox
# ---------------------------------------------------------------------------


async def _delivered(client, monkeypatch, suffix):
    buyer_token, admin_token, product_id, provider_id = await _live_product(client, suffix)
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    _route(monkeypatch, {
        "/store/quote": QUOTE_OK,
        "/partner-purchase": _json(200, _live_purchase(f"{PREFIX}{order_id}")),
        "/proxies/user": _json(200, [_inventory_row()]),
    })
    await provision_pending_order(order_id)
    return buyer_token, admin_token, order_id, provider_id


async def _refund(client, buyer_token, admin_token, order_id):
    resp = await client.post(
        f"/orders/{order_id}/dispute", json={"reason": "Proxy chết"},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert resp.status_code == 201, resp.text
    resp = await client.post(
        f"/admin/disputes/{resp.json()['id']}/refund", json={"admin_note": "ok"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_refund_queues_dispute_and_job_sends_the_stored_partner_order_id(client, monkeypatch):
    buyer_token, admin_token, order_id, _ = await _delivered(client, monkeypatch, "_outbox_ok")
    calls = _route(monkeypatch, {"/partner-dispute": _json(200, {"success": True})})
    await _refund(client, buyer_token, admin_token, order_id)
    # Không một lệnh HTTP nào trong transaction hoàn tiền.
    assert _paths(calls, "/partner-dispute") == []

    # Prefix đổi sau khi mua (đổi môi trường / cấu hình) không được làm
    # lệch id gửi đi.
    monkeypatch.setattr("src.adapters.dproxy.default_partner_order_prefix", lambda: "other-env-")
    await upstream_revocation_job()

    sent = _paths(calls, "/partner-dispute")
    assert len(sent) == 1
    assert sent[0]["json"]["partner_order_id"] == f"{PREFIX}{order_id}"
    async with SessionLocal() as db:
        row = await db.scalar(select(UpstreamRevocation).where(UpstreamRevocation.order_id == order_id))
        assert row.status == "done" and row.outcome == "revoked" and row.attempts == 1
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.status == ProxyAllocationStatus.released

    await upstream_revocation_job()
    assert len(_paths(calls, "/partner-dispute")) == 1  # done → không gửi lại


@pytest.mark.asyncio
async def test_transient_failures_back_off_then_raise_an_incident(client, monkeypatch):
    buyer_token, admin_token, order_id, _ = await _delivered(client, monkeypatch, "_outbox_down")
    _route(monkeypatch, {"/partner-dispute": _json(503, {})})
    await _refund(client, buyer_token, admin_token, order_id)

    await upstream_revocation_job()
    async with SessionLocal() as db:
        row = await db.scalar(select(UpstreamRevocation).where(UpstreamRevocation.order_id == order_id))
        assert row.status == "pending" and row.attempts == 1 and row.outcome == "error"
        assert row.next_attempt_at > datetime.now(timezone.utc)
        row.attempts = UPSTREAM_REVOKE_MAX_ATTEMPTS - 1
        row.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()

    await upstream_revocation_job()
    async with SessionLocal() as db:
        row = await db.scalar(select(UpstreamRevocation).where(UpstreamRevocation.order_id == order_id))
        assert row.status == "failed"
        alert = await db.scalar(select(Alert).where(Alert.type == "upstream_revoke_failed", Alert.target_id == order_id))
        assert alert.severity == "critical" and f"{PREFIX}{order_id}" in alert.message
        assert (await db.get(Order, order_id)).status == OrderStatus.refunded


@pytest.mark.asyncio
@pytest.mark.parametrize("status,final,alerted", [(404, "done", False), (409, "failed", True)])
async def test_vendor_answers_close_the_row(client, monkeypatch, status, final, alerted):
    buyer_token, admin_token, order_id, _ = await _delivered(client, monkeypatch, f"_outbox_{status}")
    _route(monkeypatch, {"/partner-dispute": _json(status, {"detail": "x"})})
    await _refund(client, buyer_token, admin_token, order_id)
    await upstream_revocation_job()
    async with SessionLocal() as db:
        row = await db.scalar(select(UpstreamRevocation).where(UpstreamRevocation.order_id == order_id))
        assert row.status == final
        alert = await db.scalar(select(Alert).where(Alert.type == "upstream_revoke_failed", Alert.target_id == order_id))
        assert (alert is not None) is alerted


# ---------------------------------------------------------------------------
# Credit monitor + reconciliation
# ---------------------------------------------------------------------------


def _credit(available: float, *, active=True) -> httpx.Response:
    return _json(200, {"success": True, "data": {
        "user_id": "u", "balance_usd": 0.0, "credit_limit_usd": 100.0, "available_spending_usd": available,
        "current_debt_usd": 100.0 - available, "is_credit_active": active,
    }})


@pytest.mark.asyncio
async def test_low_credit_warns_and_exhausted_credit_pauses(client, monkeypatch):
    _, _, _, provider_id = await _live_product(client, "_credit")
    _route(monkeypatch, {"/credit-summary": _credit(4.5)})
    await dproxy_credit_check_job()
    async with SessionLocal() as db:
        alert = await db.scalar(select(Alert).where(
            Alert.type == "provider_low_credit", Alert.target_id == provider_id, Alert.is_active.is_(True),
        ))
        assert alert.severity == "warning" and "4.50 USD" in alert.message
        assert (await db.get(Provider, provider_id)).is_active is True

    _route(monkeypatch, {"/credit-summary": _credit(0.0)})
    await dproxy_credit_check_job()
    async with SessionLocal() as db:
        assert (await db.get(Provider, provider_id)).is_active is False
        assert await db.scalar(select(Alert).where(
            Alert.type == "provider_out_of_credit", Alert.target_id == provider_id,
        )) is not None


@pytest.mark.asyncio
async def test_reconciliation_refreshes_purchased_node_and_expires_even_when_paused(client, monkeypatch):
    _, _, order_id, provider_id = await _delivered(client, monkeypatch, "_recon_live")

    moved = _inventory_row(rotatable=False)
    moved["proxies"]["ip_public"] = "115.77.31.99"
    _route(monkeypatch, {"/proxies/user": _json(200, [moved])})
    await dproxy_reconciliation_job()
    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.last_public_ip == "115.77.31.99"
        assert allocation.rotation_available is False
        assert allocation.status == ProxyAllocationStatus.allocated

    async with SessionLocal() as db:
        await db.execute(update(Provider).where(Provider.id == provider_id).values(is_active=False))
        await db.execute(update(ProxyAllocation).where(ProxyAllocation.order_id == order_id).values(
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        ))
        await db.commit()
    calls = _route(monkeypatch, {})
    await dproxy_reconciliation_job()
    assert calls == []  # provider tắt: không gọi thượng nguồn, vẫn hết hạn theo đồng hồ
    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.status == ProxyAllocationStatus.expired


# ---------------------------------------------------------------------------
# White-label
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_public_pricing_options_never_name_the_supplier(client, monkeypatch):
    _, _, product_id, provider_id = await _live_product(client, "_whitelabel")
    resp = await client.get(f"/products/{product_id}/pricing-options")
    assert resp.status_code == 200, resp.text
    assert resp.json()["adapter_type"] == "auto_proxy"
    assert "dproxy" not in resp.text.lower()

    # Cấu hình hỏng (strategy không tương thích) vẫn không lộ tên adapter.
    async with SessionLocal() as db:
        await db.execute(update(Product).where(Product.id == product_id).values(pricing_strategy="task"))
        await db.commit()
    resp = await client.get(f"/products/{product_id}/pricing-options")
    body = resp.json()
    assert body["ready"] is False
    assert body["not_ready_reason"] and "dproxy" not in body["not_ready_reason"].lower()
