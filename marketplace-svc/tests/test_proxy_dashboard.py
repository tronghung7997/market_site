"""Buyer proxy dashboard API (/me/proxies, /me/proxy-tags) —
docs/proxy-dashboard-api.md.

Loại proxy = 3 chiều (src/proxies/kinds.py), dùng chung cho DProxy và
TopProxy (tĩnh theo `loaiproxy`, key xoay). Buyer không bao giờ thấy nguồn.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductStatus
from src.models.provider import Provider
from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationSource, ProxyAllocationStatus
from src.orders.service import provision_pending_order
from src.proxies.kinds import classify
from src.proxies.service import snapshot_line_kind
from src.security.crypto import encrypt_config

from .conftest import register_and_login
from .test_dproxy_live_contract import (
    QUOTE_OK, _inventory_row, _json, _live_product, _live_purchase, _route,
)
from .test_dproxy_orders import PREFIX, _place_config_order


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())


# ---------------------------------------------------------------------------
# Phân loại — thuần
# ---------------------------------------------------------------------------


@pytest.mark.no_db
@pytest.mark.parametrize("adapter,cfg,params,expected", [
    ("dproxy", {"type": "residential", "network": "VN", "days": 7},
     {"network_display": {"VN": "Việt Nam"}}, ("residential", None, "HTTP", "VN", "Việt Nam", 7)),
    ("dproxy", {"type": "mobile", "network": "mobifone", "days": 7}, {}, ("mobile", None, "HTTP", None, "mobifone", 7)),
    ("dproxy", {"type": "datacenter", "network": "US", "days": 30}, {}, ("datacenter", None, "HTTP", "US", "US", 30)),
    ("topproxy", {"type": "SOCKS5", "network": "Viettel", "days": 30}, {}, ("residential", None, "SOCKS5", "VN", "Viettel", 30)),
    ("topproxy", {"type": "HTTP", "network": "DatacenterB", "days": 30}, {}, ("datacenter", None, "HTTP", "VN", "DatacenterB", 30)),
    ("topproxy", {"type": "HTTP", "network": "US", "days": 30}, {}, ("datacenter", None, "HTTP", "US", "US", 30)),
    ("topproxy", {"type": "HTTP", "network": "4Gvinaphone", "days": 7}, {}, ("mobile", None, "HTTP", "VN", "4Gvinaphone", 7)),
    ("topproxy", {"type": "HTTP", "network": "xoay", "days": 30}, {}, ("residential", "rotating_key", "HTTP", "VN", "Key xoay", 30)),
])
def test_classify_covers_both_suppliers(adapter, cfg, params, expected):
    k = classify(adapter, cfg, params)
    assert (k.ip_type, k.rotation_kind, k.protocol, k.country, k.network_label, k.plan_days) == expected


@pytest.mark.no_db
def test_legacy_topproxy_key_is_recognised_by_provider_mode():
    """Đơn key xoay cũ lưu `network: "Random"` — chỉ `config.mode` của nguồn cho biết đó là key."""
    k = classify("topproxy", {"type": "HTTP", "network": "Random", "days": 1},
                 {"network_display": {"Random": "Chọn nhà mạng mỗi lần lấy IP"}}, provider_mode="xoay")
    assert (k.ip_type, k.rotation_kind, k.network_label) == ("residential", "rotating_key", "Chọn nhà mạng mỗi lần lấy IP")
    k = classify("topproxy", {"type": "HTTP", "network": "Random", "days": 1}, {}, provider_mode=None)
    assert k.rotation_kind is None


# ---------------------------------------------------------------------------
# DProxy qua luồng giao thật
# ---------------------------------------------------------------------------


async def _dproxy_line(client, monkeypatch, suffix: str, *, rotatable=True):
    buyer_token, admin_token, product_id, provider_id = await _live_product(client, suffix)
    order_id = await _place_config_order(client, buyer_token, product_id, monkeypatch)
    _route(monkeypatch, {
        "/store/quote": QUOTE_OK,
        "/partner-purchase": _json(200, _live_purchase(f"{PREFIX}{order_id}")),
        "/proxies/user": _json(200, [_inventory_row(rotatable=rotatable)]),
    })
    await provision_pending_order(order_id)
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.delivered
    return buyer_token, order


@pytest.mark.asyncio
async def test_dproxy_line_is_classified_at_delivery_and_listed(client, monkeypatch):
    buyer_token, order = await _dproxy_line(client, monkeypatch, "_dash_dp")
    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order.id))
        assert (allocation.ip_type, allocation.rotation_kind, allocation.plan_days) == ("residential", None, 7)

    resp = await client.get("/me/proxies", headers=_h(buyer_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1 and body["summary"]["all"] == 1 and body["summary"]["running"] == 1
    line = body["items"][0]
    assert line["id"] == f"{order.order_code}#01" and line["order_code"] == order.order_code
    assert line["ip_type"] == "residential" and line["rotation"] == "rotating"
    assert line["host"] == "115.77.31.221" and line["port"] == 20160
    assert line["username"] == "u_23_live" and line["password"] == "pw-live"
    assert line["whitelist_supported"] is False and line["renew_mode"] is None
    # White-label + không row id.
    text = resp.text.lower()
    assert "dproxy" not in text and "adapter" not in text and "provider" not in text
    assert f'"id": {order.id}' not in resp.text and f'"order_id"' not in resp.text


@pytest.mark.asyncio
async def test_rotation_dimension_follows_the_real_node(client, monkeypatch):
    buyer_token, _order = await _dproxy_line(client, monkeypatch, "_dash_static", rotatable=False)
    body = (await client.get("/me/proxies", headers=_h(buyer_token))).json()
    assert body["items"][0]["rotation"] == "static"
    assert (await client.get("/me/proxies?rotation=rotating", headers=_h(buyer_token))).json()["total"] == 0
    assert (await client.get("/me/proxies?rotation=static", headers=_h(buyer_token))).json()["total"] == 1


# ---------------------------------------------------------------------------
# TopProxy (tĩnh + key xoay) — dòng đã giao, cùng hook snapshot
# ---------------------------------------------------------------------------


async def _topproxy_lines(client, suffix: str) -> tuple[str, dict[str, Order]]:
    """Một buyer có 2 dòng TopProxy đã giao: tĩnh Viettel SOCKS5 và key xoay."""
    buyer_token = await register_and_login(client, f"tp_buyer{suffix}@example.com")
    buyer_id = (await client.get("/me", headers=_h(buyer_token))).json()["id"]
    seller_token = await register_and_login(client, f"tp_seller{suffix}@example.com")
    seller_id = (await client.get("/me", headers=_h(seller_token))).json()["id"]
    now = datetime.now(timezone.utc)
    orders: dict[str, Order] = {}
    async with SessionLocal() as db:
        from src.models.category import Category

        category = Category(name=f"TP{suffix}", slug=f"tp{suffix}")
        db.add(category)
        await db.flush()
        for mode, cfg, delivered, gateway in (
            ("static", {"type": "SOCKS5", "network": "Viettel", "days": 30, "quantity": 1},
             "Host: 27.73.10.20\nPort: 41234\nUsername: tpu\nPassword: tpp\nIP hiện tại: 27.73.10.20", None),
            ("xoay", {"type": "HTTP", "network": "xoay", "days": 30, "quantity": 1},
             "Host: 103.1.2.3\nPort: 21001\n(Host/Port là cổng vào CỐ ĐỊNH — cấu hình một lần, không đổi khi bạn đổi IP)\nIP đang dùng: 14.1.1.1",
             "103.1.2.3:21001"),
        ):
            provider = Provider(name=f"TP {mode}{suffix}", type="topproxy", adapter_type="topproxy",
                                config=encrypt_config({"base_url": "https://topproxy.test", "api_key": "k", "mode": mode}))
            db.add(provider)
            await db.flush()
            product = Product(seller_id=seller_id, category_id=category.id, title="Proxy dân cư tĩnh Viettel" if mode == "static" else "Key proxy xoay", status=ProductStatus.active,
                              service_type="proxy", provider_id=provider.id, pricing_strategy="config",
                              pricing_params={"plan_prices": {f"{cfg['type']}|{cfg['network']}|30": 100000},
                                              "network_display": {"Viettel": "Viettel"}})
            db.add(product)
            await db.flush()
            order = Order(buyer_id=buyer_id, seller_id=seller_id, product_id=product.id, quantity=1, total_amount=100000,
                          status=OrderStatus.delivered, user_config=cfg, delivered_data=delivered, provider_id=provider.id)
            db.add(order)
            await db.flush()
            db.add(ProxyAllocation(
                provider_id=provider.id, order_id=order.id, external_id=f"tp-{mode}{suffix}", external_proxy_id=gateway,
                status=ProxyAllocationStatus.allocated, expires_at=now + timedelta(days=30 if mode == "static" else 2),
                rotation_available=mode == "xoay", source=ProxyAllocationSource.purchase.value,
                last_public_ip="14.1.1.1" if mode == "xoay" else "27.73.10.20",
            ))
            await db.flush()
            await snapshot_line_kind(order, product, provider.id, db)
            orders[mode] = order
        await db.commit()
    return buyer_token, orders


@pytest.mark.asyncio
async def test_topproxy_static_and_rotating_key_lines(client):
    buyer_token, orders = await _topproxy_lines(client, "_dash_tp")
    body = (await client.get("/me/proxies?sort=line", headers=_h(buyer_token))).json()
    by_order = {i["order_code"]: i for i in body["items"]}
    static = by_order[orders["static"].order_code]
    key = by_order[orders["xoay"].order_code]
    assert (static["ip_type"], static["rotation"], static["protocol"], static["network"], static["country"]) == (
        "residential", "static", "SOCKS5", "Viettel", "VN")
    assert static["username"] == "tpu" and static["password"] == "tpp" and static["port"] == 41234
    assert static["whitelist_supported"] is False
    assert (key["ip_type"], key["rotation"], key["host"], key["port"]) == ("residential", "rotating_key", "103.1.2.3", 21001)
    assert key["username"] is None and key["password"] is None  # xác thực bằng IP whitelist
    assert key["whitelist_supported"] is True and key["rotation_available"] is True
    assert "topproxy" not in str(body).lower()
    assert key["variant_name"] == "HTTP · Key xoay · 30 ngày"

    # Bộ lọc theo chiều + tab "sắp hết hạn" (key xoay còn 2 ngày).
    assert (await client.get("/me/proxies?rotation=rotating_key", headers=_h(buyer_token))).json()["total"] == 1
    assert (await client.get("/me/proxies?ip_type=datacenter", headers=_h(buyer_token))).json()["total"] == 0
    soon = (await client.get("/me/proxies?status=soon", headers=_h(buyer_token))).json()
    assert [i["order_code"] for i in soon["items"]] == [orders["xoay"].order_code]
    assert soon["summary"] == {"all": 2, "running": 2, "soon": 1, "problem": 0}


@pytest.mark.asyncio
async def test_line_without_snapshot_is_classified_on_read(client):
    """Dòng giao trước khi có cột phân loại (NULL) vẫn hiện đúng loại."""
    buyer_token, orders = await _topproxy_lines(client, "_dash_legacy")
    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == orders["static"].id))
        allocation.ip_type = allocation.rotation_kind = allocation.protocol = None
        await db.commit()
    body = (await client.get(f"/me/proxies?q={orders['static'].order_code}", headers=_h(buyer_token))).json()
    assert body["items"][0]["protocol"] == "SOCKS5" and body["items"][0]["rotation"] == "static"


# ---------------------------------------------------------------------------
# Tags + ghi chú + quyền
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tags_notes_and_filters(client):
    buyer_token, orders = await _topproxy_lines(client, "_dash_tags")
    static_id = f"{orders['static'].order_code}#01"
    key_id = f"{orders['xoay'].order_code}#01"

    tag = (await client.post("/me/proxy-tags", json={"name": "Chiến dịch A", "tone": "iris"}, headers=_h(buyer_token))).json()
    assert tag["id"] and not tag["id"].isdigit() and tag["name"] == "Chiến dịch A"
    dup = await client.post("/me/proxy-tags", json={"name": "chiến dịch a"}, headers=_h(buyer_token))
    assert dup.status_code == 409 and dup.json()["error_code"] == "PROXY_TAG_DUPLICATE"

    resp = await client.post("/me/proxies/tags", json={"line_ids": [static_id, key_id], "add": [tag["id"]]}, headers=_h(buyer_token))
    assert resp.status_code == 200 and resp.json() == {"updated": 2}
    tagged = (await client.get(f"/me/proxies?tags={tag['id']}", headers=_h(buyer_token))).json()
    assert tagged["total"] == 2 and all(tag["id"] in i["tag_ids"] for i in tagged["items"])
    await client.post("/me/proxies/tags", json={"line_ids": [key_id], "remove": [tag["id"]]}, headers=_h(buyer_token))
    assert (await client.get("/me/proxies?tags=__none__", headers=_h(buyer_token))).json()["total"] == 1
    tags = (await client.get("/me/proxy-tags", headers=_h(buyer_token))).json()
    assert tags[0]["count"] == 1

    note = await client.patch("/me/proxies/note", json={"line_id": static_id, "note": "  máy #3  "}, headers=_h(buyer_token))
    assert note.status_code == 200 and note.json()["note"] == "máy #3"
    assert (await client.get("/me/proxies?q=máy", headers=_h(buyer_token))).json()["total"] == 1

    assert (await client.patch(f"/me/proxy-tags/{tag['id']}", json={"name": "B", "tone": "warn"}, headers=_h(buyer_token))).json()["tone"] == "warn"
    assert (await client.delete(f"/me/proxy-tags/{tag['id']}", headers=_h(buyer_token))).status_code == 204
    assert (await client.get("/me/proxies?tags=__none__", headers=_h(buyer_token))).json()["total"] == 2


@pytest.mark.asyncio
async def test_other_buyers_cannot_see_or_touch_lines_or_tags(client):
    buyer_token, orders = await _topproxy_lines(client, "_dash_owner")
    line = f"{orders['static'].order_code}#01"
    tag = (await client.post("/me/proxy-tags", json={"name": "Mine"}, headers=_h(buyer_token))).json()

    other = await register_and_login(client, "dash_intruder@example.com")
    assert (await client.get("/me/proxies", headers=_h(other))).json()["total"] == 0
    resp = await client.patch("/me/proxies/note", json={"line_id": line, "note": "x"}, headers=_h(other))
    assert resp.status_code == 404 and resp.json()["error_code"] == "PROXY_NOT_FOUND"
    resp = await client.post("/me/proxies/tags", json={"line_ids": [line], "add": []}, headers=_h(other))
    assert resp.status_code == 404
    assert (await client.patch(f"/me/proxy-tags/{tag['id']}", json={"name": "x"}, headers=_h(other))).status_code == 404
    assert (await client.delete(f"/me/proxy-tags/{tag['id']}", headers=_h(other))).status_code == 404
    # Tag của buyer khác không gắn được vào dòng của mình.
    other_tag = (await client.post("/me/proxy-tags", json={"name": "Theirs"}, headers=_h(other))).json()
    resp = await client.post("/me/proxies/tags", json={"line_ids": [line], "add": [other_tag["id"]]}, headers=_h(buyer_token))
    assert resp.status_code == 404 and resp.json()["error_code"] == "PROXY_TAG_NOT_FOUND"
    assert (await client.get("/me/proxies")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_malformed_line_ids_are_not_found(client):
    buyer_token, _orders = await _topproxy_lines(client, "_dash_bad")
    for bad in ("123", "ORD-XXXXXX#02", "../../etc", "ORD-ABCDEFGH#1a"):
        resp = await client.patch("/me/proxies/note", json={"line_id": bad, "note": "x"}, headers=_h(buyer_token))
        assert resp.status_code in (404, 422), (bad, resp.text)


@pytest.mark.asyncio
async def test_lines_past_expiry_count_as_expired_even_before_reconciliation(client):
    buyer_token, orders = await _topproxy_lines(client, "_dash_clock")
    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == orders["static"].id))
        allocation.expires_at = datetime.now(timezone.utc) - timedelta(days=1)  # vẫn `allocated`
        await db.commit()
    body = (await client.get("/me/proxies", headers=_h(buyer_token))).json()
    assert body["summary"] == {"all": 2, "running": 1, "soon": 1, "problem": 1}
    running = (await client.get("/me/proxies?status=running", headers=_h(buyer_token))).json()
    assert [i["order_code"] for i in running["items"]] == [orders["xoay"].order_code]
    problem = (await client.get("/me/proxies?status=problem", headers=_h(buyer_token))).json()["items"][0]
    assert problem["order_code"] == orders["static"].order_code
    assert problem["status"] == "expired" and problem["rotation_available"] is False


@pytest.mark.asyncio
async def test_filters_combine_and_facets_count_under_the_other_filters(client):
    buyer_token, orders = await _topproxy_lines(client, "_dash_facets")
    tag = (await client.post("/me/proxy-tags", json={"name": "Facebook"}, headers=_h(buyer_token))).json()
    await client.post("/me/proxies/tags", json={"line_ids": [f"{orders['xoay'].order_code}#01"], "add": [tag["id"]]},
                      headers=_h(buyer_token))

    # tab + tag + tìm kiếm cùng lúc (AND).
    body = (await client.get(f"/me/proxies?status=soon&tags={tag['id']}&q=Key", headers=_h(buyer_token))).json()
    assert [i["order_code"] for i in body["items"]] == [orders["xoay"].order_code]
    assert (await client.get(f"/me/proxies?status=soon&tags={tag['id']}&q=Viettel", headers=_h(buyer_token))).json()["total"] == 0

    body = (await client.get(f"/me/proxies?tags={tag['id']}", headers=_h(buyer_token))).json()
    f = body["facets"]
    # Số của tab tính theo tag đang chọn; summary vẫn là toàn bộ.
    assert f["status"] == {"all": 1, "running": 1, "soon": 1, "problem": 0}
    assert body["summary"] == {"all": 2, "running": 2, "soon": 1, "problem": 0}
    assert f["rotation"] == {"static": 0, "rotating": 0, "rotating_key": 1}
    assert f["ip_type"] == {"residential": 1, "mobile": 0, "datacenter": 0}
    # Facet tag đếm theo các chiều KHÁC (không tự lọc chính nó).
    assert f["tags"] == {tag["id"]: 1, "__none__": 1}
    assert f["expires"]["3d"] == 1 and f["expires"]["7d"] == 1 and f["expires"]["expired"] == 0

    # Chọn một giá trị trong chiều rotation không làm mất số của các giá trị khác cùng chiều.
    f2 = (await client.get("/me/proxies?rotation=static", headers=_h(buyer_token))).json()["facets"]
    assert f2["rotation"] == {"static": 1, "rotating": 0, "rotating_key": 1}
    assert f2["ip_type"]["residential"] == 1  # chỉ dòng tĩnh
