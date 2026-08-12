"""Display FX config + order snapshot — VND ledger invariant."""
import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.display_money_config import DisplayMoneyConfig
from src.models.order import Order
from tests.conftest import make_admin, make_seller, register_and_login


@pytest.mark.asyncio
async def test_public_money_config_seeds_from_env(client):
    r = await client.get("/public/money-config")
    assert r.status_code == 200
    body = r.json()
    assert body["ledger_currency"] == "VND"
    assert body["display_fx_rate"] == 25_500  # Settings default
    assert body["display_currency_default"] in ("USD", "VND")
    assert "allow_user_toggle" in body
    assert "allow_locale_toggle" in body

    async with SessionLocal() as db:
        row = await db.get(DisplayMoneyConfig, 1)
        assert row is not None
        assert row.display_fx_rate == 25_500


@pytest.mark.asyncio
async def test_admin_patch_rate_and_reset_to_env(client):
    admin_token = await register_and_login(client, "fx-admin@test.com")
    await make_admin("fx-admin@test.com")
    admin_token = await register_and_login(client, "fx-admin@test.com")
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Seed via public
    await client.get("/public/money-config")

    r = await client.patch("/admin/money-config", json={"display_fx_rate": 27_000}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["display_fx_rate"] == 27_000
    assert r.json()["old_rate"] == 25_500

    pub = (await client.get("/public/money-config")).json()
    assert pub["display_fx_rate"] == 27_000

    # Out of range
    bad = await client.patch("/admin/money-config", json={"display_fx_rate": 99}, headers=headers)
    assert bad.status_code == 422

    # Zero rejected
    zero = await client.patch("/admin/money-config", json={"display_fx_rate": 0}, headers=headers)
    assert zero.status_code == 422

    # Change UI prefs, then reset — rate only (prefs must stay)
    await client.patch(
        "/admin/money-config",
        json={
            "display_currency_default": "VND",
            "allow_user_toggle": False,
            "allow_locale_toggle": True,
        },
        headers=headers,
    )

    reset = await client.post("/admin/money-config/reset-to-env", headers=headers)
    assert reset.status_code == 200
    assert reset.json()["display_fx_rate"] == 25_500
    assert reset.json()["display_currency_default"] == "VND"
    assert reset.json()["allow_user_toggle"] is False
    assert reset.json()["allow_locale_toggle"] is True

    admin_view = (await client.get("/admin/money-config", headers=headers)).json()
    assert admin_view["source"] == "db"
    assert admin_view["display_fx_rate"] == 25_500
    assert admin_view["display_currency_default"] == "VND"



@pytest.mark.asyncio
async def test_admin_ui_prefs_default_currency_and_switchers(client):
    admin_token = await register_and_login(client, "fx-ui-admin@test.com")
    await make_admin("fx-ui-admin@test.com")
    admin_token = await register_and_login(client, "fx-ui-admin@test.com")
    headers = {"Authorization": f"Bearer {admin_token}"}

    await client.get("/public/money-config")

    r = await client.patch(
        "/admin/money-config",
        json={
            "display_currency_default": "VND",
            "allow_user_toggle": False,
            "allow_locale_toggle": True,
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["display_currency_default"] == "VND"
    assert body["allow_user_toggle"] is False
    assert body["allow_locale_toggle"] is True

    pub = (await client.get("/public/money-config")).json()
    assert pub["display_currency_default"] == "VND"
    assert pub["allow_user_toggle"] is False
    assert pub["allow_locale_toggle"] is True

    admin_view = (await client.get("/admin/money-config", headers=headers)).json()
    assert admin_view["display_currency_default"] == "VND"
    assert admin_view["allow_locale_toggle"] is True
    assert "env_currency_default" in admin_view



@pytest.mark.asyncio
async def test_order_captures_fx_snapshot(client):
    """New orders store display_fx_rate_snapshot; later rate changes do not rewrite it."""
    # Seed custom rate
    async with SessionLocal() as db:
        db.add(DisplayMoneyConfig(id=1, display_fx_rate=24_000, updated_by_id=None))
        await db.commit()

    admin_token = await register_and_login(client, "fx_ord_admin@example.com")
    await make_admin("fx_ord_admin@example.com")
    admin_token = await register_and_login(client, "fx_ord_admin@example.com")
    admin_h = {"Authorization": f"Bearer {admin_token}"}

    await client.post(
        "/admin/categories",
        json={"name": "FxOrdCat", "slug": "fxordcat"},
        headers=admin_h,
    )
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    seller_token = await register_and_login(client, "fx_ord_seller@example.com")
    await make_seller("fx_ord_seller@example.com")
    seller_token = await register_and_login(client, "fx_ord_seller@example.com")
    seller_h = {"Authorization": f"Bearer {seller_token}"}

    product = await client.post(
        "/seller/products",
        json={"category_id": cat_id, "title": "FX Order Test", "status": "active", "escrow_days": 2},
        headers=seller_h,
    )
    assert product.status_code == 201, product.text
    product_id = product.json()["id"]

    variant = await client.post(
        f"/seller/products/{product_id}/variants",
        json={"name": "Manual", "price": 50_000, "delivery_mode": "manual", "sla_hours": 24},
        headers=seller_h,
    )
    assert variant.status_code == 201, variant.text
    vid = variant.json()["id"]

    buyer_token = await register_and_login(client, "fx_ord_buyer@example.com")
    buyer_h = {"Authorization": f"Bearer {buyer_token}"}
    buyer_me = await client.get("/me", headers=buyer_h)
    buyer_id = buyer_me.json()["id"]
    await client.post(
        "/wallet/topup",
        json={"account_id": buyer_id, "amount": 200_000},
        headers=admin_h,
    )

    order = await client.post("/orders", json={"variant_id": vid, "quantity": 1}, headers=buyer_h)
    assert order.status_code == 201, order.text
    body = order.json()
    assert body["total_amount"] == 50_000
    assert body["display_fx_rate_snapshot"] == 24_000

    # Change live rate — stored snapshot must stay
    await client.patch("/admin/money-config", json={"display_fx_rate": 30_000}, headers=admin_h)
    pub = (await client.get("/public/money-config")).json()
    assert pub["display_fx_rate"] == 30_000

    async with SessionLocal() as db:
        row = await db.get(Order, body["id"])
        assert row is not None
        assert row.display_fx_rate_snapshot == 24_000
        assert row.total_amount == 50_000  # ledger VND unchanged
