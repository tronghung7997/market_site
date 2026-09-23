"""API sources sold as request packages (kind "gateway", adapter ghlab_fb) —
src/suppliers/gateway_sources.py + src/gateway/forward.py.

The upstream (lookup.ghlab.info) is faked with the same httpx interceptor as
test_gateway.py: only calls to seller.example.com are answered from a queue.
"""
import httpx
import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.account import Account
from src.models.order import Order, OrderStatus
from src.models.usage import GatewayCallLog, OrderBalance
from src.orders.service import provision_pending_order

from .conftest import make_admin, make_seller, register_and_login
from .test_gateway import _extract_gateway_key, _patch_seller_http

UPSTREAM = "https://seller.example.com"
KEY = "ghlab-test-key-0001"
PACKAGES = [
    {"label": "Dùng thử", "size": 20, "price": 10000},
    {"label": "Cơ bản", "size": 100, "price": 40000},
    {"label": "Pro", "size": 1000, "price": 300000, "active": False},
]
POST_URL = "https://www.facebook.com/100000020535380_28931382953112338"


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _upstream(status: int, body: dict) -> httpx.Response:
    return httpx.Response(status, json=body, request=httpx.Request("POST", f"{UPSTREAM}/api/v1/fb-module/collect"))


POST_BODY = {"channel_name": "facebook", "url_type": "Post", "data": {"id": "1_2", "message": "[x]"}}
BLOCKED = {"detail": {"detail": {"error": "The action attempted has been deemed abusive"}}}


async def _admin(client):
    token = await register_and_login(client, "gws_admin@example.com")
    await make_admin("gws_admin@example.com")
    token = await register_and_login(client, "gws_admin@example.com")
    await client.post("/admin/categories", json={"name": "Facebook API", "slug": "facebook-api"}, headers=_h(token))
    return token


async def _create_source(client, admin, monkeypatch) -> dict:
    calls = _patch_seller_http(monkeypatch, [_upstream(200, POST_BODY)])
    test = (await client.post("/admin/sources/test", json={
        "adapter_type": "ghlab_fb", "config": {"base_url": UPSTREAM, "api_key": KEY, "test_url": POST_URL},
    }, headers=_h(admin))).json()
    assert test["ok"] is True and test["health"]["status_code"] == 200
    # Key đi theo ?api_key=, không nằm trong header; đúng method + path.
    assert calls[0]["method"] == "POST" and calls[0]["url"].endswith("/api/v1/fb-module/collect")
    assert calls[0]["params"] == {"api_key": KEY} and calls[0]["json"] == {"url": POST_URL}
    assert "Authorization" not in calls[0]["headers"]

    resp = await client.post("/admin/sources", json={
        "adapter_type": "ghlab_fb", "name": "FB Data API",
        "config": {"base_url": UPSTREAM, "api_key": KEY},
        "new_seller": {"email": "gws-data@example.com", "business_name": "GMMO Data"},
    }, headers=_h(admin))
    assert resp.status_code == 201, resp.text
    assert resp.json()["kind"] == "gateway"
    return resp.json()


async def _publish(client, admin, pid) -> dict:
    resp = await client.put(f"/admin/sources/{pid}/packages", json={
        "packages": PACKAGES, "cost_per_request": 150, "publish": True,
    }, headers=_h(admin))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _buyer(client, admin, email="gws_buyer@example.com"):
    token = await register_and_login(client, email)
    buyer_id = (await client.get("/me", headers=_h(token))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test", "account_id": buyer_id, "amount": 500000}, headers=_h(admin))
    return token


async def _buy(client, buyer, product_id, size, monkeypatch) -> dict:
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)
    resp = await client.post("/orders", json={"product_id": product_id, "user_config": {"package_size": size}}, headers=_h(buyer))
    assert resp.status_code == 201, resp.text
    await provision_pending_order(resp.json()["id"])
    async with SessionLocal() as db:
        order = await db.get(Order, resp.json()["id"])
        assert order.status == OrderStatus.delivered
        return {"id": order.id, "code": order.order_code, "total": order.total_amount,
                "key": _extract_gateway_key(order.delivered_data)}


async def _balance(order_id: int) -> tuple[int, int]:
    async with SessionLocal() as db:
        b = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
        return b.units_used, b.units_total


@pytest.mark.asyncio
async def test_admin_sets_packages_and_prices_then_buyer_buys_exact_package(client, monkeypatch):
    admin = await _admin(client)
    source = await _create_source(client, admin, monkeypatch)
    pid = source["provider_id"]

    overview = (await client.get(f"/admin/sources/{pid}/gateway", headers=_h(admin))).json()
    assert overview["product"]["status"] == "draft" and overview["packages"] == []
    assert [e["name"] for e in overview["endpoints"]] == ["fb_collect"]
    assert overview["endpoints"][0]["method"] == "POST" and overview["endpoints"][0]["path"] == "/api/v1/fb-module/collect"
    assert overview["charge_only_success"] is True and overview["timeout_seconds"] == 30

    # Không mở bán khi chưa có gói; hai gói trùng số request bị từ chối.
    resp = await client.put(f"/admin/sources/{pid}/packages", json={"publish": True}, headers=_h(admin))
    assert resp.status_code == 400
    resp = await client.put(f"/admin/sources/{pid}/packages", json={
        "packages": [{"size": 20, "price": 1}, {"size": 20, "price": 2}]}, headers=_h(admin))
    assert resp.status_code == 400
    resp = await client.put(f"/admin/sources/{pid}/packages", json={"packages": [{"size": 0, "price": 1}]}, headers=_h(admin))
    assert resp.status_code == 422

    body = await _publish(client, admin, pid)
    assert body["product"]["status"] == "active" and body["cost_per_request"] == 150
    basic = next(p for p in body["packages"] if p["size"] == 100)
    assert basic["per_request"] == 400 and basic["profit_per_request"] == 250

    buyer = await _buyer(client, admin)
    order = await _buy(client, buyer, body["product"]["id"], 100, monkeypatch)
    assert order["total"] == 40000 and order["key"].startswith("gwk_live_")
    assert await _balance(order["id"]) == (0, 100)
    # Gói tắt / số request không có trong bảng gói → không mua được.
    for size in (1000, 7):
        resp = await client.post("/orders", json={"product_id": body["product"]["id"], "user_config": {"package_size": size}},
                                 headers=_h(buyer))
        assert resp.status_code in (400, 422), size


@pytest.mark.asyncio
async def test_gateway_charges_only_successful_calls_and_never_retries(client, monkeypatch):
    admin = await _admin(client)
    pid = (await _create_source(client, admin, monkeypatch))["provider_id"]
    product_id = (await _publish(client, admin, pid))["product"]["id"]
    buyer = await _buyer(client, admin)
    order = await _buy(client, buyer, product_id, 20, monkeypatch)
    gw = f"/gw/{order['key']}/fb_collect"

    # 200 → trừ 1; buyer không ghi đè được key của sàn qua ?api_key=.
    calls = _patch_seller_http(monkeypatch, [_upstream(200, POST_BODY)])
    resp = await client.post(f"{gw}?api_key=evil", json={"url": POST_URL})
    assert resp.status_code == 200 and resp.json()["url_type"] == "Post"
    assert calls[0]["params"]["api_key"] == KEY and len(calls) == 1
    assert await _balance(order["id"]) == (1, 20)

    # 400 từ nguồn (Facebook chặn) → trả nguyên cho khách, không trừ.
    _patch_seller_http(monkeypatch, [_upstream(400, BLOCKED)])
    resp = await client.post(gw, json={"url": "https://www.facebook.com/someone"})
    assert resp.status_code == 400 and "abusive" in resp.text
    assert await _balance(order["id"]) == (1, 20)

    # Timeout → 502, đúng MỘT lần gọi nguồn (max_attempts=1), không trừ.
    calls = _patch_seller_http(monkeypatch, [httpx.ReadTimeout("slow")])
    resp = await client.post(gw, json={"url": POST_URL})
    assert resp.status_code == 502 and len(calls) == 1
    assert await _balance(order["id"]) == (1, 20)

    # Sai method → 405 trước khi trừ, không gọi nguồn.
    calls = _patch_seller_http(monkeypatch, [])
    resp = await client.get(gw)
    assert resp.status_code == 405 and calls == []
    assert await _balance(order["id"]) == (1, 20)

    # Admin tạm dừng nguồn → 503 rõ ràng, không gọi nguồn, không trừ; bật lại là gọi được.
    assert (await client.patch(f"/admin/sources/{pid}/settings", json={"is_active": False}, headers=_h(admin))).status_code == 200
    resp = await client.post(gw, json={"url": POST_URL})
    assert resp.status_code == 503 and calls == []
    assert await _balance(order["id"]) == (1, 20)
    assert (await client.patch(f"/admin/sources/{pid}/settings", json={"is_active": True}, headers=_h(admin))).status_code == 200

    async with SessionLocal() as db:
        logs = list((await db.execute(
            select(GatewayCallLog).where(GatewayCallLog.order_id == order["id"]).order_by(GatewayCallLog.id)
        )).scalars())
    assert [(l.status_code, l.units_charged, l.units_remaining) for l in logs] == [
        (200, 1, 19), (400, 0, 19), (None, 0, 19),
    ]

    # Tab Request của nguồn: admin thấy cả 3, có cột trừ.
    page = (await client.get(f"/admin/sources/{pid}/requests", headers=_h(admin))).json()
    assert page["summary"]["requests"] == 3 and page["summary"]["ok"] == 1 and page["summary"]["charged"] == 1
    assert page["items"][0]["order_code"] == order["code"] and page["items"][0]["key_prefix"].startswith("gwk_live_")
    errors = (await client.get(f"/admin/sources/{pid}/requests", params={"result": "error"}, headers=_h(admin))).json()
    assert errors["total"] == 2

    # Danh sách nguồn có thống kê gateway.
    listed = next(s for s in (await client.get("/admin/sources", headers=_h(admin))).json() if s["id"] == pid)
    assert listed["kind"] == "gateway" and listed["gateway_stats"]["requests_24h"] == 3
    assert listed["gateway_stats"]["active_keys"] == 1 and listed["gateway_stats"]["sales_7d"] == 10000


@pytest.mark.asyncio
async def test_buyer_console_try_rotate_and_scopes(client, monkeypatch):
    admin = await _admin(client)
    pid = (await _create_source(client, admin, monkeypatch))["provider_id"]
    product_id = (await _publish(client, admin, pid))["product"]["id"]
    buyer = await _buyer(client, admin)
    order = await _buy(client, buyer, product_id, 20, monkeypatch)

    # Dashboard có danh sách endpoint, không lộ đường dẫn thật của nguồn.
    dash = (await client.get(f"/orders/{order['code']}/dashboard", headers=_h(buyer))).json()
    assert dash["api"]["endpoints"][0]["name"] == "fb_collect" and "path" not in dash["api"]["endpoints"][0]
    assert dash["api"]["charge_only_success"] is True

    # "Gọi thử" chạy thật: thành công trừ 1, lỗi nguồn không trừ.
    _patch_seller_http(monkeypatch, [_upstream(200, POST_BODY), _upstream(400, BLOCKED)])
    ok = (await client.post(f"/orders/{order['code']}/gateway/try", json={"endpoint": "fb_collect", "body": {"url": POST_URL}},
                            headers=_h(buyer))).json()
    assert ok["status_code"] == 200 and ok["units_charged"] == 1 and ok["units_remaining"] == 19 and "Post" in ok["body"]
    bad = (await client.post(f"/orders/{order['code']}/gateway/try", json={"endpoint": "fb_collect", "body": {"url": "x"}},
                             headers=_h(buyer))).json()
    assert bad["status_code"] == 400 and bad["units_charged"] == 0 and bad["units_remaining"] == 19
    # Endpoint không bán → 404; người khác → 404.
    resp = await client.post(f"/orders/{order['code']}/gateway/try", json={"endpoint": "nope"}, headers=_h(buyer))
    assert resp.status_code == 404
    other = await register_and_login(client, "gws_other_buyer@example.com")
    resp = await client.post(f"/orders/{order['code']}/gateway/try", json={"endpoint": "fb_collect"}, headers=_h(other))
    assert resp.status_code == 404

    # Đổi key: key cũ hết hiệu lực, trang đơn hiện key mới.
    rotated = (await client.post(f"/orders/{order['code']}/gateway-key/rotate", headers=_h(buyer))).json()
    new_key = rotated["gateway_key"]
    async with SessionLocal() as db:
        delivered = (await db.get(Order, order["id"])).delivered_data
    assert new_key in delivered and order["key"] not in delivered
    assert (await client.post(f"/gw/{order['key']}/fb_collect", json={"url": POST_URL})).status_code == 401

    # Tab Request qua public key: seller nội bộ KHÁC → 404, buyer → 403.
    listed = (await client.get("/admin/sources", headers=_h(admin))).json()
    public_key = next(s["public_key"] for s in listed if s["id"] == pid)
    await register_and_login(client, "gws_stranger@example.com")
    await make_seller("gws_stranger@example.com")
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email == "gws_stranger@example.com").values(is_internal=True))
        await db.commit()
    stranger = await register_and_login(client, "gws_stranger@example.com")
    assert (await client.get(f"/seller/sources/{public_key}/requests", headers=_h(stranger))).status_code == 404
    assert (await client.get(f"/seller/sources/{public_key}/requests", headers=_h(buyer))).status_code == 403
    assert (await client.get(f"/admin/sources/{public_key}/requests", headers=_h(admin))).status_code == 200
