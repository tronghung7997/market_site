"""Several proxies on one order: one proxy_allocations row per line (`line_no`),
each with its own hand-over text, addressed `ORD-XXXX#NN` on /me/proxies."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import undefer
from sqlalchemy import select

from src.database import SessionLocal
from src.models.category import Category
from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductStatus
from src.models.provider import Provider
from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationSource, ProxyAllocationStatus
from src.proxies.service import snapshot_line_kind
from src.resources.proxy_service import compose_delivered_data, finalize_order_lines, line_caps
from src.security.crypto import encrypt_config

from .conftest import register_and_login


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _creds(n: int) -> str:
    return f"Host: 27.73.10.{n}\nPort: 4100{n}\nUsername: user{n}\nPassword: pass{n}"


async def _bulk_order(client, suffix: str, *, lines: int, quantity: int, total: int = 90000):
    """A delivered TopProxy static order of `quantity` proxies with `lines` of them bound."""
    buyer_token = await register_and_login(client, f"pl_buyer{suffix}@example.com")
    buyer_id = (await client.get("/me", headers=_h(buyer_token))).json()["id"]
    seller_token = await register_and_login(client, f"pl_seller{suffix}@example.com")
    seller_id = (await client.get("/me", headers=_h(seller_token))).json()["id"]
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        category = Category(name=f"PL{suffix}", slug=f"pl{suffix}")
        db.add(category)
        await db.flush()
        provider = Provider(name=f"TP{suffix}", type="topproxy", adapter_type="topproxy",
                            config=encrypt_config({"base_url": "https://topproxy.test", "api_key": "k", "mode": "static"}))
        db.add(provider)
        await db.flush()
        product = Product(seller_id=seller_id, category_id=category.id, title="Proxy tĩnh Viettel", status=ProductStatus.active,
                          service_type="proxy", provider_id=provider.id, pricing_strategy="config",
                          pricing_params={"plan_prices": {"HTTP|Viettel|30": total // quantity}})
        db.add(product)
        await db.flush()
        order = Order(buyer_id=buyer_id, seller_id=seller_id, product_id=product.id, quantity=quantity, total_amount=total,
                      status=OrderStatus.delivered, provider_id=provider.id,
                      user_config={"type": "HTTP", "network": "Viettel", "days": 30, "quantity": quantity})
        db.add(order)
        await db.flush()
        for n in range(1, lines + 1):
            db.add(ProxyAllocation(
                provider_id=provider.id, order_id=order.id, line_no=n, external_id=f"tp{suffix}-{n}",
                status=ProxyAllocationStatus.allocated, expires_at=now + timedelta(days=30),
                source=ProxyAllocationSource.purchase.value, last_public_ip=f"27.73.10.{n}", delivered_text=_creds(n),
            ))
        await db.flush()
        await snapshot_line_kind(order, product, provider.id, db)
        await db.commit()
        return buyer_token, order.id, order.order_code


@pytest.mark.no_db
def test_line_caps_and_composed_text():
    assert line_caps(100, 3) == [34, 33, 33]
    assert sum(line_caps(90000, 7)) == 90000
    one = ProxyAllocation(line_no=1, delivered_text="Host: a")
    two = ProxyAllocation(line_no=2, delivered_text="Host: b")
    assert compose_delivered_data([one]) == "Host: a"
    assert compose_delivered_data([one, two]) == "#01\nHost: a\n\n#02\nHost: b"


@pytest.mark.asyncio
async def test_every_line_is_its_own_row_on_the_dashboard(client):
    token, _order_id, code = await _bulk_order(client, "_rows", lines=3, quantity=3)
    body = (await client.get("/me/proxies?sort=line", headers=_h(token))).json()
    assert body["total"] == 3
    assert [i["id"] for i in body["items"]] == [f"{code}#01", f"{code}#02", f"{code}#03"]
    assert [(i["line_no"], i["username"], i["port"]) for i in body["items"]] == [
        (1, "user1", 41001), (2, "user2", 41002), (3, "user3", 41003)]
    # Every line got the package's kind at delivery.
    assert {i["ip_type"] for i in body["items"]} == {"residential"}

    # A note lands on its own line only; a line that does not exist is 404.
    resp = await client.patch("/me/proxies/note", json={"line_id": f"{code}#02", "note": "acc 2"}, headers=_h(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == f"{code}#02" and resp.json()["note"] == "acc 2"
    notes = {i["id"]: i["note"] for i in (await client.get("/me/proxies", headers=_h(token))).json()["items"]}
    assert notes == {f"{code}#01": "", f"{code}#02": "acc 2", f"{code}#03": ""}
    missing = await client.patch("/me/proxies/note", json={"line_id": f"{code}#04", "note": "x"}, headers=_h(token))
    assert missing.status_code == 404

    tag = (await client.post("/me/proxy-tags", json={"name": "FB farm"}, headers=_h(token))).json()
    resp = await client.post("/me/proxies/tags", json={"line_ids": [f"{code}#01", f"{code}#03"], "add": [tag["id"]]},
                             headers=_h(token))
    assert resp.status_code == 200 and resp.json()["updated"] == 2


@pytest.mark.asyncio
async def test_proxy_state_is_read_per_line_and_hidden_from_other_buyers(client):
    token, order_id, code = await _bulk_order(client, "_state", lines=2, quantity=2)
    first = await client.get(f"/orders/{code}/proxy", headers=_h(token))
    second = await client.get(f"/orders/{code}/proxy?line=2", headers=_h(token))
    assert first.status_code == 200 and second.status_code == 200
    assert (first.json()["public_ip"], second.json()["public_ip"]) == ("27.73.10.1", "27.73.10.2")
    assert (await client.get(f"/orders/{code}/proxy?line=3", headers=_h(token))).status_code == 404
    other = await register_and_login(client, "pl_other_state@example.com")
    assert (await client.get(f"/orders/{code}/proxy?line=2", headers=_h(other))).status_code == 404


@pytest.mark.asyncio
async def test_finalize_splits_caps_composes_text_and_reports_the_short_amount(client):
    _token, order_id, _code = await _bulk_order(client, "_short", lines=2, quantity=3, total=90000)
    async with SessionLocal() as db:
        order = await db.get(Order, order_id, options=[undefer(Order.delivered_data)])
        short = await finalize_order_lines(order, db, provision_text=None)
        await db.commit()
    assert short == 30000
    async with SessionLocal() as db:
        order = await db.get(Order, order_id, options=[undefer(Order.delivered_data)])
        caps = [a.refund_amount_cap for a in (await db.execute(
            select(ProxyAllocation).where(ProxyAllocation.order_id == order_id).order_by(ProxyAllocation.line_no)
        )).scalars()]
    assert caps == [30000, 30000]
    assert order.delivered_data == f"#01\n{_creds(1)}\n\n#02\n{_creds(2)}"


@pytest.mark.asyncio
async def test_single_line_orders_get_their_text_on_the_line(client):
    _token, order_id, _code = await _bulk_order(client, "_single", lines=1, quantity=1, total=50000)
    async with SessionLocal() as db:
        line = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        line.delivered_text = None
        await db.commit()
    async with SessionLocal() as db:
        order = await db.get(Order, order_id, options=[undefer(Order.delivered_data)])
        assert await finalize_order_lines(order, db, provision_text="Host: 1.2.3.4\nPort: 80") == 0
        await db.commit()
    async with SessionLocal() as db:
        line = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        order = await db.get(Order, order_id, options=[undefer(Order.delivered_data)])
    assert line.delivered_text == "Host: 1.2.3.4\nPort: 80" and line.refund_amount_cap == 50000
    assert order.delivered_data == "Host: 1.2.3.4\nPort: 80"


@pytest.mark.no_db
def test_per_order_limit_follows_mode_and_source_setting():
    from src.adapters.registry import (
        DPROXY_MAX_PER_ORDER, PROXY_MAX_PER_ORDER, TOPPROXY_XOAY_MAX_PER_ORDER, get_spec, max_quantity_for,
    )

    topproxy, dproxy = get_spec("topproxy"), get_spec("dproxy")
    assert max_quantity_for(topproxy, "config", {"mode": "static"}) == PROXY_MAX_PER_ORDER
    # Rotating keys are bought one call per key: a lower default.
    assert max_quantity_for(topproxy, "config", {"mode": "xoay"}) == TOPPROXY_XOAY_MAX_PER_ORDER == 10
    # A source's own setting wins, but never above the adapter maximum; 0 = default.
    assert max_quantity_for(topproxy, "config", {"mode": "xoay", "max_per_order": 25}) == 25
    assert max_quantity_for(topproxy, "config", {"mode": "xoay", "max_per_order": 500}) == PROXY_MAX_PER_ORDER
    assert max_quantity_for(topproxy, "config", {"mode": "xoay", "max_per_order": 0}) == 10
    assert max_quantity_for(dproxy, "config", {}) == DPROXY_MAX_PER_ORDER
    # The pool strategy stays one proxy per order whatever the setting.
    assert max_quantity_for(dproxy, "credit", {"max_per_order": 5}) == 1
    assert max_quantity_for(get_spec("seller_pool"), "fixed", {}) is None


@pytest.mark.asyncio
async def test_order_payload_counts_the_proxies_actually_delivered(client):
    """Three bought, two delivered: the order says 2 proxies, not its quantity."""
    token, _order_id, code = await _bulk_order(client, "_count", lines=2, quantity=3)
    order = (await client.get(f"/orders/{code}", headers=_h(token))).json()
    assert (order["quantity"], order["proxy_count"]) == (3, 2)
    listed = (await client.get("/orders", headers=_h(token))).json()
    items = listed["items"] if isinstance(listed, dict) else listed
    assert next(o for o in items if o["order_code"] == code)["proxy_count"] == 2
