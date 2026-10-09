"""Affiliate / KOL: per-account terms, KOL promo codes, server-side
attribution window, withdrawable commission on the dashboard."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from src.affiliate.service import resolve_rate
from src.config import Settings
from src.database import SessionLocal
from src.models.account import Account
from src.models.affiliate import AffiliateAccountOverride, AffiliateClick, AffiliateCommission
from src.models.log_entry import LogEntry
from src.models.category import Category
from src.models.product import Product
from tests.conftest import make_admin, make_seller, referral, register_and_login

PASSWORD = "StrongPass123!"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ── Rate precedence (pure) ───────────────────────────────────────────────────

@pytest.mark.no_db
def test_rate_precedence():
    # Default only.
    assert resolve_rate(None, None, None, 20) == 20
    # Category, then product, override the default.
    assert resolve_rate(None, 12, None, 20) == 12
    assert resolve_rate(8, 12, None, 20) == 8
    # The referrer's own (KOL) rate wins over product/category/default.
    assert resolve_rate(8, 12, 18, 20) == 18
    assert resolve_rate(None, None, 18, 20) == 18
    # An explicit 0 on the product or category blocks everyone, KOL included.
    assert resolve_rate(0, None, 18, 20) is None
    assert resolve_rate(None, 0, 18, 20) is None
    # A KOL rate of 0 means this referrer earns nothing.
    assert resolve_rate(None, None, 0, 20) is None
    assert resolve_rate(None, None, None, 0) is None


@pytest.mark.no_db
def test_fresh_install_default_commission_is_20_percent():
    # Code default only (the suite pins the env to 5 in conftest).
    assert Settings.model_fields["default_affiliate_commission_percent"].default == 20.0


# ── Fixture: a market with a KOL ─────────────────────────────────────────────

async def _register(client, email: str, **extra) -> tuple[int, str]:
    resp = await client.post("/auth/register", json={"email": email, "password": PASSWORD, **extra})
    assert resp.status_code == 201, resp.text
    login = await client.post("/auth/login", json={"email": email, "password": PASSWORD})
    return resp.json()["id"], login.json()["access_token"]


async def _code(account_id: int) -> str:
    async with SessionLocal() as db:
        return (await db.get(Account, account_id)).affiliate_code


async def _market(client, monkeypatch):
    """Admin, a 10 % fee category with an instant 10 000 ₫ package, a KOL,
    funded affiliate budget. Programme default: 5 % of the fee, 30 earning days."""
    from src.config import settings

    monkeypatch.setattr(settings, "platform_fee_percent", 10)
    await register_and_login(client, "kol_admin@example.com")
    await make_admin("kol_admin@example.com")
    admin = await register_and_login(client, "kol_admin@example.com")
    cfg = await client.patch("/admin/affiliate-config", json={"commission_percent_of_fee": 5, "earning_days": 30},
                             headers=_auth(admin))
    assert cfg.status_code == 200, cfg.text
    await client.post("/admin/affiliate-fund/topup", json={"amount": 1_000_000}, headers=_auth(admin))
    await client.post("/admin/categories", json={"name": "KolCat", "slug": "kolcat"}, headers=_auth(admin))
    cat_id = (await client.get("/categories")).json()[-1]["id"]

    await register_and_login(client, "kol_seller@example.com")
    await make_seller("kol_seller@example.com")
    seller = await register_and_login(client, "kol_seller@example.com")
    product = await client.post("/seller/products", json={"category_id": cat_id, "title": "KolProd", "status": "active"},
                                headers=_auth(seller))
    variant = await client.post(f"/seller/products/{product.json()['id']}/variants", json={
        "name": "KolVar", "price": 10000, "delivery_mode": "instant",
    }, headers=_auth(seller))
    await client.post(f"/seller/variants/{variant.json()['id']}/resources",
                      json={"items": [f"u{i}|p{i}" for i in range(8)]}, headers=_auth(seller))
    kol_id, kol = await _register(client, "kol_youtuber@example.com")
    return {
        "admin": admin, "variant_id": variant.json()["id"], "product_id": product.json()["id"],
        "category_id": cat_id, "kol_id": kol_id, "kol": kol,
    }


async def _buyer(client, admin: str, email: str, **extra) -> tuple[int, str]:
    buyer_id, token = await _register(client, email, **extra)
    await client.post("/wallet/topup", json={"reason": "test", "account_id": buyer_id, "amount": 100_000},
                      headers=_auth(admin))
    return buyer_id, token


async def _buy(client, token: str, variant_id: int, promo_code: str | None = None) -> dict:
    body = {"variant_id": variant_id, "quantity": 1}
    if promo_code:
        body["promo_code"] = promo_code
    resp = await client.post("/orders", json=body, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _confirm(client, token: str, order_id: int) -> None:
    resp = await client.post(f"/orders/{order_id}/confirm", headers=_auth(token))
    assert resp.status_code == 200, resp.text


async def _commission_of(order_id: int) -> AffiliateCommission | None:
    async with SessionLocal() as db:
        return await db.scalar(select(AffiliateCommission).where(AffiliateCommission.order_id == order_id))


# ── D20: attribution window enforced by the backend ──────────────────────────

async def _referred_by(email: str) -> int | None:
    async with SessionLocal() as db:
        return await db.scalar(select(Account.referred_by_id).where(Account.email == email))


@pytest.mark.asyncio
async def test_signup_without_click_evidence_is_not_attributed(client):
    ref_id, _ = await _register(client, "win_ref1@example.com")
    code = await _code(ref_id)
    await _register(client, "win_kid1@example.com", referral_code=code)
    assert await _referred_by("win_kid1@example.com") is None


@pytest.mark.asyncio
async def test_signup_attributed_from_recorded_click_inside_window(client):
    ref_id, _ = await _register(client, "win_ref2@example.com")
    code = await _code(ref_id)
    assert (await client.post("/affiliate/click", json={"code": code, "visitor_id": "vid-ok"})).status_code == 204
    # A forged, stale landing time does not matter: the server's click wins.
    stale = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
    await _register(client, "win_kid2@example.com", referral_code=code,
                    referral_visitor_id="vid-ok", referral_clicked_at=stale)
    assert await _referred_by("win_kid2@example.com") == ref_id
    async with SessionLocal() as db:
        kid = await db.scalar(select(Account).where(Account.email == "win_kid2@example.com"))
        assert kid.referred_at is not None and kid.referred_via_promotion_id is None


@pytest.mark.asyncio
async def test_signup_refused_when_recorded_click_is_older_than_window(client):
    ref_id, _ = await _register(client, "win_ref3@example.com")
    code = await _code(ref_id)
    await client.post("/affiliate/click", json={"code": code, "visitor_id": "vid-old"})
    async with SessionLocal() as db:
        # Default window is 30 days (+1 day click-dedup slack).
        await db.execute(update(AffiliateClick).values(created_at=datetime.now(timezone.utc) - timedelta(days=32)))
        await db.commit()
    fresh = datetime.now(timezone.utc).isoformat()
    await _register(client, "win_kid3@example.com", referral_code=code,
                    referral_visitor_id="vid-old", referral_clicked_at=fresh)
    assert await _referred_by("win_kid3@example.com") is None


@pytest.mark.asyncio
async def test_signup_falls_back_to_landing_time_when_no_click_was_recorded(client):
    ref_id, _ = await _register(client, "win_ref4@example.com")
    code = await _code(ref_id)
    stale = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
    await _register(client, "win_kid4a@example.com", referral_code=code,
                    referral_visitor_id="never-clicked", referral_clicked_at=stale)
    assert await _referred_by("win_kid4a@example.com") is None
    recent = (datetime.now(timezone.utc) - timedelta(days=29)).isoformat()
    await _register(client, "win_kid4b@example.com", referral_code=code,
                    referral_visitor_id="never-clicked", referral_clicked_at=recent)
    assert await _referred_by("win_kid4b@example.com") == ref_id


@pytest.mark.asyncio
async def test_signup_window_follows_admin_attribution_days(client):
    await register_and_login(client, "win_admin@example.com")
    await make_admin("win_admin@example.com")
    admin = await register_and_login(client, "win_admin@example.com")
    assert (await client.patch("/admin/affiliate-config", json={"attribution_days": 7},
                               headers=_auth(admin))).status_code == 200
    ref_id, _ = await _register(client, "win_ref5@example.com")
    code = await _code(ref_id)
    ten_days = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    await _register(client, "win_kid5@example.com", referral_code=code, referral_clicked_at=ten_days)
    assert await _referred_by("win_kid5@example.com") is None


@pytest.mark.asyncio
async def test_register_rejects_oversized_visitor_id(client):
    resp = await client.post("/auth/register", json={
        "email": "win_bad@example.com", "password": PASSWORD, "referral_code": "ABCD1234",
        "referral_visitor_id": "x" * 65,
    })
    assert resp.status_code == 422


# ── D18: per-account terms ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_terms_endpoints_require_admin(client):
    user_id, user = await _register(client, "terms_user@example.com")
    body = {"commission_percent_of_fee": 20, "earning_days": 0}
    assert (await client.get(f"/admin/affiliates/{user_id}/terms")).status_code == 401
    assert (await client.get(f"/admin/affiliates/{user_id}/terms", headers=_auth(user))).status_code == 403
    assert (await client.put(f"/admin/affiliates/{user_id}/terms", json=body, headers=_auth(user))).status_code == 403
    async with SessionLocal() as db:
        assert await db.get(AffiliateAccountOverride, user_id) is None


@pytest.mark.asyncio
async def test_admin_sets_validates_audits_and_clears_terms(client):
    await register_and_login(client, "terms_admin@example.com")
    await make_admin("terms_admin@example.com")
    admin = await register_and_login(client, "terms_admin@example.com")
    kol_id, _ = await _register(client, "terms_kol@example.com")

    for bad in ({"commission_percent_of_fee": 150}, {"earning_days": -1}, {"earning_days": 4000}):
        resp = await client.put(f"/admin/affiliates/{kol_id}/terms", json=bad, headers=_auth(admin))
        assert resp.status_code == 422, bad
    assert (await client.put("/admin/affiliates/99999/terms", json={"earning_days": 0},
                             headers=_auth(admin))).status_code == 404

    before = (await client.get(f"/admin/affiliates/{kol_id}/terms", headers=_auth(admin))).json()
    assert before["commission_percent_of_fee"] is None and before["effective_earning_days"] == before["default_earning_days"]

    saved = await client.put(f"/admin/affiliates/{kol_id}/terms", json={
        "commission_percent_of_fee": 18, "earning_days": 0, "note": "YouTube MMO deal",
    }, headers=_auth(admin))
    assert saved.status_code == 200, saved.text
    data = saved.json()
    assert (data["commission_percent_of_fee"], data["earning_days"], data["note"]) == (18, 0, "YouTube MMO deal")
    assert (data["effective_commission_percent_of_fee"], data["effective_earning_days"]) == (18, 0)

    listed = (await client.get("/admin/affiliates?custom_only=true", headers=_auth(admin))).json()
    assert [r["id"] for r in listed["items"]] == [kol_id]
    assert (listed["items"][0]["custom_percent"], listed["items"][0]["custom_earning_days"]) == (18, 0)

    cleared = await client.put(f"/admin/affiliates/{kol_id}/terms", json={}, headers=_auth(admin))
    assert cleared.json()["commission_percent_of_fee"] is None
    async with SessionLocal() as db:
        assert await db.get(AffiliateAccountOverride, kol_id) is None
        rows = (await db.execute(
            select(LogEntry)
            .where(LogEntry.metadata_["event"].astext == "affiliate_account_terms_changed")
            .order_by(LogEntry.id)
        )).scalars().all()
    changes = [(r.metadata_["old"]["commission_percent_of_fee"], r.metadata_["new"]["commission_percent_of_fee"]) for r in rows]
    assert changes == [(None, 18), (18, None)]
    assert all(r.metadata_["subject_id"] == kol_id for r in rows)


@pytest.mark.asyncio
async def test_kol_rate_and_lifetime_window_apply_to_commission(client, monkeypatch):
    m = await _market(client, monkeypatch)
    code = await _code(m["kol_id"])
    buyer_id, buyer = await _buyer(client, m["admin"], "kol_buyer1@example.com", **referral(code))
    # Referred 60 days ago: outside the 30-day programme window.
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.id == buyer_id)
                         .values(referred_at=datetime.now(timezone.utc) - timedelta(days=60)))
        await db.commit()
    first = await _buy(client, buyer, m["variant_id"])
    await _confirm(client, buyer, first["id"])
    assert await _commission_of(first["id"]) is None

    # KOL deal: 20 % of the fee, lifetime.
    await client.put(f"/admin/affiliates/{m['kol_id']}/terms",
                     json={"commission_percent_of_fee": 20, "earning_days": 0}, headers=_auth(m["admin"]))
    second = await _buy(client, buyer, m["variant_id"])
    held = (await client.get("/affiliate/me", headers=_auth(m["kol"]))).json()
    assert (held["totals"]["pending_commission"], held["totals"]["pending_orders"]) == (200, 1)
    assert held["custom_terms"] == {"commission_percent_of_fee": 20, "earning_days": 0}
    await _confirm(client, buyer, second["id"])
    paid = await _commission_of(second["id"])
    assert (paid.rate_percent, paid.fee_base_amount, paid.amount) == (20, 1000, 200)

    # A product explicitly set to 0 % still blocks the KOL.
    async with SessionLocal() as db:
        await db.execute(update(Product).where(Product.id == m["product_id"]).values(commission_rate=0))
        await db.commit()
    third = await _buy(client, buyer, m["variant_id"])
    await _confirm(client, buyer, third["id"])
    assert await _commission_of(third["id"]) is None

    # A category rate (non-zero) does not lower the KOL's deal.
    async with SessionLocal() as db:
        await db.execute(update(Product).where(Product.id == m["product_id"]).values(commission_rate=None))
        await db.execute(update(Category).where(Category.id == m["category_id"]).values(commission_rate=3))
        await db.commit()
    fourth = await _buy(client, buyer, m["variant_id"])
    await _confirm(client, buyer, fourth["id"])
    assert (await _commission_of(fourth["id"])).rate_percent == 20


# ── D19: KOL promo codes ─────────────────────────────────────────────────────

async def _kol_promo(client, m, code="KOLTUBE") -> dict:
    resp = await client.post("/admin/promotions", json={
        "code": code, "name": "KOL YouTube", "discount_type": "percent", "discount_value": 10,
        "per_buyer_limit": 10, "affiliate_account_id": m["kol_id"],
    }, headers=_auth(m["admin"]))
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_promotion_affiliate_must_be_a_real_account(client, monkeypatch):
    m = await _market(client, monkeypatch)
    bad = await client.post("/admin/promotions", json={
        "code": "KOLBAD", "name": "x", "discount_type": "percent", "discount_value": 10, "affiliate_account_id": 99999,
    }, headers=_auth(m["admin"]))
    assert bad.status_code == 422 and "affiliate_account_id" in bad.json()["detail"]["fields"]
    promo = await _kol_promo(client, m)
    assert promo["affiliate_account_id"] == m["kol_id"] and promo["affiliate_email"] == "kol_youtuber@example.com"
    # Unlinking is a normal audited edit.
    unlinked = await client.patch(f"/admin/promotions/{promo['id']}", json={"affiliate_account_id": None},
                                  headers=_auth(m["admin"]))
    assert unlinked.status_code == 200 and unlinked.json()["affiliate_account_id"] is None
    async with SessionLocal() as db:
        row = await db.scalar(select(LogEntry).where(LogEntry.metadata_["event"].astext == "promotion_updated"))
    assert row.metadata_["changes"]["affiliate_account_id"] == {"old": m["kol_id"], "new": None}


@pytest.mark.asyncio
async def test_kol_code_attributes_new_buyer_and_pays_kol(client, monkeypatch):
    m = await _market(client, monkeypatch)
    promo = await _kol_promo(client, m)
    buyer_id, buyer = await _buyer(client, m["admin"], "kol_fan@example.com")

    order = await _buy(client, buyer, m["variant_id"], promo_code="koltube")
    async with SessionLocal() as db:
        fan = await db.get(Account, buyer_id)
        assert (fan.referred_by_id, fan.referred_via_promotion_id) == (m["kol_id"], promo["id"])

    me = (await client.get("/affiliate/me", headers=_auth(m["kol"]))).json()
    # 9 000 paid, 10 % fee = 900, 5 % default = 45.
    assert (me["totals"]["pending_commission"], me["totals"]["referred_orders"]) == (45, 1)
    # A code buyer is not a link sign-up.
    assert me["totals"]["signups"] == 0
    assert me["referred_users"][0]["via_code"] == "KOLTUBE"

    await _confirm(client, buyer, order["id"])
    assert (await _commission_of(order["id"])).affiliate_account_id == m["kol_id"]
    me = (await client.get("/affiliate/me", headers=_auth(m["kol"]))).json()
    assert me["promo_codes"] == [{
        "code": "KOLTUBE", "name": "KOL YouTube", "discount_type": "percent", "discount_value": 10,
        "max_discount_amount": None, "ends_at": None, "active": True, "orders": 1, "buyers": 1, "commission": 45,
    }]
    assert me["totals"]["available_commission"] == 45
    assert me["totals"]["wallet_available"] == 45
    assert me["can_withdraw"] is True and me["withdraw_source"] == "affiliate_commission"
    assert me["totals"]["withdrawable_commission"] == 45

    # Later orders without the code still earn: the buyer is now the KOL's referral.
    later = await _buy(client, buyer, m["variant_id"])
    await _confirm(client, buyer, later["id"])
    assert (await _commission_of(later["id"])).affiliate_account_id == m["kol_id"]


@pytest.mark.asyncio
async def test_kol_code_never_steals_an_existing_referral(client, monkeypatch):
    m = await _market(client, monkeypatch)
    await _kol_promo(client, m)
    other_id, other = await _register(client, "kol_other_ref@example.com")
    buyer_id, buyer = await _buyer(client, m["admin"], "kol_taken@example.com", **referral(await _code(other_id)))

    coded = await _buy(client, buyer, m["variant_id"], promo_code="KOLTUBE")
    async with SessionLocal() as db:
        assert (await db.get(Account, buyer_id)).referred_by_id == other_id
    await _confirm(client, buyer, coded["id"])
    # The order that used the KOL's code pays the KOL...
    assert (await _commission_of(coded["id"])).affiliate_account_id == m["kol_id"]
    # ...and plain orders keep paying the buyer's own referrer.
    plain = await _buy(client, buyer, m["variant_id"])
    await _confirm(client, buyer, plain["id"])
    assert (await _commission_of(plain["id"])).affiliate_account_id == other_id

    other_me = (await client.get("/affiliate/me", headers=_auth(other))).json()
    assert other_me["totals"]["referred_orders"] == 1


@pytest.mark.asyncio
async def test_kol_cannot_use_own_code(client, monkeypatch):
    m = await _market(client, monkeypatch)
    await _kol_promo(client, m)
    await client.post("/wallet/topup", json={"reason": "test", "account_id": m["kol_id"], "amount": 100_000},
                      headers=_auth(m["admin"]))
    quote = await client.post("/orders/quote", json={"variant_id": m["variant_id"], "quantity": 1, "promo_code": "KOLTUBE"},
                              headers=_auth(m["kol"]))
    assert quote.status_code == 400 and quote.json()["error_code"] == "PROMO_OWN_CODE"
    resp = await client.post("/orders", json={"variant_id": m["variant_id"], "quantity": 1, "promo_code": "KOLTUBE"},
                             headers=_auth(m["kol"]))
    assert resp.status_code == 400 and resp.json()["error_code"] == "PROMO_OWN_CODE"
    async with SessionLocal() as db:
        assert (await db.get(Account, m["kol_id"])).referred_by_id is None


@pytest.mark.asyncio
async def test_kol_code_from_same_ip_attributes_nobody(client, monkeypatch):
    m = await _market(client, monkeypatch)
    await _kol_promo(client, m)
    buyer_id, buyer = await _buyer(client, m["admin"], "kol_alt@example.com")
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.id.in_([buyer_id, m["kol_id"]]))
                         .values(registration_ip="8.8.4.4"))  # a global address: the guard ignores private/test ranges
        await db.commit()
    order = await _buy(client, buyer, m["variant_id"], promo_code="KOLTUBE")
    async with SessionLocal() as db:
        assert (await db.get(Account, buyer_id)).referred_by_id is None
    await _confirm(client, buyer, order["id"])
    assert await _commission_of(order["id"]) is None


# ── D17: dashboard totals ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_dashboard_available_commission_excludes_clawbacks(client, monkeypatch):
    m = await _market(client, monkeypatch)
    _, buyer = await _buyer(client, m["admin"], "kol_dash@example.com", **referral(await _code(m["kol_id"])))
    kept = await _buy(client, buyer, m["variant_id"])
    await _confirm(client, buyer, kept["id"])
    clawed = await _buy(client, buyer, m["variant_id"])
    await _confirm(client, buyer, clawed["id"])
    held = await _buy(client, buyer, m["variant_id"])
    async with SessionLocal() as db:
        await db.execute(update(AffiliateCommission).where(AffiliateCommission.order_id == clawed["id"])
                         .values(clawed_back_at=datetime.now(timezone.utc)))
        await db.commit()

    totals = (await client.get("/affiliate/me", headers=_auth(m["kol"]))).json()["totals"]
    # 10 000 × 10 % fee × 5 % = 50 per settled order.
    assert totals["available_commission"] == 50
    assert totals["pending_commission"] == 50 and totals["pending_orders"] == 1
    # Settled + held orders, all from the referral.
    assert totals["referred_orders"] == 3
    assert totals["signups"] == 1
    assert held["status"] == "delivered"
