import pytest
from tests.conftest import register_and_login, make_seller

pytestmark = pytest.mark.anyio


async def _seed_variant(client, seller_token, duration_days=None):
    # Caller must have already created category id 1 via an admin token.
    prod = await client.post("/seller/products", headers={"Authorization": f"Bearer {seller_token}"},
                             json={"category_id": 1, "title": "T", "status": "active", "escrow_days": 1, "service_type": "proxy"})
    pid = prod.json()["id"]
    var = await client.post(f"/seller/products/{pid}/variants", headers={"Authorization": f"Bearer {seller_token}"},
                            json={"name": "v", "price": 1000, "delivery_mode": "instant", "sla_hours": 24, "duration_days": duration_days})
    return var.json()


async def test_variant_accepts_duration_days(client):
    token = await register_and_login(client, "seller-life@ex.com")
    await make_seller("seller-life@ex.com")
    # category #1 must exist; create via admin
    admin = await register_and_login(client, "admin-life@ex.com")
    from tests.conftest import make_admin
    await make_admin("admin-life@ex.com")
    await client.post("/admin/categories", headers={"Authorization": f"Bearer {admin}"}, json={"name": "Proxy", "slug": "proxy"})
    var = await _seed_variant(client, token, duration_days=7)
    assert var["duration_days"] == 7


async def test_instant_order_assigns_resource_with_expiry(client):
    admin = await register_and_login(client, "admin-life2@ex.com")
    from tests.conftest import make_admin, make_seller
    await make_admin("admin-life2@ex.com")
    await client.post("/admin/categories", headers={"Authorization": f"Bearer {admin}"}, json={"name": "Proxy", "slug": "proxy"})
    seller = await register_and_login(client, "seller-life2@ex.com"); await make_seller("seller-life2@ex.com")
    var = await _seed_variant(client, seller, duration_days=7)
    vid = var["id"]
    await client.post(f"/seller/variants/{vid}/resources", headers={"Authorization": f"Bearer {seller}"},
                      json={"items": ["acc1|pw"]})
    buyer = await register_and_login(client, "buyer-life2@ex.com")
    # give buyer credit
    await client.post("/wallet/demo-topup", headers={"Authorization": f"Bearer {buyer}"}, json={"amount": 100000})
    order = await client.post("/orders", headers={"Authorization": f"Bearer {buyer}"},
                              json={"variant_id": vid, "quantity": 1})
    assert order.status_code == 201
    oid = order.json()["id"]
    res = await client.get(f"/orders/{oid}/resources", headers={"Authorization": f"Bearer {buyer}"})
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["status"] == "assigned"
    assert body[0]["expires_at"] is not None  # 7-day window set


async def test_seller_can_mark_resource_error(client):
    from tests.conftest import make_admin, make_seller
    admin = await register_and_login(client, "admin-err@ex.com"); await make_admin("admin-err@ex.com")
    await client.post("/admin/categories", headers={"Authorization": f"Bearer {admin}"}, json={"name": "Proxy", "slug": "proxy"})
    seller = await register_and_login(client, "seller-err@ex.com"); await make_seller("seller-err@ex.com")
    var = await _seed_variant(client, seller, duration_days=None)
    vid = var["id"]
    await client.post(f"/seller/variants/{vid}/resources", headers={"Authorization": f"Bearer {seller}"}, json={"items": ["a|b"]})
    listed = await client.get(f"/seller/variants/{vid}/resources", headers={"Authorization": f"Bearer {seller}"})
    rid = listed.json()[0]["id"]
    resp = await client.post(f"/seller/resources/{rid}/error", headers={"Authorization": f"Bearer {seller}"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "error"


async def test_product_detail_returns_duration_days(client):
    from tests.conftest import make_admin, make_seller
    admin = await register_and_login(client, "admin-dur@ex.com"); await make_admin("admin-dur@ex.com")
    await client.post("/admin/categories", headers={"Authorization": f"Bearer {admin}"}, json={"name": "Proxy", "slug": "proxy"})
    seller = await register_and_login(client, "seller-dur@ex.com"); await make_seller("seller-dur@ex.com")
    var = await _seed_variant(client, seller, duration_days=30)
    pid = var["product_id"]
    resp = await client.get(f"/products/{pid}")
    assert resp.status_code == 200
    variants = resp.json()["variants"]
    assert len(variants) >= 1
    assert variants[0]["duration_days"] == 30


async def test_admin_resource_summary(client):
    from tests.conftest import make_admin, make_seller
    admin = await register_and_login(client, "admin-sum@ex.com"); await make_admin("admin-sum@ex.com")
    await client.post("/admin/categories", headers={"Authorization": f"Bearer {admin}"}, json={"name": "Proxy", "slug": "proxy"})
    seller = await register_and_login(client, "seller-sum@ex.com"); await make_seller("seller-sum@ex.com")
    var = await _seed_variant(client, seller, duration_days=None)
    await client.post(f"/seller/variants/{var['id']}/resources", headers={"Authorization": f"Bearer {seller}"}, json={"items": ["a|b", "c|d"]})
    resp = await client.get("/admin/resources/summary", headers={"Authorization": f"Bearer {admin}"})
    assert resp.status_code == 200
    assert resp.json()["available"] == 2


async def test_admin_resource_seller_facet(client):
    from tests.conftest import make_admin, make_seller
    admin = await register_and_login(client, "admin-facet@ex.com"); await make_admin("admin-facet@ex.com")
    await client.post("/admin/categories", headers={"Authorization": f"Bearer {admin}"}, json={"name": "Proxy", "slug": "proxy"})
    seller = await register_and_login(client, "seller-facet@ex.com"); await make_seller("seller-facet@ex.com")
    var = await _seed_variant(client, seller, duration_days=None)
    await client.post(f"/seller/variants/{var['id']}/resources", headers={"Authorization": f"Bearer {seller}"}, json={"items": ["a|b", "c|d", "e|f"]})

    resp = await client.get("/admin/resources/sellers", headers={"Authorization": f"Bearer {admin}"})
    assert resp.status_code == 200
    rows = resp.json()
    row = next(r for r in rows if r["seller_email"] == "seller-facet@ex.com")
    assert row["count"] == 3
    assert row["seller_id"] > 0

    # Lọc danh sách theo seller_id phải khớp số đếm của facet
    listed = await client.get(f"/admin/resources?seller_id={row['seller_id']}", headers={"Authorization": f"Bearer {admin}"})
    assert listed.status_code == 200
    assert listed.json()["total"] == 3

    invalid_page = await client.get(
        "/admin/resources?page=0",
        headers={"Authorization": f"Bearer {admin}"},
    )
    oversized_page = await client.get(
        "/admin/resources?per_page=101",
        headers={"Authorization": f"Bearer {admin}"},
    )
    invalid_status = await client.get(
        "/admin/resources?status=not-a-status",
        headers={"Authorization": f"Bearer {admin}"},
    )
    assert invalid_page.status_code == 422
    assert oversized_page.status_code == 422
    assert invalid_status.status_code == 422
