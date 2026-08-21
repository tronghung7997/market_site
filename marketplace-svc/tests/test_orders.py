import asyncio
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.account import Account
from src.models.affiliate import AffiliateCommission
from src.models.order import Order, OrderStatus
from src.models.pricing_config import PricingConfig
from src.models.product import Product
from src.models.provider import Provider
from src.models.wallet import Transaction, TransactionType, Wallet
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
async def test_negative_quantity_is_rejected_without_changing_wallet(client):
    buyer_token, _, _, instant_vid, _ = await setup_buyable_product(client)
    headers = {"Authorization": f"Bearer {buyer_token}"}
    before = (await client.get("/wallet", headers=headers)).json()["available_balance"]

    resp = await client.post(
        "/orders",
        json={"variant_id": instant_vid, "quantity": -100},
        headers=headers,
    )

    assert resp.status_code == 422
    after = (await client.get("/wallet", headers=headers)).json()["available_balance"]
    assert after == before


@pytest.mark.asyncio
async def test_concurrent_order_create_debits_wallet_once(client):
    buyer_token, _, _, instant_vid, _ = await setup_buyable_product(client)
    headers = {"Authorization": f"Bearer {buyer_token}"}
    buyer_id = (await client.get("/me", headers=headers)).json()["id"]
    async with SessionLocal() as db:
        await db.execute(
            update(Wallet)
            .where(Wallet.account_id == buyer_id)
            .values(available_balance=1_000)
        )
        await db.commit()

    responses = await asyncio.gather(*(
        client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=headers)
        for _ in range(10)
    ))

    statuses = [response.status_code for response in responses]
    assert statuses.count(201) == 1
    assert statuses.count(402) == 9
    wallet = (await client.get("/wallet", headers=headers)).json()
    assert wallet["available_balance"] == 0

    async with SessionLocal() as db:
        holds = (
            await db.scalars(
                select(Transaction).where(
                    Transaction.wallet_id == wallet["id"],
                    Transaction.type == TransactionType.purchase_hold,
                )
            )
        ).all()
        assert len(holds) == 1
        assert holds[0].amount == 1_000


@pytest.mark.asyncio
async def test_concurrent_confirm_releases_escrow_once(client):
    buyer_token, seller_token, _, instant_vid, _ = await setup_buyable_product(client)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    order = await client.post(
        "/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer_headers,
    )
    order_id = order.json()["id"]

    first, second = await asyncio.gather(
        client.post(f"/orders/{order_id}/confirm", headers=buyer_headers),
        client.post(f"/orders/{order_id}/confirm", headers=buyer_headers),
    )

    assert sorted((first.status_code, second.status_code)) == [200, 400]
    seller_wallet = (await client.get(
        "/wallet", headers={"Authorization": f"Bearer {seller_token}"},
    )).json()
    assert seller_wallet["available_balance"] == 1_000

    async with SessionLocal() as db:
        wallet_id = await db.scalar(select(Wallet.id).where(Wallet.account_id == seller_wallet["account_id"]))
        releases = (
            await db.scalars(
                select(Transaction).where(
                    Transaction.wallet_id == wallet_id,
                    Transaction.type == TransactionType.purchase_release,
                    Transaction.reference_id == f"order-{order_id}",
                )
            )
        ).all()
        assert len(releases) == 1


@pytest.mark.asyncio
async def test_seller_does_not_receive_affiliate_commission_on_own_order(client):
    buyer_token, seller_token, _, instant_vid, _ = await setup_buyable_product(client)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_headers = {"Authorization": f"Bearer {seller_token}"}
    buyer_id = (await client.get("/me", headers=buyer_headers)).json()["id"]
    seller_id = (await client.get("/me", headers=seller_headers)).json()["id"]
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.id == buyer_id).values(referred_by_id=seller_id))
        await db.commit()

    order = await client.post(
        "/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer_headers,
    )
    confirmed = await client.post(f"/orders/{order.json()['id']}/confirm", headers=buyer_headers)
    assert confirmed.status_code == 200

    async with SessionLocal() as db:
        commission = await db.scalar(
            select(AffiliateCommission).where(AffiliateCommission.order_id == order.json()["id"])
        )
        assert commission is None


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
    assert "không hợp lệ" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_order_total_matches_preview_quote(client):
    """Regression: order total must equal /calculate preview — no double quantity."""
    buyer_token, _, _, product_id = await setup_adapter_product(client)
    user_config = {"type": "residential", "network": "shared", "days": 30, "quantity": 2}

    preview = await client.post(f"/products/{product_id}/calculate",
                                json={"user_config": user_config})
    assert preview.status_code == 200

    resp = await client.post("/orders", json={
        "product_id": product_id, "user_config": user_config, "quantity": 2,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 201, resp.text
    data = resp.json()
    # 10000 * 1.5 * 1.0 * (30/30) * 2 = 30000 — KHÔNG phải 60000 (bug nhân đôi cũ)
    assert data["total_amount"] == 30000
    assert data["total_amount"] == preview.json()["amount"]
    assert data["quantity"] == 2


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
        assert affiliate_wallet.available_balance == 500


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
        assert affiliate_wallet.available_balance == 0


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
        assert affiliate_wallet.available_balance == 500


# ---------------------------------------------------------------------------
# Deferred provisioning (RealApiAdapter runs off the request path)
# ---------------------------------------------------------------------------


async def _use_real_api_provider(product_id: int) -> int:
    """Point the product's provider at RealApiAdapter, which is the only adapter
    whose provisioning is deferred."""
    async with SessionLocal() as db:
        product = await db.get(Product, product_id)
        await db.execute(
            update(Provider).where(Provider.id == product.provider_id).values(
                # scrapecreators: RealApiAdapter thuần — "topproxy" từ 2026-07-23
                # là TopProxyAdapter với contract riêng, không hợp cho các test
                # deferred-provisioning generic này.
                adapter_type="scrapecreators",
                config={"base_url": "https://api.example.com"},
            )
        )
        await db.commit()
        return product.provider_id


def _ok_provision_response():
    import httpx

    return httpx.Response(
        200, json={"success": True, "data": "proxy-credential", "resource_id": "res-9"},
        request=httpx.Request("POST", "https://api.example.com/provision"),
    )


@pytest.mark.asyncio
async def test_real_api_order_returns_pending_and_defers_provisioning(client, monkeypatch):
    buyer_token, _, _, product_id = await setup_adapter_product(client)
    await _use_real_api_provider(product_id)

    spawned: list[int] = []
    monkeypatch.setattr("src.orders.service.spawn_provision", spawned.append)

    resp = await client.post("/orders", json={
        "product_id": product_id,
        "user_config": {"type": "residential", "network": "shared", "days": 30, "quantity": 1},
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})

    assert resp.status_code == 201, resp.text
    data = resp.json()
    # Buyer is charged and the order exists, but the credential is not there yet.
    assert data["status"] == "pending"
    assert data["delivered_data"] is None
    assert spawned == [data["id"]], "provisioning must be handed off, not run inline"

    # The order is committed on its own — a rollback of the request would have lost it.
    async with SessionLocal() as db:
        order = await db.get(Order, data["id"])
        assert order is not None
        assert order.status == OrderStatus.pending
        assert order.user_config == {
            "type": "residential", "network": "shared", "days": 30, "quantity": 1,
        }


@pytest.mark.asyncio
async def test_background_provision_delivers_the_order(client, monkeypatch):
    import httpx
    from src.orders.service import provision_pending_order

    buyer_token, _, _, product_id = await setup_adapter_product(client)
    await _use_real_api_provider(product_id)
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)

    resp = await client.post("/orders", json={
        "product_id": product_id,
        "user_config": {"type": "residential", "network": "shared", "days": 30, "quantity": 1},
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = resp.json()["id"]

    monkeypatch.setattr(
        httpx.AsyncClient, "request", AsyncMock(return_value=_ok_provision_response()),
    )
    await provision_pending_order(order_id)

    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.delivered
        assert order.delivered_data == "proxy-credential"
        assert order.escrow_expires_at is not None


@pytest.mark.asyncio
async def test_background_provision_refunds_when_provider_rejects(client, monkeypatch):
    import httpx
    from src.orders.service import provision_pending_order

    buyer_token, _, _, product_id = await setup_adapter_product(client)
    await _use_real_api_provider(product_id)
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)

    resp = await client.post("/orders", json={
        "product_id": product_id,
        "user_config": {"type": "residential", "network": "shared", "days": 30, "quantity": 1},
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = resp.json()["id"]
    buyer_id = resp.json()["buyer_id"]

    async with SessionLocal() as db:
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == buyer_id))
        balance_after_charge = wallet.available_balance

    rejected = httpx.Response(
        200, json={"success": False, "error": "out of stock"},
        request=httpx.Request("POST", "https://api.example.com/provision"),
    )
    monkeypatch.setattr(httpx.AsyncClient, "request", AsyncMock(return_value=rejected))
    await provision_pending_order(order_id)

    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.cancelled
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == buyer_id))
        assert wallet.available_balance == balance_after_charge + order.total_amount


@pytest.mark.asyncio
async def test_background_provision_is_idempotent_on_a_delivered_order(client, monkeypatch):
    """Both the spawned task and the sweeper can reach the same order; the second
    run must not re-provision or touch money."""
    import httpx
    from src.orders.service import provision_pending_order

    buyer_token, _, _, product_id = await setup_adapter_product(client)
    await _use_real_api_provider(product_id)
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)

    resp = await client.post("/orders", json={
        "product_id": product_id,
        "user_config": {"type": "residential", "network": "shared", "days": 30, "quantity": 1},
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = resp.json()["id"]

    mock_request = AsyncMock(return_value=_ok_provision_response())
    monkeypatch.setattr(httpx.AsyncClient, "request", mock_request)

    await provision_pending_order(order_id)
    calls_after_first = mock_request.await_count
    await provision_pending_order(order_id)

    assert mock_request.await_count == calls_after_first, "second run must be a no-op"
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.delivered


# ---------------------------------------------------------------------------
# provision_sweep_job — the safety net for orders committed but never provisioned
# ---------------------------------------------------------------------------


async def _age_order(order_id: int, seconds: int) -> None:
    from datetime import datetime, timedelta, timezone

    async with SessionLocal() as db:
        await db.execute(
            update(Order).where(Order.id == order_id).values(
                created_at=datetime.now(timezone.utc) - timedelta(seconds=seconds)
            )
        )
        await db.commit()


async def _make_stuck_order(client, monkeypatch, age_seconds: int):
    """An order committed at `pending` whose provisioning never ran — what a
    process restart mid-provision leaves behind."""
    buyer_token, _, _, product_id = await setup_adapter_product(client)
    await _use_real_api_provider(product_id)
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)

    resp = await client.post("/orders", json={
        "product_id": product_id,
        "user_config": {"type": "residential", "network": "shared", "days": 30, "quantity": 1},
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = resp.json()["id"]
    await _age_order(order_id, age_seconds)
    return order_id, resp.json()["buyer_id"]


@pytest.mark.asyncio
async def test_sweep_retries_a_stuck_order(client, monkeypatch):
    import httpx
    from src.scheduler import provision_sweep_job

    order_id, _ = await _make_stuck_order(client, monkeypatch, age_seconds=300)
    monkeypatch.setattr(
        httpx.AsyncClient, "request", AsyncMock(return_value=_ok_provision_response()),
    )

    await provision_sweep_job()

    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.delivered
        assert order.delivered_data == "proxy-credential"


@pytest.mark.asyncio
async def test_sweep_leaves_fresh_orders_alone(client, monkeypatch):
    import httpx
    from src.scheduler import provision_sweep_job

    # Younger than PROVISION_RETRY_AFTER_SECONDS: the spawned task may still be
    # in flight, so the sweeper must not race it.
    order_id, _ = await _make_stuck_order(client, monkeypatch, age_seconds=10)
    mock_request = AsyncMock(return_value=_ok_provision_response())
    monkeypatch.setattr(httpx.AsyncClient, "request", mock_request)

    await provision_sweep_job()

    assert mock_request.await_count == 0
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.pending


@pytest.mark.asyncio
async def test_sweep_refunds_past_the_deadline(client, monkeypatch):
    import httpx
    from src.scheduler import provision_sweep_job

    order_id, buyer_id = await _make_stuck_order(client, monkeypatch, age_seconds=20 * 60)

    async with SessionLocal() as db:
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == buyer_id))
        balance_after_charge = wallet.available_balance
        order = await db.get(Order, order_id)
        amount = order.total_amount

    mock_request = AsyncMock(return_value=_ok_provision_response())
    monkeypatch.setattr(httpx.AsyncClient, "request", mock_request)

    await provision_sweep_job()

    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.cancelled
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == buyer_id))
        assert wallet.available_balance == balance_after_charge + amount
    assert mock_request.await_count == 0, "past the deadline we refund, not retry"


@pytest.mark.asyncio
async def test_sweep_ignores_variant_orders(client, monkeypatch):
    """Variant orders have no provider to call — sla_check_job owns those."""
    import httpx
    from src.scheduler import provision_sweep_job

    buyer_token, _, _, _, manual_vid = await setup_buyable_product(client)

    resp = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1},
                             headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = resp.json()["id"]
    assert resp.json()["status"] == "pending"
    await _age_order(order_id, 20 * 60)

    mock_request = AsyncMock()
    monkeypatch.setattr(httpx.AsyncClient, "request", mock_request)

    await provision_sweep_job()

    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.pending, "sweeper must not touch variant orders"
    assert mock_request.await_count == 0


@pytest.mark.asyncio
async def test_concurrent_provision_refunds_the_buyer_only_once(client, monkeypatch):
    """The spawned task and the sweeper can land on the same order. Without the
    FOR UPDATE lock both read `pending`, both call the provider, and on rejection
    both refund — paying the buyer back twice."""
    import asyncio

    import httpx
    from src.orders.service import provision_pending_order

    buyer_token, _, _, product_id = await setup_adapter_product(client)
    await _use_real_api_provider(product_id)
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)

    resp = await client.post("/orders", json={
        "product_id": product_id,
        "user_config": {"type": "residential", "network": "shared", "days": 30, "quantity": 1},
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = resp.json()["id"]
    buyer_id = resp.json()["buyer_id"]
    amount = resp.json()["total_amount"]

    async with SessionLocal() as db:
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == buyer_id))
        balance_after_charge = wallet.available_balance

    rejected = httpx.Response(
        200, json={"success": False, "error": "out of stock"},
        request=httpx.Request("POST", "https://api.example.com/provision"),
    )

    async def slow_reject(*_a, **_kw):
        # Widen the window both callers race through.
        await asyncio.sleep(0.2)
        return rejected

    monkeypatch.setattr(httpx.AsyncClient, "request", slow_reject)

    await asyncio.gather(
        provision_pending_order(order_id),
        provision_pending_order(order_id),
    )

    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.cancelled
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == buyer_id))
        assert wallet.available_balance == balance_after_charge + amount, (
            "buyer must be refunded exactly once"
        )


@pytest.mark.asyncio
async def test_spawn_provision_actually_runs_the_real_task(client, monkeypatch):
    """The other tests patch spawn_provision to stay deterministic, which leaves
    the real asyncio.create_task hand-off uncovered. This one exercises it."""
    import asyncio

    from src.adapters.base import ProvisionResult
    from src.adapters.real_api import RealApiAdapter
    from src.orders import service as order_service

    buyer_token, _, _, product_id = await setup_adapter_product(client)
    await _use_real_api_provider(product_id)
    # Patch the adapter method, not httpx.AsyncClient.request: the test client is
    # itself an httpx.AsyncClient, so patching that swallows the POST below.
    monkeypatch.setattr(
        RealApiAdapter, "provision",
        AsyncMock(return_value=ProvisionResult(
            success=True, data="proxy-credential", resource_id="res-9", metadata={},
        )),
    )

    resp = await client.post("/orders", json={
        "product_id": product_id,
        "user_config": {"type": "residential", "network": "shared", "days": 30, "quantity": 1},
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = resp.json()["id"]
    assert resp.json()["status"] == "pending"

    # Drain whatever create_order_with_adapter handed off, rather than sleeping.
    assert order_service._background_tasks, "spawn_provision must have created a task"
    await asyncio.gather(*list(order_service._background_tasks))

    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.delivered
        assert order.delivered_data == "proxy-credential"


# ---------------------------------------------------------------------------
# Lý do huỷ đơn hiển thị cho buyer (2026-07-24) — hết hàng phải nói rõ + hoàn tiền
# ---------------------------------------------------------------------------


@pytest.mark.no_db
class TestBuyerCancelReason:
    def test_out_of_stock_message_kept_and_refund_appended(self):
        from src.orders.service import _buyer_cancel_reason

        msg = _buyer_cancel_reason("Sản phẩm tạm hết hàng, vui lòng thử loại khác.")
        assert "hết hàng" in msg
        assert "hoàn về ví" in msg  # luôn trấn an đã hoàn tiền

    def test_generic_fallback_when_no_specific_message(self):
        from src.orders.service import _buyer_cancel_reason

        msg = _buyer_cancel_reason(None)
        assert "hoàn về ví" in msg
        assert "TopProxy" not in msg  # không lộ nguồn


@pytest.mark.asyncio
async def test_provision_failure_sets_cancel_reason_on_order(client, monkeypatch):
    """Đơn provision fail vì hết hàng → status cancelled + cancel_reason có
    thông báo hết hàng + đã hoàn tiền (buyer đọc được, không chỉ log admin)."""
    from src.adapters.base import ProvisionResult
    from src.adapters.mock import MockAdapter

    buyer_token, _, _, product_id = await setup_adapter_product(client)

    async def fake_provision(self, order_id, user_config):
        return ProvisionResult(
            success=False, error="TopProxy đang hết hàng loại này",
            buyer_message="Sản phẩm tạm hết hàng, vui lòng thử lại sau.",
        )

    monkeypatch.setattr(MockAdapter, "provision", fake_provision)

    resp = await client.post("/orders", json={
        "product_id": product_id,
        "user_config": {"type": "residential", "network": "shared", "days": 30, "quantity": 1},
        "quantity": 1,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "cancelled"
    assert body["cancel_reason"] and "hết hàng" in body["cancel_reason"]
    assert "hoàn về ví" in body["cancel_reason"]
