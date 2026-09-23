"""Stock content is encrypted at rest; duplicates and search use keyed digests."""
import base64
import hashlib
import importlib.util
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select, text

from src.database import SessionLocal, engine
from src.models.resource import (
    EncryptedText,
    Resource,
    resource_data_hash,
    resource_lookup_key,
    resource_search_key,
)
from src.security.crypto import FERNET_PREFIX, keyed_digest
from tests.conftest import make_admin, make_seller, register_and_login

_ROOT = Path(__file__).resolve().parents[1]
_MIGRATION = _ROOT / "alembic" / "versions" / "fx1a2b3c4d5e6_encrypt_resource_data.py"
_ROTATE = _ROOT / "scripts" / "rotate_encryption_key.py"


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seller_variant(client, email: str) -> tuple[str, int, int]:
    admin_email = f"admin_{email}"
    await register_and_login(client, admin_email)
    await make_admin(admin_email)
    admin = await register_and_login(client, admin_email)
    await client.post("/admin/categories", json={"name": f"Enc {email}", "slug": f"enc-{email.split('@')[0]}"}, headers=_auth(admin))
    await register_and_login(client, email)
    await make_seller(email)
    token = await register_and_login(client, email)
    cat_id = (await client.get("/categories")).json()[-1]["id"]
    product = await client.post("/seller/products", json={"category_id": cat_id, "title": f"Enc {email}", "status": "active"}, headers=_auth(token))
    variant = await client.post(
        f"/seller/products/{product.json()['id']}/variants",
        json={"name": "Enc", "price": 1000, "delivery_mode": "instant"}, headers=_auth(token),
    )
    seller_id = (await client.get("/me", headers=_auth(token))).json()["id"]
    return token, variant.json()["id"], seller_id


@pytest.mark.no_db
def test_encrypted_column_round_trips_and_tolerates_legacy_plaintext():
    column = EncryptedText()
    stored = column.process_bind_param("alice|Hunter2!", None)
    assert stored.startswith(FERNET_PREFIX) and "Hunter2" not in stored
    assert stored != column.process_bind_param("alice|Hunter2!", None), "ciphertext is randomised"
    assert column.process_result_value(stored, None) == "alice|Hunter2!"
    assert column.process_result_value("legacy|plain", None) == "legacy|plain"
    assert column.process_result_value(None, None) is None


@pytest.mark.no_db
def test_digests_are_keyed_not_plain_sha256():
    assert resource_data_hash("alice|pw") != hashlib.sha256(b"alice|pw").hexdigest()
    assert resource_data_hash("alice|pw\r\n") == resource_data_hash("  alice|pw")
    assert resource_lookup_key("Alice|pw|x") == resource_search_key("  alice ")
    assert resource_lookup_key("LICENSE-KEY-9901") == resource_search_key("license-key-9901")
    assert resource_lookup_key("|no-first-field") is None and resource_search_key("  ") is None
    assert resource_data_hash("x", secret="other-key") != resource_data_hash("x")


@pytest.mark.asyncio
async def test_stock_is_stored_encrypted_and_read_back_in_full(client):
    token, variant_id, _ = await _seller_variant(client, "enc_store@example.com")
    secret_line = "alice|Hunter2!secret|2FA-SEED"
    added = await client.post(f"/seller/variants/{variant_id}/resources", json={"items": [secret_line]}, headers=_auth(token))
    assert added.status_code == 201 and added.json()["count"] == 1

    async with engine.connect() as conn:
        raw_data, raw_hash, lookup = (await conn.execute(text(
            "SELECT data, data_hash, data_lookup FROM resources WHERE variant_id = :v"
        ), {"v": variant_id})).one()
    assert raw_data.startswith(FERNET_PREFIX) and "Hunter2" not in raw_data
    assert raw_hash == resource_data_hash(secret_line) != hashlib.sha256(secret_line.encode()).hexdigest()
    assert lookup == resource_search_key("ALICE")

    async with SessionLocal() as db:
        row = (await db.execute(select(Resource).where(Resource.variant_id == variant_id))).scalar_one()
    assert row.data == secret_line
    shown = await client.get(f"/seller/resources/{row.id}/data", headers=_auth(token))
    assert shown.json()["data"] == secret_line

    # Same credential again is still caught as a duplicate through the keyed digest.
    again = await client.post(f"/seller/variants/{variant_id}/resources", json={"items": [secret_line + "\r\n"]}, headers=_auth(token))
    assert again.json()["count"] == 0 and again.json()["skipped_existing"] == 1
    preview = await client.post(f"/seller/variants/{variant_id}/resources/preview", json={"items": [secret_line, "bob|x|y"]}, headers=_auth(token))
    assert preview.json()["existing_in_stock"] == 1 and preview.json()["to_add"] == 1


@pytest.mark.asyncio
async def test_search_matches_the_first_field_exactly(client):
    token, variant_id, _ = await _seller_variant(client, "enc_search@example.com")
    await client.post(f"/seller/variants/{variant_id}/resources", json={"items": ["TikTokUser01|pw|mail", "other02|pw|mail"]}, headers=_auth(token))

    async def search(term: str) -> list[str]:
        resp = await client.get(f"/seller/variants/{variant_id}/resources", params={"search": term}, headers=_auth(token))
        assert resp.status_code == 200
        return [row["data_preview"].split("|", 1)[0] for row in resp.json()]

    assert await search("tiktokuser01") == ["TikTokUser01"]
    assert await search("  TIKTOKUSER01 ") == ["TikTokUser01"]
    assert await search("TikTokUser01|pw|mail") == ["TikTokUser01"], "a whole pasted line matches too"
    assert await search("TikTok") == [], "substring search is gone: content is encrypted"
    assert await search("pw") == []


@pytest.mark.asyncio
async def test_migration_encrypts_legacy_rows_and_is_idempotent(client):
    rev = _load(_MIGRATION, "encrypt_resource_data_rev")
    _, variant_id, seller_id = await _seller_variant(client, "enc_migrate@example.com")
    legacy = [
        ("plain|pw\r\n", hashlib.sha256(b"plain|pw").hexdigest()),
        ("dup|pw", None),  # fg legacy-dup digest, filled in with the row id below
        ("salted|pw", hashlib.sha256(b"order:7:0\nsalted|pw").hexdigest()),
    ]
    async with engine.begin() as conn:
        ids = []
        for i, (data, digest) in enumerate(legacy):
            row_id = (await conn.execute(text(
                "INSERT INTO resources (variant_id, seller_id, status, data, data_hash, is_archived)"
                " VALUES (:v, :s, 'available', :d, :h, false) RETURNING id"
            ), {"v": variant_id, "s": seller_id, "d": data, "h": digest or f"placeholder-{i}"})).scalar_one()
            ids.append(row_id)
        await conn.execute(text("UPDATE resources SET data_hash = :h WHERE id = :id"), {
            "id": ids[1], "h": hashlib.sha256(f"legacy-dup:{ids[1]}\ndup|pw".encode()).hexdigest(),
        })
        encrypted, skipped = await conn.run_sync(rev.encrypt_rows)
        rows = (await conn.execute(text(
            "SELECT id, data, data_hash, data_lookup FROM resources WHERE id = ANY(:ids) ORDER BY id"
        ), {"ids": ids})).all()
        again = await conn.run_sync(rev.encrypt_rows)

    assert encrypted == 3 and skipped == 0
    assert again == (0, 3), "a re-run leaves encrypted rows alone"
    assert all(r.data.startswith(FERNET_PREFIX) for r in rows)
    assert rows[0].data_hash == resource_data_hash("plain|pw")
    assert rows[1].data_hash == keyed_digest("resource-data-hash", f"legacy-dup:{ids[1]}\ndup|pw")
    salted_old = hashlib.sha256(b"order:7:0\nsalted|pw").hexdigest()
    assert rows[2].data_hash == keyed_digest("resource-data-hash", f"legacy-salted:{salted_old}")
    assert rows[0].data_lookup == resource_search_key("plain")
    async with SessionLocal() as db:
        read = (await db.execute(select(Resource.data).where(Resource.id.in_(ids)).order_by(Resource.id))).scalars().all()
    assert read == ["plain|pw\r\n", "dup|pw", "salted|pw"]


@pytest.mark.asyncio
async def test_key_rotation_reencrypts_and_rekeys_stock(client):
    rotate = _load(_ROTATE, "rotate_encryption_key_script")
    _, variant_id, seller_id = await _seller_variant(client, "enc_rotate@example.com")
    old_secret = "previous-encryption-key-for-rotation-test"
    old_fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(old_secret.encode()).digest()))
    line = "rotated|pw|mail"
    async with engine.begin() as conn:
        row_id = (await conn.execute(text(
            "INSERT INTO resources (variant_id, seller_id, status, data, data_hash, data_lookup, is_archived)"
            " VALUES (:v, :s, 'available', :d, :h, :l, false) RETURNING id"
        ), {
            "v": variant_id, "s": seller_id, "d": old_fernet.encrypt(line.encode()).decode(),
            "h": resource_data_hash(line, secret=old_secret), "l": resource_lookup_key(line, secret=old_secret),
        })).scalar_one()

    async with SessionLocal() as db:
        stats = await rotate._rotate_resources(db, old_fernet, old_secret)
        await db.commit()
    assert stats["rotated"] >= 1 and stats["undecryptable"] == []

    async with SessionLocal() as db:
        row = await db.get(Resource, row_id)
        assert row.data == line
        assert row.data_hash == resource_data_hash(line)
        assert row.data_lookup == resource_search_key("rotated")
