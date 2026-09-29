"""TopProxy combos (1 unit = 90–100 proxies) are paused: they cannot be priced,
are hidden from buyers and are refused before any money moves."""
import pytest
from sqlalchemy import func, select

from src.adapters.topproxy import PACKAGE_LOAIPROXY, loaiproxy_on_sale
from src.database import SessionLocal
from src.models.order import Order
from src.models.product import Product

from .test_topproxy_bulk_orders import _h, _setup


@pytest.mark.no_db
def test_every_combo_is_paused_and_single_plans_are_not():
    assert PACKAGE_LOAIPROXY == {"GoiViettel", "GoiVNPT", "GoiFPT", "GoiDATACENTER"}
    assert not any(loaiproxy_on_sale(code) for code in PACKAGE_LOAIPROXY)
    assert all(loaiproxy_on_sale(code) for code in ("Viettel", "FPT", "VNPT", "DatacenterA", "4Gvinaphone", "US"))


async def _with_combo_prices(product_id: int) -> None:
    """A product saved before the pause: a combo sits next to a single plan."""
    async with SessionLocal() as db:
        product = await db.get(Product, product_id)
        product.pricing_params = {"plan_prices": {"HTTP|Viettel|30": 60_000, "HTTP|GoiFPT|30": 900_000}}
        await db.commit()


@pytest.mark.asyncio
async def test_combo_is_hidden_and_refused_before_charging(client):
    token, product_id, _provider_id = await _setup(client, "_combo")
    await _with_combo_prices(product_id)

    options = (await client.get(f"/products/{product_id}/pricing-options")).json()
    plan_field = next(f for f in options["fields"] if f["field"] == "plan_key")
    assert [c["value"] for c in plan_field["choices"]] == ["HTTP|Viettel|30"]
    assert options["ready"] is True

    wallet_before = (await client.get("/wallet", headers=_h(token))).json()["available_balance"]
    combo = {"type": "HTTP", "network": "GoiFPT", "days": 30, "quantity": 1}
    calc = await client.post(f"/products/{product_id}/calculate", json={"user_config": combo})
    assert calc.status_code == 400 and calc.json()["error_code"] == "PROXY_PLAN_PAUSED"
    order = await client.post("/orders", json={"product_id": product_id, "user_config": combo}, headers=_h(token))
    assert order.status_code == 400 and order.json()["error_code"] == "PROXY_PLAN_PAUSED"
    assert (await client.get("/wallet", headers=_h(token))).json()["available_balance"] == wallet_before
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count(Order.id)).where(Order.product_id == product_id)) == 0


@pytest.mark.asyncio
async def test_only_combos_left_makes_the_product_not_ready(client):
    _token, product_id, _provider_id = await _setup(client, "_combo_only")
    async with SessionLocal() as db:
        product = await db.get(Product, product_id)
        product.pricing_params = {"plan_prices": {"HTTP|GoiViettel|30": 700_000}}
        await db.commit()
    options = (await client.get(f"/products/{product_id}/pricing-options")).json()
    assert options["ready"] is False and options["not_ready_reason"]


@pytest.mark.asyncio
async def test_adapter_refuses_a_combo_purchase(client):
    from src.adapters.factory import get_adapter

    _token, _product_id, provider_id = await _setup(client, "_combo_adapter")
    async with SessionLocal() as db:
        adapter = await get_adapter(provider_id, db)
        result = await adapter.provision(999_001, {"type": "HTTP", "network": "GoiVNPT", "days": 30, "quantity": 1})
    assert result.success is False and result.buyer_message == "Gói này đang tạm ngừng bán."
