"""Seller public identity: /sellers/{handle}-{key}, no account ids on the wire."""
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.auth_session import AuthSession
from src.models.category import Category
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.product import Product, ProductStatus
from src.models.review import Review
from tests.conftest import register_and_login, statement_log
from tests.test_orders import setup_buyable_product
from tests.test_products import _create_public_product, setup_seller_with_category
from tests.test_seller_presence import _chat

_KEY_RE = re.compile(r"^[0-9a-z]{8}$")


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _key_for(email: str) -> str:
    async with SessionLocal() as db:
        return await db.scalar(select(Account.public_key).where(Account.email == email))


async def _approve_business_name(email: str, name: str) -> None:
    async with SessionLocal() as db:
        account_id = await db.scalar(select(Account.id).where(Account.email == email))
        db.add(SellerApplication(account_id=account_id, business_name=name, status=ApplicationStatus.approved))
        await db.commit()


@pytest.mark.asyncio
async def test_seller_profile_resolves_by_key_and_legacy_id_but_never_leaks_account_id(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    await _create_public_product(client, seller_token, cat_id)
    seller_id = (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    key = await _key_for("prod_seller@example.com")
    assert _KEY_RE.match(key) and not key.isdigit()

    top = (await client.get("/sellers/top")).json()
    card = next(s for s in top if s["public_key"] == key)
    assert "account_id" not in card
    assert card["handle"] is None and card["canonical_path"] == f"/sellers/{key}"
    # The card names the category the shop sells most in; reply speed stays
    # empty until there are enough buyer chats.
    assert card["main_category"]["slug"] and card["response_time"] is None

    by_key = await client.get(f"/sellers/{key}")
    by_id = await client.get(f"/sellers/{seller_id}")
    assert by_key.status_code == 200 and by_id.status_code == 200
    assert by_key.json()["public_key"] == by_id.json()["public_key"] == key
    assert "account_id" not in by_key.json()

    assert (await client.get("/sellers/zzzzzzzz")).status_code == 404
    assert (await client.get("/sellers/not-a-ref")).status_code == 404
    buyer_token = await register_and_login(client, "plain_buyer@example.com")
    buyer_id = (await client.get("/me", headers=_auth(buyer_token))).json()["id"]
    assert (await client.get(f"/sellers/{buyer_id}")).status_code == 404


@pytest.mark.asyncio
async def test_business_name_becomes_the_url_handle(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    await _create_public_product(client, seller_token, cat_id)
    await _approve_business_name("prod_seller@example.com", "Orbit Store — Proxy & VPN!")
    key = await _key_for("prod_seller@example.com")

    profile = (await client.get(f"/sellers/{key}")).json()
    assert profile["handle"] == "orbit-store-proxy-vpn"
    assert profile["canonical_path"] == f"/sellers/orbit-store-proxy-vpn-{key}"
    assert profile["display_name"] == "Orbit Store — Proxy & VPN!"
    # Handle is decorative: a stale one still resolves (the page redirects).
    assert (await client.get(f"/sellers/old-name-{key}")).status_code == 200
    assert (await client.get(f"/sellers/orbit-store-proxy-vpn-{key}")).json()["public_key"] == key


@pytest.mark.asyncio
async def test_public_products_carry_seller_key_instead_of_seller_id(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    body = await _create_public_product(client, seller_token, cat_id)
    key = await _key_for("prod_seller@example.com")

    listed = (await client.get(f"/products?category_id={cat_id}")).json()["items"]
    row = next(p for p in listed if p["id"] == body["id"])
    assert "seller_id" not in row
    assert row["seller_key"] == key and row["seller_path"] == f"/sellers/{key}"

    detail = (await client.get(body["canonical_path"])).json()
    assert "seller_id" not in detail and detail["seller_key"] == key

    # Management payloads keep the id (the seller owns it; admin needs it).
    own = (await client.get(f"/seller/products/{body['id']}/detail", headers=_auth(seller_token))).json()
    assert own["seller_id"] == (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    assert body["seller_id"] == own["seller_id"]

    # Public seller filter takes the key (or handle-key); unknown refs are empty pages.
    assert [p["id"] for p in (await client.get(f"/products?seller={key}")).json()["items"]] == [body["id"]]
    assert (await client.get(f"/products?seller=anything-{key}")).json()["total"] == 1
    assert (await client.get("/products?seller=nope1234")).json() == {"items": [], "total": 0, "page": 1, "per_page": 50}


@pytest.mark.asyncio
async def test_chat_counterparts_are_public_keys(client):
    buyer_token, seller_token, _, _, _ = await setup_buyable_product(client)
    product = (await client.get("/seller/products", headers=_auth(seller_token))).json()["items"][-1]
    buyer_email = (await client.get("/me", headers=_auth(buyer_token))).json()["email"]
    seller_email = (await client.get("/me", headers=_auth(seller_token))).json()["email"]
    buyer_key, seller_key = await _key_for(buyer_email), await _key_for(seller_email)

    opened = await client.post(
        "/chat/inquiries",
        json={"product_id": product["id"], "initial_message": "hi", "client_message_id": str(uuid.uuid4())},
        headers=_auth(buyer_token),
    )
    assert opened.status_code == 201, opened.text
    assert opened.json()["counterpart"]["id"] == seller_key

    seller_rooms = (await client.get("/chat/conversations?perspective=seller", headers=_auth(seller_token))).json()["items"]
    room = next(r for r in seller_rooms if r["id"] == opened.json()["id"])
    assert room["counterpart"]["id"] == buyer_key
    assert room["counterpart"]["label"] == f"Khách hàng #{buyer_key}"
    detail = (await client.get(f"/chat/conversations/{room['id']}", headers=_auth(seller_token))).json()
    assert detail["counterpart"]["id"] == buyer_key


# --------------------------------------------------------------------------- statement budgets
#
# The shop page and the home-page leaderboard are public and hot. These tests
# seed a shop with every kind of signal the page aggregates (completed,
# refunded, disputed and seeded orders, hidden / seeded / 1-star reviews,
# product ratings, buyer chats, a recent sign-in) and pin both the response and
# the number of SQL statements a cold request costs.


async def _seed_busy_shop(db, category, *, tag: str, now: datetime, name: str | None = None) -> Account:
    """A seller with orders, refunds, disputes, ratings, reviews and chats."""
    seller = Account(
        email=f"busy-{tag}@example.test", password_hash="x", roles=["buyer", "seller"],
        created_at=now - timedelta(days=120),
    )
    buyer = Account(email=f"busy-buyer-{tag}@example.test", password_hash="x", roles=["buyer"])
    db.add_all([seller, buyer])
    await db.flush()
    db.add(SellerApplication(
        account_id=seller.id, business_name=name or f"Kho {tag}", description=f"Shop {tag} bio",
        status=ApplicationStatus.approved, created_at=now - timedelta(days=100),
    ))
    rated = Product(seller_id=seller.id, category_id=category.id, title=f"Rated {tag}",
                    status=ProductStatus.active, rating_avg=4.5, rating_count=4)
    other = Product(seller_id=seller.id, category_id=category.id, title=f"Other {tag}",
                    status=ProductStatus.active, rating_avg=3.0, rating_count=2)
    draft = Product(seller_id=seller.id, category_id=category.id, title=f"Draft {tag}",
                    status=ProductStatus.draft)
    db.add_all([rated, other, draft])
    await db.flush()

    def order(status, *, days_ago=5, total=100_000, refunded=0, seeded=False):
        row = Order(buyer_id=buyer.id, seller_id=seller.id, product_id=rated.id, quantity=1,
                    total_amount=total, refunded_amount=refunded, status=status, is_seeded=seeded,
                    created_at=now - timedelta(days=days_ago))
        db.add(row)
        return row

    completed = [order(OrderStatus.completed) for _ in range(11)]
    completed.append(order(OrderStatus.completed, refunded=30_000))
    order(OrderStatus.completed, days_ago=200, total=500_000)  # lifetime only
    order(OrderStatus.delivered)
    order(OrderStatus.delivered)
    disputed = order(OrderStatus.disputed)
    refunded = order(OrderStatus.refunded, refunded=100_000)
    seeded = [order(OrderStatus.completed, seeded=True) for _ in range(2)]
    order(OrderStatus.pending)
    await db.flush()
    db.add_all([
        Dispute(order_id=disputed.id, buyer_id=buyer.id, reason="dead", status=DisputeStatus.open),
        Dispute(order_id=disputed.id, buyer_id=buyer.id, reason="dead", status=DisputeStatus.resolved_reject),
        Dispute(order_id=refunded.id, buyer_id=buyer.id, reason="dead", status=DisputeStatus.resolved_refund),
    ])
    for row, rating, hidden in ((completed[0], 5, False), (completed[1], 4, False), (completed[2], 1, False),
                                (completed[3], 1, True)):
        db.add(Review(order_id=row.id, buyer_id=buyer.id, product_id=rated.id, rating=rating, is_hidden=hidden))
    db.add(Review(order_id=seeded[0].id, buyer_id=buyer.id, product_id=rated.id, rating=1, is_seeded=True))
    for minutes in (4, 8, 12):
        await _chat(db, buyer, seller, now - timedelta(days=1), timedelta(minutes=minutes))
    db.add(AuthSession(
        account_id=seller.id, family_id=uuid.uuid4(), refresh_token_hash=uuid.uuid4().hex,
        access_jti=str(uuid.uuid4()), expires_at=now + timedelta(days=7), last_used_at=now - timedelta(minutes=30),
    ))
    await db.flush()
    return seller


async def _seed_category(db) -> Category:
    category = Category(name="Busy Cat", slug="busy-cat")
    db.add(category)
    await db.flush()
    return category


async def _cold_get(client, url: str):
    """GET with every process cache empty, returning (response, statements)."""
    from src.runtime_config import clear_all_process_config_caches

    clear_all_process_config_caches()
    with statement_log() as statements:
        response = await client.get(url)
    return response, list(statements)


GOLDEN_LOGO = {"id": "logo1", "url": "/media/pub/logo.webp", "thumb_url": "/media/pub/logo.webp", "w": 64, "h": 64}
GOLDEN_BANNER = {"id": "ban1", "url": "/media/pub/banner.webp", "thumb_url": "/media/pub/banner.webp", "w": 960, "h": 240}
GOLDEN_BADGE = {"id": "badge1", "url": "/media/pub/badge.webp", "thumb_url": "/media/pub/badge.webp", "w": 32, "h": 32}


async def _seed_golden_shop(now: datetime) -> tuple[int, str, datetime]:
    """The busy shop, verified tier with a badge, an older approved name it
    must not show and a newer pending application it must ignore."""
    from src.models.seller_tier_config import SellerTierConfig
    from src.sellers.tier_config import ensure_seeded

    async with SessionLocal() as db:
        await ensure_seeded(db)
        seller = await _seed_busy_shop(db, await _seed_category(db), tag="golden", now=now, name="Kho Golden")
        seller.seller_tier = "verified"
        db.add_all([
            SellerApplication(account_id=seller.id, business_name="Kho Cũ", description="old bio",
                              status=ApplicationStatus.approved, created_at=now - timedelta(days=300)),
            SellerApplication(account_id=seller.id, business_name="Kho Mới Chờ Duyệt", description="pending",
                              status=ApplicationStatus.pending, created_at=now - timedelta(days=1)),
        ])
        latest = await db.scalar(select(SellerApplication).where(
            SellerApplication.account_id == seller.id, SellerApplication.business_name == "Kho Golden"))
        latest.logo, latest.banner = GOLDEN_LOGO, GOLDEN_BANNER
        verified = await db.scalar(select(SellerTierConfig).where(SellerTierConfig.tier == "verified"))
        verified.badge = GOLDEN_BADGE
        await db.commit()
        return seller.id, seller.public_key, seller.created_at


@pytest.mark.asyncio
async def test_busy_shop_profile_and_card_keep_their_exact_payload(client):
    """Pinned from the per-aggregate implementation before the statement
    merge: every figure below must survive any query reshaping."""
    from src.sellers.trust import Metrics, load_metrics

    now = datetime.now(timezone.utc)
    seller_id, key, member_since = await _seed_golden_shop(now)
    card = {
        "public_key": key,
        "handle": "kho-golden",
        "canonical_path": f"/sellers/kho-golden-{key}",
        "display_name": "Kho Golden",
        "business_name": "Kho Golden",
        "completed_order_count": 13,  # seeded (test) orders and pending/delivered do not count
        "rating_avg": 4.0,  # (4.5×4 + 3.0×2) / 6
        "review_count": 6,
        "seller_tier": "verified",
        "tier_badge": GOLDEN_BADGE,
        "logo": GOLDEN_LOGO,
    }

    response, _ = await _cold_get(client, f"/sellers/kho-golden-{key}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert datetime.fromisoformat(body.pop("member_since")) == member_since
    assert body == {
        **card,
        "bio": "Shop golden bio",
        "banner": GOLDEN_BANNER,
        "response_time": {"within": "15m", "rate": 100, "sample": 3},
        "active_within": "1h",
        "trust_score": 5,
        "dispute_band": "high",
        "one_star_band": "high",
    }
    # Legacy id and bare key resolve to the same payload.
    assert (await client.get(f"/sellers/{seller_id}")).json()["public_key"] == key
    assert (await client.get(f"/sellers/{key}")).json()["bio"] == "Shop golden bio"

    top, _ = await _cold_get(client, "/sellers/top")
    assert top.json() == [{
        **card,
        "response_time": {"within": "15m", "rate": 100, "sample": 3},
        "main_category": {"name": "Busy Cat", "slug": "busy-cat"},
    }]
    for payload in (body, top.json()[0]):
        assert "account_id" not in payload and "id" not in payload and "email" not in str(payload)

    async with SessionLocal() as db:
        metrics = await load_metrics(seller_id, db, window_days=90, now=now)
    assert metrics == Metrics(
        gmv_lifetime=1_670_000, orders_lifetime=13, days_selling=300,  # oldest approved application
        orders_window=16, disputes_window=2, reviews_window=3, one_star_window=1,
        gmv_window=1_170_000, completed_window=12,
    )


def _sql(statements: list[str]) -> str:
    return "\n".join(" ".join(s.split())[:160] for s in statements)


@pytest.mark.asyncio
async def test_shop_profile_statement_budget(client):
    now = datetime.now(timezone.utc)
    _, key, _ = await _seed_golden_shop(now)

    # Cold: maintenance config, the card (+bio, roles, join date), tier rules,
    # reply speed + last seen, trust config and the trust metrics.
    response, statements = await _cold_get(client, f"/sellers/kho-golden-{key}")
    assert response.status_code == 200
    assert len(statements) <= 7, _sql(statements)
    assert sum("FROM orders" in s for s in statements) == 2, _sql(statements)
    assert len(set(statements)) == len(statements), _sql(statements)

    # Warm: presence, trust bands and config come from the process caches.
    with statement_log() as statements:
        assert (await client.get(f"/sellers/kho-golden-{key}")).status_code == 200
    assert len(statements) <= 1, _sql(statements)

    # Unknown and unparseable refs: one lookup at most, none for garbage.
    with statement_log() as statements:
        assert (await client.get("/sellers/zzzzzzzz")).status_code == 404
        assert (await client.get("/sellers/not-a-ref")).status_code == 404
    assert len(statements) <= 1, _sql(statements)


@pytest.mark.asyncio
async def test_top_sellers_statements_do_not_grow_with_sellers(client):
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        from src.sellers.tier_config import ensure_seeded

        await ensure_seeded(db)
        category = await _seed_category(db)
        await _seed_busy_shop(db, category, tag="one", now=now)
        await db.commit()
    response, one_shop = await _cold_get(client, "/sellers/top")
    assert [s["display_name"] for s in response.json()] == ["Kho one"]
    assert len(one_shop) <= 6, _sql(one_shop)

    async with SessionLocal() as db:
        category = await db.scalar(select(Category))
        for tag in ("two", "three", "four", "five", "six", "seven"):
            await _seed_busy_shop(db, category, tag=tag, now=now)
        await db.commit()
    response, seven_shops = await _cold_get(client, "/sellers/top?limit=20")
    assert len(response.json()) == 7
    assert len(seven_shops) == len(one_shop), _sql(seven_shops)
