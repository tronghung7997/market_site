"""Trust-seed console + the shared AI seam.

The AI adapter is the deterministic mock (selected because
DEPLOYMENT_ENVIRONMENT=test), so nothing here touches a vendor or needs a key.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, update

from src.database import SessionLocal
from src.models.account import Account
from src.models.ai_config import AiProviderConfig
from src.models.category import Category
from src.models.order import Order
from src.models.product import Product, ProductStatus, ProductVariant
from src.models.review import Review
from src.models.wallet import Transaction
from tests.conftest import make_admin, make_seller, register_and_login


async def _enable_ai():
    """Turn the kill-switch on with a dummy key; the mock adapter ignores it."""
    async with SessionLocal() as db:
        row = await db.get(AiProviderConfig, 1)
        if row is None:
            from src.ai.service import ensure_seeded
            row = await ensure_seeded(db)
        row.is_enabled = True
        from src.security.crypto import encrypt_str
        row.api_key_encrypted = encrypt_str("test-key")
        await db.commit()


async def _make_product(seller_email: str) -> tuple[int, int]:
    """Active product with one variant. Returns (product_id, seller_id)."""
    async with SessionLocal() as db:
        seller_id = await db.scalar(select(Account.id).where(Account.email == seller_email))
        category = Category(name="Tài khoản", slug=f"tk-{uuid.uuid4().hex[:6]}")
        db.add(category)
        await db.flush()
        product = Product(
            seller_id=seller_id, category_id=category.id,
            title="Via Facebook cổ 2015-2018",
            description="Via đã xác minh email và số điện thoại",
            service_type="account", status=ProductStatus.active,
            escrow_days=2, specs={"tuoi_acc": "2015-2018", "limit": "250k/ngay"},
            features=["Đã xác minh email", "Limit 250k"],
            warranty_text="Bảo hành 24h checkpoint",
        )
        db.add(product)
        await db.flush()
        db.add(ProductVariant(
            product_id=product.id, name="Via 2015", price=180_000, is_active=True,
        ))
        await db.commit()
        return product.id, seller_id


@pytest.fixture
async def admin_token(client):
    email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    token = await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


@pytest.fixture
async def seeded_product(client):
    email = f"seller-{uuid.uuid4().hex[:8]}@example.com"
    await register_and_login(client, email)
    await make_seller(email)
    product_id, seller_id = await _make_product(email)
    return product_id, seller_id


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ── Authorization ───────────────────────────────────────────────────────────

async def test_trust_seed_endpoints_reject_non_admin(client, seeded_product):
    product_id, _ = seeded_product
    buyer_email = f"buyer-{uuid.uuid4().hex[:8]}@example.com"
    token = await register_and_login(client, buyer_email)

    generate = await client.post(
        "/admin/trust-seed/generate",
        json={"product_id": product_id, "count": 3}, headers=_auth(token),
    )
    assert generate.status_code == 403

    listing = await client.get("/admin/trust-seed/batches", headers=_auth(token))
    assert listing.status_code == 403

    config = await client.get("/admin/ai/config", headers=_auth(token))
    assert config.status_code == 403


async def test_trust_seed_endpoints_reject_anonymous(client, seeded_product):
    product_id, _ = seeded_product
    resp = await client.post("/admin/trust-seed/generate", json={"product_id": product_id, "count": 3})
    assert resp.status_code in (401, 403)


# ── AI config ───────────────────────────────────────────────────────────────

async def test_ai_config_never_returns_the_api_key(client, admin_token):
    await client.patch(
        "/admin/ai/config",
        json={"api_key": "super-secret-key-value", "is_enabled": True},
        headers=_auth(admin_token),
    )
    resp = await client.get("/admin/ai/config", headers=_auth(admin_token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["api_key_configured"] is True
    assert "api_key" not in body
    assert "super-secret-key-value" not in resp.text


async def test_ai_config_rejects_non_http_base_url(client, admin_token):
    resp = await client.patch(
        "/admin/ai/config", json={"base_url": "ftp://evil.example"}, headers=_auth(admin_token),
    )
    assert resp.status_code == 422


async def test_ai_generation_blocked_while_disabled(client, admin_token, seeded_product):
    product_id, _ = seeded_product
    await client.patch("/admin/ai/config", json={"is_enabled": False}, headers=_auth(admin_token))
    resp = await client.post(
        "/admin/trust-seed/generate",
        json={"product_id": product_id, "count": 3}, headers=_auth(admin_token),
    )
    assert resp.status_code == 409


# ── Generate ────────────────────────────────────────────────────────────────

async def test_generate_returns_drafts_without_writing_anything(client, admin_token, seeded_product):
    product_id, _ = seeded_product
    await _enable_ai()

    resp = await client.post(
        "/admin/trust-seed/generate",
        json={"product_id": product_id, "count": 5}, headers=_auth(admin_token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["drafts"]) == 5
    # Product facts must reach the prompt, otherwise the copy is generic.
    assert "Via Facebook" in body["product_context"]
    assert "2015-2018" in body["product_context"]

    async with SessionLocal() as db:
        assert await db.scalar(select(func.count(Review.id))) == 0
        assert await db.scalar(select(func.count(Order.id))) == 0


async def test_default_distribution_keeps_a_low_star_tail(client, admin_token, seeded_product):
    """A wall of 5-star reviews is the obvious tell; the default mix must not
    produce one."""
    from src.trust_seed.service import resolve_distribution

    counts = resolve_distribution(20, None)
    assert sum(counts.values()) == 20
    assert counts[5] < 20
    assert sum(n for star, n in counts.items() if star <= 4) > 0


# ── Apply ───────────────────────────────────────────────────────────────────

async def test_apply_writes_seeded_rows_and_moves_no_money(client, admin_token, seeded_product):
    product_id, seller_id = seeded_product
    await _enable_ai()

    now = datetime.now(timezone.utc)
    resp = await client.post(
        "/admin/trust-seed/apply",
        json={
            "product_id": product_id,
            "items": [
                {"rating": 5, "comment": "acc ngon, log phat vao luon"},
                {"rating": 4, "comment": "dung on nhung giao hoi cham"},
            ],
            "date_from": (now - timedelta(days=30)).isoformat(),
            "date_to": now.isoformat(),
        },
        headers=_auth(admin_token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["review_count"] == 2

    async with SessionLocal() as db:
        reviews = list((await db.execute(select(Review))).scalars())
        assert len(reviews) == 2
        assert all(r.is_seeded for r in reviews)
        assert all(r.trust_seed_batch_id is not None for r in reviews)

        orders = list((await db.execute(select(Order))).scalars())
        assert len(orders) == 2
        assert all(o.is_seeded for o in orders)

        # The whole safety argument: no wallet movement of any kind.
        assert await db.scalar(select(func.count(Transaction.id))) == 0

        buyers = list((await db.execute(
            select(Account).where(Account.id.in_([o.buyer_id for o in orders]))
        )).scalars())
        assert all(b.is_seeded for b in buyers)
        assert all(b.is_active is False for b in buyers)
        assert all(b.email.endswith("@seed.invalid") for b in buyers)

        product = await db.get(Product, product_id)
        assert product.rating_count == 2
        assert product.rating_avg == pytest.approx(4.5)


async def test_apply_rejects_off_platform_contact_details(client, admin_token, seeded_product):
    """Server-side enforcement: the console shows violations, but the rule is
    not allowed to live only in the browser."""
    product_id, _ = seeded_product
    await _enable_ai()
    now = datetime.now(timezone.utc)

    for bad in ("lien he zalo 0987654321 de mua re hon",
                "add telegram @shopmmo nhe",
                "ghe web shopmmo.com mua re hon"):
        resp = await client.post(
            "/admin/trust-seed/apply",
            json={
                "product_id": product_id,
                "items": [{"rating": 5, "comment": bad}],
                "date_from": (now - timedelta(days=5)).isoformat(),
                "date_to": now.isoformat(),
            },
            headers=_auth(admin_token),
        )
        assert resp.status_code == 400, f"accepted banned content: {bad}"

    async with SessionLocal() as db:
        assert await db.scalar(select(func.count(Review.id))) == 0


async def test_policy_catches_separator_obfuscated_channels():
    from src.trust_seed.policy import find_violations

    assert find_violations("nhan tin z.a.l.o nhe")
    assert find_violations("t-e-l-e-g-r-a-m cua shop")
    assert find_violations("goi 0987 654 321")
    assert find_violations("mail: shop@gmail.com")
    assert find_violations("acc dung ngon, log phat an ngay") == []


async def test_apply_rejects_future_and_inverted_date_windows(client, admin_token, seeded_product):
    product_id, _ = seeded_product
    await _enable_ai()
    now = datetime.now(timezone.utc)

    resp = await client.post(
        "/admin/trust-seed/apply",
        json={
            "product_id": product_id,
            "items": [{"rating": 5, "comment": "ok lam"}],
            "date_from": now.isoformat(),
            "date_to": (now - timedelta(days=5)).isoformat(),
        },
        headers=_auth(admin_token),
    )
    assert resp.status_code == 400


# ── Purge ───────────────────────────────────────────────────────────────────

async def test_purge_removes_reviews_orders_and_restores_rating(client, admin_token, seeded_product):
    product_id, _ = seeded_product
    await _enable_ai()
    now = datetime.now(timezone.utc)

    applied = await client.post(
        "/admin/trust-seed/apply",
        json={
            "product_id": product_id,
            "items": [
                {"rating": 5, "comment": "ngon"},
                {"rating": 5, "comment": "hang chuan"},
                {"rating": 4, "comment": "on ap"},
            ],
            "date_from": (now - timedelta(days=20)).isoformat(),
            "date_to": now.isoformat(),
        },
        headers=_auth(admin_token),
    )
    batch_id = applied.json()["batch_id"]

    resp = await client.delete(f"/admin/trust-seed/batches/{batch_id}", headers=_auth(admin_token))
    assert resp.status_code == 200
    assert resp.json()["removed_reviews"] == 3

    async with SessionLocal() as db:
        assert await db.scalar(select(func.count(Review.id))) == 0
        assert await db.scalar(select(func.count(Order.id))) == 0
        product = await db.get(Product, product_id)
        assert product.rating_count == 0
        assert product.rating_avg is None
        assert product.sold_count == 0

    # Second purge is a conflict, not a silent success.
    again = await client.delete(f"/admin/trust-seed/batches/{batch_id}", headers=_auth(admin_token))
    assert again.status_code == 409


async def test_purge_leaves_real_reviews_untouched(client, admin_token, seeded_product):
    """A batch purge must never reach a genuine buyer's review."""
    product_id, seller_id = seeded_product
    await _enable_ai()
    now = datetime.now(timezone.utc)

    async with SessionLocal() as db:
        buyer = Account(email=f"real-{uuid.uuid4().hex[:8]}@example.com", password_hash="x")
        db.add(buyer)
        await db.flush()
        variant_id = await db.scalar(
            select(ProductVariant.id).where(ProductVariant.product_id == product_id)
        )
        real_order = Order(
            buyer_id=buyer.id, seller_id=seller_id, variant_id=variant_id,
            product_id=product_id, quantity=1, total_amount=180_000,
            status="completed",
        )
        db.add(real_order)
        await db.flush()
        db.add(Review(
            order_id=real_order.id, buyer_id=buyer.id, product_id=product_id,
            rating=3, comment="hang binh thuong",
        ))
        await db.commit()

    applied = await client.post(
        "/admin/trust-seed/apply",
        json={
            "product_id": product_id,
            "items": [{"rating": 5, "comment": "ngon"}],
            "date_from": (now - timedelta(days=10)).isoformat(),
            "date_to": now.isoformat(),
        },
        headers=_auth(admin_token),
    )
    batch_id = applied.json()["batch_id"]
    await client.delete(f"/admin/trust-seed/batches/{batch_id}", headers=_auth(admin_token))

    async with SessionLocal() as db:
        remaining = list((await db.execute(select(Review))).scalars())
        assert len(remaining) == 1
        assert remaining[0].is_seeded is False
        assert remaining[0].comment == "hang binh thuong"
        assert await db.scalar(select(func.count(Order.id))) == 1


# ── Isolation from reporting ────────────────────────────────────────────────

async def test_seeded_volume_stays_out_of_seller_revenue(client, admin_token, seeded_product):
    product_id, seller_id = seeded_product
    await _enable_ai()
    now = datetime.now(timezone.utc)

    await client.post(
        "/admin/trust-seed/apply",
        json={
            "product_id": product_id,
            "items": [{"rating": 5, "comment": "ngon"} for _ in range(4)],
            "date_from": (now - timedelta(days=10)).isoformat(),
            "date_to": now.isoformat(),
        },
        headers=_auth(admin_token),
    )

    async with SessionLocal() as db:
        from src.products.service import get_seller_stats
        stats = await get_seller_stats(seller_id, db)

    assert stats["total_orders"] == 0
    assert stats["total_revenue"] == 0


async def test_seeded_accounts_hidden_from_admin_account_list(client, admin_token, seeded_product):
    product_id, _ = seeded_product
    await _enable_ai()
    now = datetime.now(timezone.utc)

    await client.post(
        "/admin/trust-seed/apply",
        json={
            "product_id": product_id,
            "items": [{"rating": 5, "comment": "ngon"} for _ in range(3)],
            "date_from": (now - timedelta(days=10)).isoformat(),
            "date_to": now.isoformat(),
        },
        headers=_auth(admin_token),
    )

    resp = await client.get("/admin/accounts?per_page=100", headers=_auth(admin_token))
    assert resp.status_code == 200
    emails = [item["email"] for item in resp.json()["items"]]
    assert not any(e.endswith("@seed.invalid") for e in emails)


async def test_seeded_reviews_are_visible_on_the_storefront(client, admin_token, seeded_product):
    """Seeded reviews must show publicly — that is the entire purpose — while
    the reviewer stays masked like any other buyer."""
    product_id, _ = seeded_product
    await _enable_ai()
    now = datetime.now(timezone.utc)

    await client.post(
        "/admin/trust-seed/apply",
        json={
            "product_id": product_id,
            "items": [{"rating": 5, "comment": "acc dung ngon"}],
            "date_from": (now - timedelta(days=3)).isoformat(),
            "date_to": now.isoformat(),
        },
        headers=_auth(admin_token),
    )

    resp = await client.get(f"/products/{product_id}/reviews")
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["counts"]["5"] == 1 or body["summary"]["counts"][5] == 1
    assert body["items"][0]["comment"] == "acc dung ngon"
    assert "seed.invalid" not in resp.text
    assert "***" in body["items"][0]["reviewer_label"]


async def test_summary_reports_seeded_versus_real_share(client, admin_token, seeded_product):
    product_id, _ = seeded_product
    await _enable_ai()
    now = datetime.now(timezone.utc)

    await client.post(
        "/admin/trust-seed/apply",
        json={
            "product_id": product_id,
            "items": [{"rating": 5, "comment": "ngon"} for _ in range(2)],
            "date_from": (now - timedelta(days=10)).isoformat(),
            "date_to": now.isoformat(),
        },
        headers=_auth(admin_token),
    )

    resp = await client.get(
        f"/admin/trust-seed/products/{product_id}/summary", headers=_auth(admin_token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["seeded_reviews"] == 2
    assert body["real_reviews"] == 0
    assert body["seed_pool_size"] >= 1
