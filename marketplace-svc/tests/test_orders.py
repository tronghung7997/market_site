import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.account import Account
from src.models.affiliate import AffiliateCommission
from src.models.order import Order, OrderStatus
from src.models.pricing_config import PricingConfig
from src.models.product import Product
from src.models.provider import Provider
from src.models.wallet import Wallet
from tests.conftest import make_admin, make_seller, register_and_login


async def setup_affiliate_order(client, product_rate=None, category_rate=None, use_referral=True):
    """Create admin/seller/product+variant+resources, an affiliate, a referred buyer with credit.

    Returns (admin_token, seller_token, buyer_token, variant_id, affiliate_id, code).
    """
    admin_token = await register_and_login(client, "aff_admin@example.com")
    await make_admin("aff_admin@example.com")
    admin_token = await register_and_login(client, "aff_admin@example.com")

    cat_payload = {"name": "AffCat", "slug": "affcat"}
    if category_rate is not None:
        cat_payload["commission_rate"] = category_rate
    await client.post("/admin/categories", json=cat_payload,
                      headers={"Authorization": f"Bearer {admin_token}"})
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    seller_token = await register_and_login(client, "aff_seller@example.com")
    await make_seller("aff_seller@example.com")
    seller_token = await register_and_login(client, "aff_seller@example.com")

    prod_payload = {"category_id": cat_id, "title": "Aff Product", "status": "active", "escrow_days": 2}
    product = await client.post("/seller/products", json=prod_payload,
                                headers={"Authorization": f"Bearer {seller_token}"})
    if product_rate is not None:
        # commission_rate is admin-controlled, set via the operations endpoint
        await client.put(f"/admin/products/{product.json()['id']}/operations",
                         json={"commission_rate": product_rate},
                         headers={"Authorization": f"Bearer {admin_token}"})
    variant = await client.post(f"/seller/products/{product.json()['id']}/variants", json={
        "name": "Aff Var", "price": 10000, "delivery_mode": "instant",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    variant_id = variant.json()["id"]
    await client.post(f"/seller/variants/{variant_id}/resources", json={
        "items": ["uid1|pass1", "uid2|pass2", "uid3|pass3"],
    }, headers={"Authorization": f"Bearer {seller_token}"})

    affiliate_reg = await client.post("/auth/register", json={
        "email": "aff_holder@example.com", "password": "StrongPass123!",
    })
    affiliate_id = affiliate_reg.json()["id"]
    async with SessionLocal() as db:
        affiliate = await db.scalar(select(Account).where(Account.id == affiliate_id))
        code = affiliate.affiliate_code

    buyer_payload = {"email": "aff_buyer@example.com", "password": "StrongPass123!"}
    if use_referral:
        buyer_payload["referral_code"] = code
    await client.post("/auth/register", json=buyer_payload)
    buyer_login = await client.post("/auth/login", json={
        "email": "aff_buyer@example.com", "password": "StrongPass123!",
    })
    buyer_token = buyer_login.json()["access_token"]
    buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    buyer_id = buyer_me.json()["id"]
    await client.post("/wallet/topup", json={"account_id": buyer_id, "amount": 100000},
                      headers={"Authorization": f"Bearer {admin_token}"})

    return admin_token, seller_token, buyer_token, variant_id, affiliate_id, code


async def setup_buyable_product(client):
    """Create admin, seller with product+variant+resources, buyer with credit."""
    admin_token = await register_and_login(client, "ord_admin@example.com")
    await make_admin("ord_admin@example.com")
    admin_token = await register_and_login(client, "ord_admin@example.com")

    await client.post("/admin/categories", json={"name": "OrdCat", "slug": "ordcat"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    seller_token = await register_and_login(client, "ord_seller@example.com")
    await make_seller("ord_seller@example.com")
    seller_token = await register_and_login(client, "ord_seller@example.com")

    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Order Test", "status": "active", "escrow_days": 2,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    instant_variant = await client.post(f"/seller/products/{product_id}/variants", json={
        "name": "Instant Var", "price": 1000, "delivery_mode": "instant",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    instant_variant_id = instant_variant.json()["id"]

    manual_variant = await client.post(f"/seller/products/{product_id}/variants", json={
        "name": "Manual Var", "price": 5000, "delivery_mode": "manual", "sla_hours": 24,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    manual_variant_id = manual_variant.json()["id"]

    await client.post(f"/seller/variants/{instant_variant_id}/resources", json={
        "items": ["uid1|pass1", "uid2|pass2", "uid3|pass3"],
    }, headers={"Authorization": f"Bearer {seller_token}"})

    buyer_token = await register_and_login(client, "ord_buyer@example.com")
    buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    buyer_id = buyer_me.json()["id"]

    await client.post("/wallet/topup", json={"account_id": buyer_id, "amount": 100000},
                      headers={"Authorization": f"Bearer {admin_token}"})

    return buyer_token, seller_token, admin_token, instant_variant_id, manual_variant_id


@pytest.mark.asyncio
async def test_instant_purchase(client):
    buyer_token, _, _, instant_vid, _ = await setup_buyable_product(client)
    resp = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 2},
                             headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "delivered"
    assert data["total_amount"] == 2000
    assert data["delivered_data"] is not None


@pytest.mark.asyncio
async def test_instant_purchase_insufficient_credit(client):
    buyer_token = await register_and_login(client, "ord_broke@example.com")

    admin_token = await register_and_login(client, "ord_admin2@example.com")
    await make_admin("ord_admin2@example.com")
    admin_token = await register_and_login(client, "ord_admin2@example.com")
    await client.post("/admin/categories", json={"name": "OrdCat2", "slug": "ordcat2"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    seller_token = await register_and_login(client, "ord_seller2@example.com")
    await make_seller("ord_seller2@example.com")
    seller_token = await register_and_login(client, "ord_seller2@example.com")

    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Expensive", "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    variant = await client.post(f"/seller/products/{product.json()['id']}/variants", json={
        "name": "Pricey", "price": 999999, "delivery_mode": "instant",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    await client.post(f"/seller/variants/{variant.json()['id']}/resources", json={
        "items": ["data1"],
    }, headers={"Authorization": f"Bearer {seller_token}"})

    resp = await client.post("/orders", json={"variant_id": variant.json()["id"], "quantity": 1},
                             headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 402


@pytest.mark.asyncio
async def test_manual_order_flow(client):
    buyer_token, seller_token, _, _, manual_vid = await setup_buyable_product(client)

    order = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    assert order.status_code == 201
    assert order.json()["status"] == "pending"
    order_id = order.json()["id"]

    accept = await client.post(f"/seller/orders/{order_id}/accept",
                               headers={"Authorization": f"Bearer {seller_token}"})
    assert accept.status_code == 200
    assert accept.json()["status"] == "processing"

    deliver = await client.post(f"/seller/orders/{order_id}/deliver",
                                json={"data": "custom_uid|custom_pass"},
                                headers={"Authorization": f"Bearer {seller_token}"})
    assert deliver.status_code == 200
    assert deliver.json()["status"] == "delivered"


@pytest.mark.asyncio
async def test_buyer_list_orders(client):
    buyer_token, _, _, instant_vid, _ = await setup_buyable_product(client)
    await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1},
                      headers={"Authorization": f"Bearer {buyer_token}"})
    resp = await client.get("/orders", headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


# ---------------------------------------------------------------------------
# New adapter-based flow tests
# ---------------------------------------------------------------------------

async def setup_adapter_product(client):
    """Create admin, seller with product linked to a mock provider + pricing config, buyer with credit."""
    admin_token = await register_and_login(client, "adp_admin@example.com")
    await make_admin("adp_admin@example.com")
    admin_token = await register_and_login(client, "adp_admin@example.com")

    # Create category
    await client.post("/admin/categories", json={"name": "AdpCat", "slug": "adpcat"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    # Create provider (mock adapter)
    provider_resp = await client.post("/admin/providers", json={
        "name": "Test Mock Provider", "type": "proxy", "config": {},
        "priority": 1,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert provider_resp.status_code == 201, provider_resp.text
    provider_id = provider_resp.json()["id"]

    # Ensure adapter_type is 'mock' (should be default)
    async with SessionLocal() as db:
        await db.execute(
            update(Provider).where(Provider.id == provider_id).values(adapter_type="mock")
        )
        await db.commit()

    # Create seller + product with service_type and provider_id
    seller_token = await register_and_login(client, "adp_seller@example.com")
    await make_seller("adp_seller@example.com")
    seller_token = await register_and_login(client, "adp_seller@example.com")

    product_resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Proxy Package", "status": "active",
        "escrow_days": 2, "service_type": "proxy",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert product_resp.status_code == 201, product_resp.text
    product_id = product_resp.json()["id"]

    # Link product to provider (not in the create schema, so set directly)
    async with SessionLocal() as db:
        await db.execute(
            update(Product).where(Product.id == product_id).values(provider_id=provider_id)
        )
        await db.commit()

    # Create pricing config for service_type "proxy" using config strategy
    async with SessionLocal() as db:
        pc = PricingConfig(
            service_type="proxy",
            strategy="config",
            params={
                "base_price": 10000,
                "type_mult": {"residential": 1.5, "datacenter": 1.0},
                "network_mult": {"shared": 1.0, "dedicated": 2.0},
                "duration_options": [
                    {"days": 30, "label": "1 month"},
                    {"days": 90, "label": "3 months"},
                ],
            },
            is_active=True,
        )
        db.add(pc)
        await db.commit()

    # Create buyer with credit
    buyer_token = await register_and_login(client, "adp_buyer@example.com")
    buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    buyer_id = buyer_me.json()["id"]

    await client.post("/wallet/topup", json={"account_id": buyer_id, "amount": 500000},
                      headers={"Authorization": f"Bearer {admin_token}"})

    return buyer_token, seller_token, admin_token, product_id


@pytest.mark.asyncio
async def test_adapter_order_success(client):
    """New flow: product_id + user_config -> adapter provision -> delivered."""
    buyer_token, _, _, product_id = await setup_adapter_product(client)

    resp = await client.post("/orders", json={
        "product_id": product_id,
        "user_config": {
            "type": "residential",
            "network": "shared",
            "days": 30,
            "quantity": 1,
        },
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})

    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["status"] == "delivered"
    assert data["delivered_data"] is not None
    assert data["product_id"] == product_id
    # Config pricing: 10000 * 1.5 (residential) * 1.0 (shared) * (30/30) * 1 = 15000
    assert data["total_amount"] == 15000


@pytest.mark.asyncio
async def test_adapter_order_invalid_config(client):
    """New flow with invalid user_config should return 400."""
    buyer_token, _, _, product_id = await setup_adapter_product(client)

    resp = await client.post("/orders", json={
        "product_id": product_id,
        "user_config": {
            "type": "nonexistent_type",
            "network": "shared",
            "days": 30,
            "quantity": 1,
        },
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})

    assert resp.status_code == 400
    assert "Invalid" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_schema_rejects_both_variant_and_product(client):
    """Cannot provide both variant_id and product_id."""
    buyer_token = await register_and_login(client, "adp_both@example.com")

    resp = await client.post("/orders", json={
        "variant_id": 1,
        "product_id": 1,
        "user_config": {"type": "residential", "network": "shared", "days": 30, "quantity": 1},
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_schema_rejects_neither_variant_nor_product(client):
    """Must provide variant_id or product_id."""
    buyer_token = await register_and_login(client, "adp_neither@example.com")

    resp = await client.post("/orders", json={
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_schema_rejects_product_without_config(client):
    """product_id without user_config should be rejected."""
    buyer_token = await register_and_login(client, "adp_noconf@example.com")

    resp = await client.post("/orders", json={
        "product_id": 1,
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_old_flow_still_works_after_refactor(client):
    """Regression test: variant_id flow continues to work exactly as before."""
    buyer_token, _, _, instant_vid, _ = await setup_buyable_product(client)

    resp = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1},
                             headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "delivered"
    assert data["total_amount"] == 1000
    assert data["delivered_data"] is not None
    assert data["variant_id"] == instant_vid


# ---------------------------------------------------------------------------
# Affiliate commission on order completion
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_commission_default_rate_on_completion(client):
    """Referred buyer completes order with no product/category override → default rate."""
    _, _, buyer_token, vid, affiliate_id, _ = await setup_affiliate_order(client)

    order = await client.post("/orders", json={"variant_id": vid, "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = order.json()["id"]

    confirm = await client.post(f"/orders/{order_id}/confirm",
                                headers={"Authorization": f"Bearer {buyer_token}"})
    assert confirm.status_code == 200
    assert confirm.json()["status"] == "completed"

    async with SessionLocal() as db:
        comm = await db.scalar(
            select(AffiliateCommission).where(AffiliateCommission.order_id == order_id)
        )
        assert comm is not None
        assert comm.affiliate_account_id == affiliate_id
        # default 5% of 10000 = 500
        assert comm.rate_percent == 5.0
        assert comm.amount == 500

        affiliate_wallet = await db.scalar(select(Wallet).where(Wallet.account_id == affiliate_id))
        assert affiliate_wallet.balance == 500


@pytest.mark.asyncio
async def test_commission_uses_category_rate(client):
    _, _, buyer_token, vid, affiliate_id, _ = await setup_affiliate_order(client, category_rate=10.0)

    order = await client.post("/orders", json={"variant_id": vid, "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = order.json()["id"]
    await client.post(f"/orders/{order_id}/confirm",
                      headers={"Authorization": f"Bearer {buyer_token}"})

    async with SessionLocal() as db:
        comm = await db.scalar(
            select(AffiliateCommission).where(AffiliateCommission.order_id == order_id)
        )
        assert comm is not None
        assert comm.rate_percent == 10.0
        assert comm.amount == 1000


@pytest.mark.asyncio
async def test_commission_product_rate_wins_over_category(client):
    _, _, buyer_token, vid, affiliate_id, _ = await setup_affiliate_order(
        client, product_rate=7.0, category_rate=10.0
    )

    order = await client.post("/orders", json={"variant_id": vid, "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = order.json()["id"]
    await client.post(f"/orders/{order_id}/confirm",
                      headers={"Authorization": f"Bearer {buyer_token}"})

    async with SessionLocal() as db:
        comm = await db.scalar(
            select(AffiliateCommission).where(AffiliateCommission.order_id == order_id)
        )
        assert comm is not None
        assert comm.rate_percent == 7.0
        assert comm.amount == 700


@pytest.mark.asyncio
async def test_no_commission_when_buyer_not_referred(client):
    _, _, buyer_token, vid, affiliate_id, _ = await setup_affiliate_order(client, use_referral=False)

    order = await client.post("/orders", json={"variant_id": vid, "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = order.json()["id"]
    await client.post(f"/orders/{order_id}/confirm",
                      headers={"Authorization": f"Bearer {buyer_token}"})

    async with SessionLocal() as db:
        comm = await db.scalar(
            select(AffiliateCommission).where(AffiliateCommission.order_id == order_id)
        )
        assert comm is None
        affiliate_wallet = await db.scalar(select(Wallet).where(Wallet.account_id == affiliate_id))
        assert affiliate_wallet.balance == 0


@pytest.mark.asyncio
async def test_no_commission_on_self_referral(client):
    """If buyer.referred_by_id == order.buyer_id, no commission (self-referral guard)."""
    _, _, buyer_token, vid, _, _ = await setup_affiliate_order(client, use_referral=True)

    async with SessionLocal() as db:
        buyer = await db.scalar(select(Account).where(Account.email == "aff_buyer@example.com"))
        buyer.referred_by_id = buyer.id
        await db.commit()

    order = await client.post("/orders", json={"variant_id": vid, "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = order.json()["id"]
    await client.post(f"/orders/{order_id}/confirm",
                      headers={"Authorization": f"Bearer {buyer_token}"})

    async with SessionLocal() as db:
        comm = await db.scalar(
            select(AffiliateCommission).where(AffiliateCommission.order_id == order_id)
        )
        assert comm is None


@pytest.mark.asyncio
async def test_commission_atomic_with_order_status(client):
    """Commission and order status change are in the same transaction: if the
    commission insert fails, the order status change also rolls back."""
    _, _, buyer_token, vid, affiliate_id, _ = await setup_affiliate_order(client)

    order = await client.post("/orders", json={"variant_id": vid, "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = order.json()["id"]

    from src.affiliate import service as aff_service

    original_apply = aff_service.apply_affiliate_commission
    call_count = {"n": 0}

    async def failing_apply(order, db):
        call_count["n"] += 1
        raise RuntimeError("commission failure")

    # Patch at the import site in orders.service
    import src.orders.service as orders_service_mod
    original_ref = orders_service_mod.apply_affiliate_commission if hasattr(orders_service_mod, "apply_affiliate_commission") else None

    # The import is local inside confirm_order, so patch the source module
    monkeypatch_target = aff_service
    original_func = monkeypatch_target.apply_affiliate_commission
    monkeypatch_target.apply_affiliate_commission = failing_apply

    try:
        with pytest.raises(RuntimeError):
            await client.post(f"/orders/{order_id}/confirm",
                              headers={"Authorization": f"Bearer {buyer_token}"})
    finally:
        monkeypatch_target.apply_affiliate_commission = original_func

    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status != OrderStatus.completed
        comm = await db.scalar(
            select(AffiliateCommission).where(AffiliateCommission.order_id == order_id)
        )
        assert comm is None


@pytest.mark.asyncio
async def test_no_double_credit_on_reentry(client):
    """Re-entering the completion path for an already-completed order does not double-credit."""
    _, _, buyer_token, vid, affiliate_id, _ = await setup_affiliate_order(client)

    order = await client.post("/orders", json={"variant_id": vid, "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = order.json()["id"]
    await client.post(f"/orders/{order_id}/confirm",
                      headers={"Authorization": f"Bearer {buyer_token}"})

    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        from src.affiliate.service import apply_affiliate_commission
        await apply_affiliate_commission(order, db)
        await db.commit()

        comms = list((await db.execute(
            select(AffiliateCommission).where(AffiliateCommission.order_id == order_id)
        )).scalars().all())
        assert len(comms) == 1
        affiliate_wallet = await db.scalar(select(Wallet).where(Wallet.account_id == affiliate_id))
        assert affiliate_wallet.balance == 500
