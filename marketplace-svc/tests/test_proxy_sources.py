"""Nguồn PROXY trong /admin/sources — src/suppliers/proxy_sources.py.

TopProxy có catalog TĨNH (không gọi mạng), DProxy kéo `GET /store/plans` từ
scripts/mock_dproxy.py qua ASGITransport. Nhập gói tạo sản phẩm pricing
`config` với `plan_prices` (và `plan_ids` trên provider cho DProxy) — đúng
cấu trúc DProxyAdapter/TopProxyAdapter đang provision, nên luồng đơn không đổi.
"""
import importlib

import httpx
import pytest
from sqlalchemy import select

from src.adapters import real_api as real_api_module
from src.adapters.topproxy import STATIC_PLAN_LABELS, xoay_cost_for_days
from src.adapters.topproxy_costs import static_cost_xu
from src.database import SessionLocal
from src.models.product import Product
from src.models.provider import Provider
from src.models.supplier_listing import SupplierCatalogItem
from tests.conftest import make_admin, make_seller, register_and_login


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.no_db
def test_xoay_cost_picks_the_cheapest_whole_unit():
    assert xoay_cost_for_days(1) == ("day", 2_500)
    assert xoay_cost_for_days(7) == ("week", 14_000)
    assert xoay_cost_for_days(30) == ("month", 45_000)
    assert xoay_cost_for_days(60) == ("month", 90_000)
    assert xoay_cost_for_days(0) is None


@pytest.fixture
def mock_dproxy(monkeypatch):
    import scripts.mock_dproxy as mock_module

    mock = importlib.reload(mock_module)
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return real_client(*args, transport=httpx.ASGITransport(app=mock.app), **kwargs)

    monkeypatch.setattr(real_api_module.httpx, "AsyncClient", client_factory)
    return mock


async def _admin_and_category(client):
    await register_and_login(client, "px_admin@example.com")
    await make_admin("px_admin@example.com")
    admin = await register_and_login(client, "px_admin@example.com")
    resp = await client.post("/admin/categories", json={"name": "ProxyCat", "slug": "proxycat"}, headers=_h(admin))
    return admin, resp.json()["id"]


async def _create_topproxy_source(client, admin, *, mode="static"):
    # base_url trỏ cổng không ai nghe → check_health sau sync fail nhanh, không chặn tạo nguồn.
    resp = await client.post("/admin/sources", json={
        "adapter_type": "topproxy", "name": f"TopProxy {mode}",
        "config": {"base_url": "http://127.0.0.1:9", "api_key": "tp-key", "mode": mode, "min_margin_pct": 10},
        "new_seller": {"email": f"tp-{mode}@example.com", "business_name": f"TP {mode}"},
    }, headers=_h(admin))
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_topproxy_source_appears_with_static_plan_catalog(client):
    admin, _cat = await _admin_and_category(client)
    kinds = (await client.get("/admin/sources/kinds", headers=_h(admin))).json()
    tp = next(k for k in kinds if k["adapter_type"] == "topproxy")
    assert tp["kind"] == "proxy" and any(f["key"] == "mode" and f.get("type") == "select" for f in tp["fields"])

    body = await _create_topproxy_source(client, admin)
    assert body["kind"] == "proxy" and body["catalog_items"] == len(STATIC_PLAN_LABELS)

    rows = (await client.get("/admin/sources", headers=_h(admin))).json()
    row = next(r for r in rows if r["id"] == body["provider_id"])
    assert row["kind"] == "proxy" and row["catalog_count"] == len(STATIC_PLAN_LABELS)

    # Catalog duyệt được dù không có tồn (amount = -1 ≠ 0), kèm attributes máy.
    cat = (await client.get(f"/admin/sources/{body['provider_id']}/catalog", headers=_h(admin))).json()
    assert cat["total"] == len(STATIC_PLAN_LABELS)
    viettel = next(i for i in cat["items"] if i["external_id"] == "Viettel")
    assert viettel["amount"] == -1 and viettel["extra"]["loaiproxy"] == "Viettel"
    assert viettel["cost_price"] == static_cost_xu("Viettel", 30)
    assert {g["name"] for g in cat["groups"]} >= {"Dân cư tĩnh", "Datacenter VN"}

    # Nguồn proxy KHÔNG có listing kiểu catalog; bảng gói đang bán rỗng.
    assert (await client.get(f"/admin/sources/{body['provider_id']}/offers", headers=_h(admin))).json() == []


@pytest.mark.asyncio
async def test_import_topproxy_plans_builds_config_pricing_and_offers(client):
    admin, cat_id = await _admin_and_category(client)
    body = await _create_topproxy_source(client, admin)
    pid = body["provider_id"]

    resp = await client.post(f"/admin/sources/{pid}/import-plans", json={"items": [
        {"external_id": "Viettel", "type": "HTTP", "days": 30, "price": 108000, "group_key": "res",
         "title": "Proxy dân cư tĩnh Việt Nam", "category_id": cat_id, "status": "active",
         "network_label": "Viettel"},
        {"external_id": "FPT", "type": "HTTP", "days": 30, "price": 108000, "group_key": "res", "network_label": "FPT"},
        {"external_id": "FPT", "type": "SOCKS5", "days": 7, "group_key": "res"},   # giá gợi ý từ vốn
        {"external_id": "US", "type": "SOCKS5", "days": 30, "price": 72000, "title": "Proxy US", "category_id": cat_id},
    ]}, headers=_h(admin))
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert len(created) == 4 and len({c["product_id"] for c in created}) == 2
    assert created[0]["plan_key"] == "HTTP|Viettel|30" and created[0]["cost_price"] == static_cost_xu("Viettel", 30)
    suggested = next(c for c in created if c["plan_key"] == "SOCKS5|FPT|7")
    assert suggested["price"] > suggested["cost_price"] == static_cost_xu("FPT", 7)

    async with SessionLocal() as db:
        product = await db.get(Product, created[0]["product_id"])
        assert product.pricing_strategy == "config" and product.provider_id == pid and product.service_type == "proxy"
        assert set(product.pricing_params["plan_prices"]) == {"HTTP|Viettel|30", "HTTP|FPT|30", "SOCKS5|FPT|7"}
        assert product.pricing_params["network_display"]["Viettel"] == "Viettel"
        assert product.status.value == "active"

    offers = (await client.get(f"/admin/sources/{pid}/offers", headers=_h(admin))).json()
    assert len(offers) == 4
    v = next(o for o in offers if o["plan_key"] == "HTTP|Viettel|30")
    assert v["cost_price"] == static_cost_xu("Viettel", 30) and v["price"] == 108000 and v["margin_ok"]
    assert v["external_id"] == "Viettel" and v["label"].startswith("HTTP · Viettel · 30 ngày")

    # Giá bán 7 ngày phải tra bậc thang 7 ngày, không phải 30 ngày.
    f7 = next(o for o in offers if o["plan_key"] == "SOCKS5|FPT|7")
    assert f7["cost_price"] == static_cost_xu("FPT", 7) != static_cost_xu("FPT", 30)

    # Sửa giá → dưới margin tối thiểu bị đánh dấu; gỡ gói cuối → sản phẩm về nháp.
    resp = await client.patch(f"/admin/sources/{pid}/offers", json={"product_id": v["product_id"], "plan_key": v["plan_key"], "price": 15000}, headers=_h(admin))
    assert resp.status_code == 200 and resp.json()["margin_ok"] is False
    us = next(o for o in offers if o["plan_key"] == "SOCKS5|US|30")
    resp = await client.post(f"/admin/sources/{pid}/offers/remove", json={"product_id": us["product_id"], "plan_key": us["plan_key"]}, headers=_h(admin))
    assert resp.status_code == 204
    async with SessionLocal() as db:
        p_us = await db.get(Product, us["product_id"])
        assert p_us.status.value == "draft" and p_us.pricing_params["plan_prices"] == {}

    # Áp margin hàng loạt.
    resp = await client.post(f"/admin/sources/{pid}/offers/reprice", json={"margin_pct": 50}, headers=_h(admin))
    assert resp.json()["updated"] == 3
    offers = (await client.get(f"/admin/sources/{pid}/offers", headers=_h(admin))).json()
    assert all(o["margin_ok"] for o in offers) and len(offers) == 3


@pytest.mark.asyncio
async def test_topproxy_xoay_source_prices_by_unit(client):
    admin, cat_id = await _admin_and_category(client)
    body = await _create_topproxy_source(client, admin, mode="xoay")
    pid = body["provider_id"]
    assert body["catalog_items"] == 3
    cat = (await client.get(f"/admin/sources/{pid}/catalog", headers=_h(admin))).json()
    month = next(i for i in cat["items"] if i["external_id"] == "xoay:month")
    assert month["extra"]["duration_days"] == 30 and month["cost_price"] == 45_000

    resp = await client.post(f"/admin/sources/{pid}/import-plans", json={"items": [
        {"external_id": "xoay:month", "days": 30, "price": 68000, "title": "Key xoay", "category_id": cat_id, "group_key": "k"},
        {"external_id": "xoay:week", "days": 7, "price": 21000, "group_key": "k"},
        {"external_id": "xoay:day", "days": 3, "price": 12000, "group_key": "k"},
    ]}, headers=_h(admin))
    assert resp.status_code == 201, resp.text
    offers = {o["plan_key"]: o for o in (await client.get(f"/admin/sources/{pid}/offers", headers=_h(admin))).json()}
    assert set(offers) == {"HTTP|xoay|30", "HTTP|xoay|7", "HTTP|xoay|3"}
    assert offers["HTTP|xoay|30"]["cost_price"] == 45_000 and offers["HTTP|xoay|7"]["cost_price"] == 14_000
    assert offers["HTTP|xoay|3"]["cost_price"] == 7_500 and offers["HTTP|xoay|3"]["label"].endswith("Key xoay · 3 ngày")
    # Giao thức lạ bị chặn ngay lúc nhập.
    resp = await client.post(f"/admin/sources/{pid}/import-plans", json={"items": [
        {"external_id": "xoay:day", "type": "HTTPS", "days": 1, "price": 5000, "product_id": offers["HTTP|xoay|30"]["product_id"]},
    ]}, headers=_h(admin))
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_dproxy_source_syncs_plans_and_import_writes_plan_ids(client, mock_dproxy):
    admin, cat_id = await _admin_and_category(client)
    resp = await client.post("/admin/sources", json={
        "adapter_type": "dproxy", "name": "DProxy M2M",
        "config": {"base_url": "https://dproxy.test", "api_key": "mock-dproxy-token", "auth_type": "bearer", "channel": "proxora"},
        "new_seller": {"email": "dp@example.com", "business_name": "DP"},
    }, headers=_h(admin))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    pid = body["provider_id"]
    assert body["kind"] == "proxy" and body["catalog_items"] >= 1 and body["sync_error"] is None

    async with SessionLocal() as db:
        items = (await db.execute(select(SupplierCatalogItem).where(SupplierCatalogItem.provider_id == pid))).scalars().all()
        plan = next(i for i in items if i.extra.get("duration_days"))
        assert plan.amount == -1 and plan.extra["currency"]

    resp = await client.post(f"/admin/sources/{pid}/import-plans", json={"items": [
        {"external_id": plan.external_id, "type": "residential", "network": "VN", "days": plan.extra["duration_days"],
         "price": 150000, "title": "Proxy dân cư xoay VN", "category_id": cat_id, "status": "active",
         "type_label": "Dân cư xoay", "network_label": "Việt Nam"},
    ]}, headers=_h(admin))
    assert resp.status_code == 201, resp.text
    key = f"residential|VN|{plan.extra['duration_days']}"
    assert resp.json()[0]["plan_key"] == key

    async with SessionLocal() as db:
        provider = await db.get(Provider, pid)
        assert provider.config["plan_ids"] == {key: plan.external_id}
        product = await db.get(Product, resp.json()[0]["product_id"])
        assert product.pricing_params["plan_prices"] == {key: 150000}
    offers = (await client.get(f"/admin/sources/{pid}/offers", headers=_h(admin))).json()
    assert offers[0]["external_id"] == plan.external_id and offers[0]["unmapped"] is False
    assert offers[0]["label"] == f"Dân cư xoay · Việt Nam · {plan.extra['duration_days']} ngày"

    # Seller được giao nguồn thấy nguồn + gói của mình; seller khác 404.
    other = await register_and_login(client, "px_other@example.com")
    await make_seller("px_other@example.com")
    other = await register_and_login(client, "px_other@example.com")
    assert (await client.get(f"/seller/sources/{pid}/offers", headers=_h(other))).status_code == 404


@pytest.mark.no_db
def test_formula_products_are_listed_as_offers():
    from src.suppliers.proxy_sources import effective_prices, formula_prices

    params = {"base_price": 100_000, "type_mult": {"HTTP": 1, "SOCKS5": 1.2}, "network_mult": {"Viettel": 1, "FPT": 0.9},
              "duration_options": [{"days": 7, "label": "1 tuần"}, {"days": 30, "label": "1 tháng"}]}
    prices = formula_prices(params)
    assert len(prices) == 8 and prices["HTTP|Viettel|30"] == 100_000 and prices["SOCKS5|FPT|7"] == round(100_000 * 1.2 * 0.9 * 7 / 30)
    assert effective_prices(params) == (prices, True)
    assert effective_prices({"plan_prices": {"HTTP|Viettel|30": 1}}) == ({"HTTP|Viettel|30": 1}, False)
