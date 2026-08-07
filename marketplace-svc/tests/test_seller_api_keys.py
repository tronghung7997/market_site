"""Seller API key management + signed / legacy auth integration tests."""

from __future__ import annotations

import hashlib
import hmac
import time

import pytest
from sqlalchemy import select

from src.auth.request_signing import (
    body_sha256_hex,
    calculate_signature,
    format_signature_header,
)
from src.config import settings
from src.database import SessionLocal
from src.models.seller_api_key import SellerApiKey
from src.security.crypto import encrypt_str
from tests.conftest import make_admin, make_seller, register_and_login, set_seller_tier


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _trusted_seller(client, email):
    token = await register_and_login(client, email)
    await make_seller(email)
    await set_seller_tier(email, "trusted")
    return await register_and_login(client, email)


async def _trusted_seller_with_product(client, seller_email, admin_email, buyer_email):
    """Trusted-tier seller with instant + manual variants and a funded buyer."""
    admin_token = await register_and_login(client, admin_email)
    await make_admin(admin_email)
    admin_token = await register_and_login(client, admin_email)

    cat_slug = admin_email.split("@")[0]
    await client.post(
        "/admin/categories",
        json={"name": cat_slug, "slug": cat_slug},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    seller_token = await _trusted_seller(client, seller_email)

    product = await client.post(
        "/seller/products",
        json={"category_id": cat_id, "title": "API Key Test Product", "status": "active", "escrow_days": 2},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    product_id = product.json()["id"]

    instant_variant = await client.post(
        f"/seller/products/{product_id}/variants",
        json={"name": "Instant", "price": 1000, "delivery_mode": "instant"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    instant_variant_id = instant_variant.json()["id"]

    manual_variant = await client.post(
        f"/seller/products/{product_id}/variants",
        json={"name": "Manual", "price": 5000, "delivery_mode": "manual", "sla_hours": 24},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    manual_variant_id = manual_variant.json()["id"]

    buyer_token = await register_and_login(client, buyer_email)
    buyer_id = (await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})).json()["id"]
    await client.post(
        "/wallet/topup",
        json={"account_id": buyer_id, "amount": 100000},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    created = (
        await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {seller_token}"})
    ).json()

    return seller_token, buyer_token, created, instant_variant_id, manual_variant_id


def _sign(
    *,
    method: str,
    path: str,
    api_key: str,
    api_secret: str,
    body: bytes = b"",
    timestamp: int | None = None,
    query: str = "",
) -> dict[str, str]:
    ts = int(time.time()) if timestamp is None else timestamp
    path_with_query = f"{path}?{query}" if query else path
    canonical = f"{method.upper()}\n{path_with_query}\n{ts}\n{body_sha256_hex(body)}"
    sig = calculate_signature(api_secret, canonical)
    return {
        "X-API-Key": api_key,
        "X-Timestamp": str(ts),
        "X-Signature": format_signature_header(sig),
    }


async def _insert_legacy_key(account_id: int, plaintext: str) -> SellerApiKey:
    """Mint a legacy bearer key (X-Seller-Api-Key) for migration-period tests."""
    key_hash = hashlib.sha256(plaintext.encode()).hexdigest()
    key_prefix = f"{plaintext[:12]}...{plaintext[-4:]}"
    async with SessionLocal() as db:
        row = SellerApiKey(
            account_id=account_id,
            key_hash=key_hash,
            key_prefix=key_prefix,
            key_id=None,
            signing_secret_encrypted=None,
            signing_version="v1",
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return row


# ---------------------------------------------------------------------------
# Credential management
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_api_key_requires_trusted_tier(client):
    token = await register_and_login(client, "apikey1@example.com")
    await make_seller("apikey1@example.com")
    token = await register_and_login(client, "apikey1@example.com")  # still tier "new"

    resp = await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_api_key_success_returns_secret_once(client):
    token = await _trusted_seller(client, "apikey2@example.com")

    resp = await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["api_key"].startswith("ak_live_")
    assert body["api_secret"].startswith("sk_live_")
    assert body["signing_version"] == "v1"
    assert body["key_prefix"].startswith(body["api_key"][:12])
    assert "key" not in body  # legacy field removed

    listing = await client.get("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})
    assert listing.status_code == 200
    items = listing.json()
    assert len(items) == 1
    assert "api_secret" not in items[0]
    assert "key" not in items[0]
    assert "key_hash" not in items[0]
    assert items[0]["signing_version"] == "v1"


# ---------------------------------------------------------------------------
# 12.1 Happy paths — signed
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_signed_request_authenticates_seller_orders(client):
    token = await _trusted_seller(client, "apikey3@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()

    headers = _sign(
        method="GET",
        path="/seller/orders",
        api_key=created["api_key"],
        api_secret=created["api_secret"],
    )
    resp = await client.get("/seller/orders", headers=headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_seller_orders_rejects_missing_auth(client):
    resp = await client.get("/seller/orders")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_seller_orders_jwt_still_works_without_api_key(client):
    token = await _trusted_seller(client, "apikey4@example.com")
    resp = await client.get("/seller/orders", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_signed_accept_and_deliver_manual_order(client):
    _, buyer_token, creds, _, manual_vid = await _trusted_seller_with_product(
        client, "apikey8s@example.com", "apikey8a@example.com", "apikey8b@example.com",
    )

    order = await client.post(
        "/orders",
        json={"variant_id": manual_vid, "quantity": 1},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert order.status_code == 201
    order_id = order.json()["id"]

    accept_headers = _sign(
        method="POST",
        path=f"/seller/orders/{order_id}/accept",
        api_key=creds["api_key"],
        api_secret=creds["api_secret"],
    )
    accept = await client.post(f"/seller/orders/{order_id}/accept", headers=accept_headers)
    assert accept.status_code == 200
    assert accept.json()["status"] == "processing"

    body = b'{"data":"delivered-via-signed-key"}'
    deliver_headers = _sign(
        method="POST",
        path=f"/seller/orders/{order_id}/deliver",
        api_key=creds["api_key"],
        api_secret=creds["api_secret"],
        body=body,
    )
    deliver_headers["Content-Type"] = "application/json"
    deliver = await client.post(
        f"/seller/orders/{order_id}/deliver",
        content=body,
        headers=deliver_headers,
    )
    assert deliver.status_code == 200
    assert deliver.json()["status"] == "delivered"
    assert deliver.json()["delivered_data"] == "delivered-via-signed-key"


@pytest.mark.asyncio
async def test_signed_bulk_add_resources_parses_json_body(client):
    _, _, creds, instant_vid, _ = await _trusted_seller_with_product(
        client, "apikey9s@example.com", "apikey9a@example.com", "apikey9b@example.com",
    )

    body = b'{"items":["stock1|pass1","stock2|pass2"]}'
    headers = _sign(
        method="POST",
        path=f"/seller/variants/{instant_vid}/resources",
        api_key=creds["api_key"],
        api_secret=creds["api_secret"],
        body=body,
    )
    headers["Content-Type"] = "application/json"
    resp = await client.post(
        f"/seller/variants/{instant_vid}/resources",
        content=body,
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["count"] == 2


# ---------------------------------------------------------------------------
# Revoke / ownership
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_revoked_signed_credential_is_rejected(client):
    token = await _trusted_seller(client, "apikey5@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()

    revoke_resp = await client.delete(
        f"/seller/api-keys/{created['id']}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert revoke_resp.status_code == 200
    assert revoke_resp.json()["revoked_at"] is not None

    headers = _sign(
        method="GET",
        path="/seller/orders",
        api_key=created["api_key"],
        api_secret=created["api_secret"],
    )
    resp = await client.get("/seller/orders", headers=headers)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_cannot_revoke_another_sellers_key(client):
    token_a = await _trusted_seller(client, "apikey6a@example.com")
    token_b = await _trusted_seller(client, "apikey6b@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token_a}"})).json()

    resp = await client.delete(
        f"/seller/api-keys/{created['id']}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_me_exposes_seller_tier(client):
    token = await _trusted_seller(client, "apikey7@example.com")
    resp = await client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["seller_tier"] == "trusted"


# ---------------------------------------------------------------------------
# 12.2 Missing / invalid credentials
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_missing_individual_signing_headers(client):
    token = await _trusted_seller(client, "apikey-miss@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()
    full = _sign(
        method="GET",
        path="/seller/orders",
        api_key=created["api_key"],
        api_secret=created["api_secret"],
    )

    for drop in ("X-API-Key", "X-Timestamp", "X-Signature"):
        partial = {k: v for k, v in full.items() if k != drop}
        resp = await client.get("/seller/orders", headers=partial)
        assert resp.status_code == 401, drop


@pytest.mark.asyncio
async def test_empty_signing_header_does_not_fallback_to_jwt(client):
    """Present-but-empty X-Signature must not fall through to a valid JWT."""
    token = await _trusted_seller(client, "apikey-empty-jwt@example.com")
    resp = await client.get(
        "/seller/orders",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Signature": "",
        },
    )
    assert resp.status_code == 401
    # Must not succeed as JWT; either missing-signing or confusion language.
    detail = resp.json()["detail"]
    assert "JWT" in detail or "ký request" in detail or "signing" in detail.lower() or "Chữ ký" in detail or "Thiếu" in detail


@pytest.mark.asyncio
async def test_empty_signing_header_does_not_fallback_to_legacy(client):
    """Present-but-empty X-API-Key must not fall through to a valid legacy key."""
    token = await _trusted_seller(client, "apikey-empty-legacy@example.com")
    me = (await client.get("/me", headers={"Authorization": f"Bearer {token}"})).json()
    plaintext = "sk_live_legacy_empty_header_test_aaaa"
    await _insert_legacy_key(me["id"], plaintext)

    resp = await client.get(
        "/seller/orders",
        headers={
            "X-Seller-Api-Key": plaintext,
            "X-API-Key": "",
        },
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_unknown_api_key_rejected(client):
    headers = _sign(
        method="GET",
        path="/seller/orders",
        api_key="ak_live_" + ("z" * 22),
        api_secret="sk_live_" + ("y" * 43),
    )
    resp = await client.get("/seller/orders", headers=headers)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_wrong_signing_version_rejected(client):
    token = await _trusted_seller(client, "apikey-ver@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()
    # Force unsupported version on the stored credential
    async with SessionLocal() as db:
        row = await db.get(SellerApiKey, created["id"])
        row.signing_version = "v9"
        await db.commit()

    headers = _sign(
        method="GET",
        path="/seller/orders",
        api_key=created["api_key"],
        api_secret=created["api_secret"],
    )
    resp = await client.get("/seller/orders", headers=headers)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_inactive_account_rejected(client):
    token = await _trusted_seller(client, "apikey-inactive@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()
    me = (await client.get("/me", headers={"Authorization": f"Bearer {token}"})).json()

    from src.models.account import Account
    from sqlalchemy import update

    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.id == me["id"]).values(is_active=False))
        await db.commit()

    headers = _sign(
        method="GET",
        path="/seller/orders",
        api_key=created["api_key"],
        api_secret=created["api_secret"],
    )
    resp = await client.get("/seller/orders", headers=headers)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_account_losing_seller_role_rejected(client):
    token = await _trusted_seller(client, "apikey-noseller@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()
    me = (await client.get("/me", headers={"Authorization": f"Bearer {token}"})).json()

    from src.models.account import Account
    from sqlalchemy import update

    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.id == me["id"]).values(roles=["buyer"]))
        await db.commit()

    headers = _sign(
        method="GET",
        path="/seller/orders",
        api_key=created["api_key"],
        api_secret=created["api_secret"],
    )
    resp = await client.get("/seller/orders", headers=headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_jwt_and_signing_headers_together_rejected(client):
    token = await _trusted_seller(client, "apikey-confuse@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()
    headers = _sign(
        method="GET",
        path="/seller/orders",
        api_key=created["api_key"],
        api_secret=created["api_secret"],
    )
    headers["Authorization"] = f"Bearer {token}"
    resp = await client.get("/seller/orders", headers=headers)
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# 12.3 Tampering
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tampered_body_rejected(client):
    token = await _trusted_seller(client, "apikey-tamp@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()

    original = b'{"data":"ok"}'
    headers = _sign(
        method="POST",
        path="/seller/orders/1/deliver",
        api_key=created["api_key"],
        api_secret=created["api_secret"],
        body=original,
    )
    headers["Content-Type"] = "application/json"
    # Body whitespace / content changed after signing
    resp = await client.post(
        "/seller/orders/1/deliver",
        content=b'{"data": "ok"}',
        headers=headers,
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_tampered_path_and_query_rejected(client):
    token = await _trusted_seller(client, "apikey-path@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()

    headers = _sign(
        method="GET",
        path="/seller/orders",
        api_key=created["api_key"],
        api_secret=created["api_secret"],
        query="a=1",
    )
    # Different query order / path after signing
    resp = await client.get("/seller/orders?a=2", headers=headers)
    assert resp.status_code == 401

    headers2 = _sign(
        method="GET",
        path="/seller/orders",
        api_key=created["api_key"],
        api_secret=created["api_secret"],
    )
    resp2 = await client.get("/seller/products", headers=headers2)
    assert resp2.status_code == 401


@pytest.mark.asyncio
async def test_signature_from_other_request_or_secret_rejected(client):
    token = await _trusted_seller(client, "apikey-other@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()
    other = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()

    # Sign with secret A, present key B
    headers = _sign(
        method="GET",
        path="/seller/orders",
        api_key=created["api_key"],
        api_secret=other["api_secret"],
    )
    resp = await client.get("/seller/orders", headers=headers)
    assert resp.status_code == 401

    # Reuse signature material for wrong path (sign orders, hit products)
    good = _sign(
        method="GET",
        path="/seller/orders",
        api_key=created["api_key"],
        api_secret=created["api_secret"],
    )
    resp2 = await client.get("/seller/products", headers=good)
    assert resp2.status_code == 401


# ---------------------------------------------------------------------------
# 12.4 Side effects
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_invalid_signature_does_not_mutate_order_or_last_used(client):
    seller_token, buyer_token, creds, _, manual_vid = await _trusted_seller_with_product(
        client, "apikey10s@example.com", "apikey10a@example.com", "apikey10b@example.com",
    )

    order = await client.post(
        "/orders",
        json={"variant_id": manual_vid, "quantity": 1},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    order_id = order.json()["id"]
    assert order.json()["status"] == "pending"

    bad_headers = _sign(
        method="POST",
        path=f"/seller/orders/{order_id}/accept",
        api_key=creds["api_key"],
        api_secret="sk_live_" + ("0" * 43),
    )
    resp = await client.post(f"/seller/orders/{order_id}/accept", headers=bad_headers)
    assert resp.status_code == 401

    # Order unchanged
    listing = await client.get(
        "/seller/orders",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    match = next(o for o in listing.json() if o["id"] == order_id)
    assert match["status"] == "pending"

    # last_used_at not updated on failure
    async with SessionLocal() as db:
        row = await db.get(SellerApiKey, creds["id"])
        assert row.last_used_at is None


@pytest.mark.asyncio
async def test_last_used_at_updates_on_success(client):
    token = await _trusted_seller(client, "apikey-used@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()

    headers = _sign(
        method="GET",
        path="/seller/orders",
        api_key=created["api_key"],
        api_secret=created["api_secret"],
    )
    assert (await client.get("/seller/orders", headers=headers)).status_code == 200

    async with SessionLocal() as db:
        row = await db.get(SellerApiKey, created["id"])
        assert row.last_used_at is not None


@pytest.mark.asyncio
async def test_expired_timestamp_does_not_mutate_order(client):
    _, buyer_token, creds, _, manual_vid = await _trusted_seller_with_product(
        client, "apikey11s@example.com", "apikey11a@example.com", "apikey11b@example.com",
    )
    order = await client.post(
        "/orders",
        json={"variant_id": manual_vid, "quantity": 1},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    order_id = order.json()["id"]

    old_ts = int(time.time()) - settings.api_signing_timestamp_tolerance_seconds - 10
    headers = _sign(
        method="POST",
        path=f"/seller/orders/{order_id}/accept",
        api_key=creds["api_key"],
        api_secret=creds["api_secret"],
        timestamp=old_ts,
    )
    resp = await client.post(f"/seller/orders/{order_id}/accept", headers=headers)
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Legacy migration path
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_legacy_x_seller_api_key_still_works_when_allowed(client):
    token = await _trusted_seller(client, "apikey-legacy@example.com")
    me = (await client.get("/me", headers={"Authorization": f"Bearer {token}"})).json()
    plaintext = "sk_live_legacy_test_key_aaaaaaaaaaaa"
    await _insert_legacy_key(me["id"], plaintext)

    assert settings.legacy_seller_api_key_mode == "allow"
    resp = await client.get("/seller/orders", headers={"X-Seller-Api-Key": plaintext})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_revoked_legacy_key_rejected(client):
    token = await _trusted_seller(client, "apikey-legacy2@example.com")
    me = (await client.get("/me", headers={"Authorization": f"Bearer {token}"})).json()
    plaintext = "sk_live_legacy_test_key_bbbbbbbbbbbb"
    row = await _insert_legacy_key(me["id"], plaintext)

    await client.delete(
        f"/seller/api-keys/{row.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    resp = await client.get("/seller/orders", headers={"X-Seller-Api-Key": plaintext})
    assert resp.status_code == 401
