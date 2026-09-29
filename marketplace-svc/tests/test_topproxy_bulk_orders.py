"""Nhiều proxy TopProxy trong MỘT đơn, chạy trọn luồng đơn hàng (tạo đơn →
provision_pending_order → finalize_order_lines) trên mock TopProxy thật
(scripts/mock_topproxy.py, gọi in-process qua ASGITransport).

Trọng tâm: mỗi proxy một dòng (`line_no`), giao thiếu (201) được hoàn phần
thiếu ngay, retry không bao giờ mua lại dòng đã có, và quantity vượt giới hạn
bị chặn trước khi trừ ví.
"""
import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import undefer

from scripts import mock_topproxy
from src.adapters.registry import PROXY_MAX_PER_ORDER
from src.adapters.topproxy_costs import static_cost_xu
from src.config import settings
from src.database import SessionLocal
from src.models.category import Category
from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductStatus
from src.models.provider import Provider
from src.models.proxy_allocation import ProxyAllocation
from src.models.wallet import Transaction
from src.orders.service import provision_pending_order
from src.security.crypto import encrypt_config

from .conftest import make_admin, register_and_login

BASE_URL = "http://topproxy.test"
UNIT_PRICE = 60_000
START_XU = 1_000_000
CFG = {"type": "HTTP", "network": "Viettel", "days": 30}


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _mock_topproxy(monkeypatch):
    """Mọi request của adapter tới topproxy.test đi vào mock in-process."""
    mock_topproxy.reset_state()
    original_get = httpx.AsyncClient.get

    async def fake_get(self, url, *args, **kwargs):
        if not str(url).startswith(BASE_URL):
            return await original_get(self, url, *args, **kwargs)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mock_topproxy.app)) as mock_client:
            return await original_get(mock_client, url, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)
    yield
    mock_topproxy.reset_state()


async def _setup(client, suffix: str) -> tuple[str, int, int]:
    """(buyer token, product id, provider id): sản phẩm TopProxy tĩnh giá gói
    `HTTP|Viettel|30`, buyer đã nạp ví."""
    admin_email = f"tpb_admin{suffix}@example.com"
    await register_and_login(client, admin_email)
    await make_admin(admin_email)
    admin_token = await register_and_login(client, admin_email)
    seller_token = await register_and_login(client, f"tpb_seller{suffix}@example.com")
    seller_id = (await client.get("/me", headers=_h(seller_token))).json()["id"]
    buyer_token = await register_and_login(client, f"tpb_buyer{suffix}@example.com")
    buyer_id = (await client.get("/me", headers=_h(buyer_token))).json()["id"]
    resp = await client.post(
        "/wallet/topup", json={"reason": "test topup", "account_id": buyer_id, "amount": 1_000_000},
        headers=_h(admin_token),
    )
    assert resp.status_code in (200, 201), resp.text

    async with SessionLocal() as db:
        category = Category(name=f"TPB{suffix}", slug=f"tpb{suffix}")
        db.add(category)
        provider = Provider(
            name=f"TP static{suffix}", type="topproxy", adapter_type="topproxy",
            config=encrypt_config({"base_url": BASE_URL, "api_key": mock_topproxy.MOCK_KEY, "mode": "static"}),
            credit_balance_xu=START_XU,
        )
        db.add(provider)
        await db.flush()
        product = Product(
            seller_id=seller_id, category_id=category.id, title="Proxy tĩnh Viettel", status=ProductStatus.active,
            service_type="proxy", provider_id=provider.id, pricing_strategy="config",
            pricing_params={"plan_prices": {"HTTP|Viettel|30": UNIT_PRICE}},
        )
        db.add(product)
        await db.commit()
        return buyer_token, product.id, provider.id


async def _place(client, token: str, product_id: int, quantity: int) -> httpx.Response:
    return await client.post(
        "/orders", json={"product_id": product_id, "user_config": {**CFG, "quantity": quantity}},
        headers=_h(token),
    )


async def _order_and_lines(order_id: int) -> tuple[Order, list[ProxyAllocation]]:
    async with SessionLocal() as db:
        order = await db.get(Order, order_id, options=[undefer(Order.delivered_data)])
        lines = list((await db.execute(
            select(ProxyAllocation).where(ProxyAllocation.order_id == order_id).order_by(ProxyAllocation.line_no)
        )).scalars())
        return order, lines


def _marker(order_id: int) -> str:
    return f"{settings.topproxy_marker_prefix}{order_id}"


async def _buy_in_mock(order_id: int, count: int) -> list[dict]:
    """Mua thẳng trên mock với marker của đơn — dựng dấu vết của một attempt trước."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mock_topproxy.app)) as c:
        resp = await c.get(f"{BASE_URL}/apiv2/muaproxy.php", params={
            "key": mock_topproxy.MOCK_KEY, "loaiproxy": "Viettel", "soluong": count, "ngay": 30,
            "type": "HTTP", "user": _marker(order_id), "password": "pw",
        })
    rows = resp.json()
    assert isinstance(rows, list) and len(rows) == count
    return rows


@pytest.mark.asyncio
async def test_three_static_proxies_three_lines(client):
    token, product_id, provider_id = await _setup(client, "_n3")
    resp = await _place(client, token, product_id, 3)
    assert resp.status_code == 201, resp.text
    order_id = resp.json()["id"]

    await provision_pending_order(order_id)

    order, lines = await _order_and_lines(order_id)
    assert order.status == OrderStatus.delivered
    assert order.quantity == 3 and order.total_amount == 3 * UNIT_PRICE
    assert [a.line_no for a in lines] == [1, 2, 3]
    assert len({a.external_id for a in lines}) == 3
    assert len({a.delivered_text for a in lines}) == 3  # mỗi dòng credential riêng
    assert all(_marker(order_id) in a.delivered_text for a in lines)
    assert order.delivered_data == "\n\n".join(f"#{a.line_no:02d}\n{a.delivered_text}" for a in lines)
    assert order.refunded_amount == 0
    # Một lệnh mua soluong=3, sổ Xu trừ đúng 3 proxy.
    assert len(mock_topproxy._proxies) == 3
    async with SessionLocal() as db:
        provider = await db.get(Provider, provider_id)
        assert provider.credit_balance_xu == START_XU - 3 * static_cost_xu("Viettel", 30)


@pytest.mark.asyncio
async def test_short_delivery_201_refunds_the_missing_share(client):
    token, product_id, provider_id = await _setup(client, "_201")
    mock_topproxy._state["short_by"] = 1  # mọi lệnh mua giao thiếu 1 (status 201)
    order_id = (await _place(client, token, product_id, 3)).json()["id"]

    await provision_pending_order(order_id)

    order, lines = await _order_and_lines(order_id)
    assert order.status == OrderStatus.delivered
    assert [a.line_no for a in lines] == [1, 2]
    assert order.refunded_amount == order.total_amount // 3
    assert [a.refund_amount_cap for a in lines] == [UNIT_PRICE, UNIT_PRICE]
    assert order.delivered_data.startswith("#01\n") and "#02\n" in order.delivered_data
    assert "#03" not in order.delivered_data
    async with SessionLocal() as db:
        refund = await db.scalar(
            select(Transaction).where(Transaction.reference_id == f"order-{order_id}:short-delivery")
        )
        provider = await db.get(Provider, provider_id)
    assert refund is not None and refund.amount == UNIT_PRICE
    assert provider.credit_balance_xu == START_XU - 2 * static_cost_xu("Viettel", 30)


@pytest.mark.asyncio
async def test_nothing_delivered_cancels_and_refunds_in_full(client):
    token, product_id, _ = await _setup(client, "_none")
    mock_topproxy._state["short_by"] = 5  # mock giao 0 → 103
    order_id = (await _place(client, token, product_id, 3)).json()["id"]

    await provision_pending_order(order_id)

    order, lines = await _order_and_lines(order_id)
    assert order.status == OrderStatus.cancelled
    assert lines == []
    assert order.refunded_amount == order.total_amount


@pytest.mark.asyncio
async def test_retry_after_partial_binding_buys_only_the_missing_line(client):
    token, product_id, provider_id = await _setup(client, "_retry")
    order_id = (await _place(client, token, product_id, 3)).json()["id"]

    # Attempt trước đã bind dòng 1–2 (bằng chính adapter, rồi "chết" trước khi
    # đơn đổi trạng thái): mua 2 con trên mock và ghi đúng 2 dòng.
    rows = await _buy_in_mock(order_id, 2)
    from src.adapters.factory import get_adapter
    from src.resources.proxy_service import bind_purchased_assignment

    async with SessionLocal() as db:
        adapter = await get_adapter(provider_id, db)
        for n, row in enumerate(rows, start=1):
            assignment = adapter._assignment_from_row(row, fallback_days=30, proxy_type="HTTP", network="Viettel")
            await bind_purchased_assignment(
                provider_id, order_id, assignment, db, line_no=n, delivered_text=assignment.delivered_text(),
            )
        await db.commit()
    _, before = await _order_and_lines(order_id)
    kept = [(a.line_no, a.external_id, a.delivered_text) for a in before]

    await provision_pending_order(order_id)

    order, lines = await _order_and_lines(order_id)
    assert order.status == OrderStatus.delivered
    assert [(a.line_no, a.external_id, a.delivered_text) for a in lines[:2]] == kept
    assert [a.line_no for a in lines] == [1, 2, 3]
    assert len(mock_topproxy._proxies) == 3  # mua đúng MỘT con nữa
    assert order.refunded_amount == 0
    async with SessionLocal() as db:
        provider = await db.get(Provider, provider_id)
    assert provider.credit_balance_xu == START_XU - static_cost_xu("Viettel", 30)


@pytest.mark.asyncio
async def test_crash_recovery_reclaims_marker_rows_without_rebuying(client):
    """Attempt trước mua đủ 3 con rồi chết trước khi ghi dòng nào (rollback) —
    retry nhận lại cả 3 qua marker, không mua thêm con nào."""
    token, product_id, _ = await _setup(client, "_crash")
    order_id = (await _place(client, token, product_id, 3)).json()["id"]
    rows = await _buy_in_mock(order_id, 3)

    await provision_pending_order(order_id)

    order, lines = await _order_and_lines(order_id)
    assert order.status == OrderStatus.delivered
    assert sorted(a.external_id for a in lines) == sorted(str(r["idproxy"]) for r in rows)
    assert len(mock_topproxy._proxies) == 3


@pytest.mark.asyncio
async def test_quantity_above_limit_rejected_before_charging(client):
    token, product_id, _ = await _setup(client, "_limit")
    async with SessionLocal() as db:
        orders_before = await db.scalar(select(func.count()).select_from(Order))
    wallet_before = (await client.get("/wallet", headers=_h(token))).json()

    resp = await _place(client, token, product_id, PROXY_MAX_PER_ORDER + 1)

    assert resp.status_code == 400, resp.text
    assert resp.json()["error_code"] == "ORDER_QUANTITY_LIMIT"
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(Order)) == orders_before
    assert (await client.get("/wallet", headers=_h(token))).json() == wallet_before
    assert mock_topproxy._proxies == {}
