"""A3.2 — one credential can only exist once on the whole marketplace."""
import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import select, text

from src.database import SessionLocal, engine
from src.models.log_entry import LogEntry
from src.models.resource import Resource, normalize_resource_data, resource_data_hash, salted_resource_hash
from tests.conftest import make_admin, make_seller, register_and_login

_REV_PATH = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "fg1a2b3c4d5e6_resource_data_hash.py"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _seller_variant(client, email: str, product_title: str) -> tuple[str, int]:
    """A seller with one instant-delivery variant; the category is created once."""
    token = await register_and_login(client, email)
    await make_seller(email)
    token = await register_and_login(client, email)
    cats = (await client.get("/categories")).json()
    if not cats:
        admin = "dedup_admin@example.com"
        await register_and_login(client, admin)
        await make_admin(admin)
        admin_token = await register_and_login(client, admin)
        await client.post("/admin/categories", json={"name": "DedupCat", "slug": "dedupcat"}, headers=_auth(admin_token))
        cats = (await client.get("/categories")).json()
    product = await client.post("/seller/products", json={"category_id": cats[-1]["id"], "title": product_title, "status": "active"}, headers=_auth(token))
    variant = await client.post(f"/seller/products/{product.json()['id']}/variants", json={"name": "Std", "price": 1000, "delivery_mode": "instant"}, headers=_auth(token))
    return token, variant.json()["id"]


@pytest.mark.no_db
def test_hash_normalises_line_endings_and_padding_only():
    assert resource_data_hash("user|pass\r\n") == resource_data_hash("  user|pass\n")
    assert resource_data_hash("user|pass") != resource_data_hash("USER|pass")
    assert resource_data_hash("a b") != resource_data_hash("a  b")
    assert normalize_resource_data("\tx\r") == "x"
    assert salted_resource_hash("x", "order:1:0") != resource_data_hash("x")


@pytest.mark.asyncio
async def test_same_item_is_rejected_across_packages_and_sellers(client):
    token_a, variant_a = await _seller_variant(client, "dedup_a@example.com", "A")
    token_b, variant_b = await _seller_variant(client, "dedup_b@example.com", "B")

    first = await client.post(f"/seller/variants/{variant_a}/resources", json={"items": ["acc1|pw", "acc2|pw"]}, headers=_auth(token_a))
    assert first.status_code == 201 and first.json()["count"] == 2

    # Another seller, another package: same key with different padding is still the same key.
    second = await client.post(f"/seller/variants/{variant_b}/resources", json={"items": ["acc1|pw\r\n", "acc3|pw"]}, headers=_auth(token_b))
    assert second.status_code == 201, second.text
    assert second.json() == {"count": 1, "skipped_duplicate": 0, "skipped_existing": 0, "skipped_market": 1}
    listed = (await client.get(f"/seller/variants/{variant_b}/resources", headers=_auth(token_b))).json()
    assert [r["data"] for r in listed] == ["acc3|pw"]

    # Editing / restocking into a value that lives elsewhere is refused the same way.
    edit = await client.patch(f"/seller/resources/{listed[0]['id']}", json={"data": "acc2|pw"}, headers=_auth(token_b))
    assert edit.status_code == 409 and edit.json()["error_code"] == "RESOURCE_DUPLICATE"
    # …while editing a row to a fresh value re-keys it.
    edit_ok = await client.patch(f"/seller/resources/{listed[0]['id']}", json={"data": "acc4|pw"}, headers=_auth(token_b))
    assert edit_ok.status_code == 200
    async with SessionLocal() as db:
        row = await db.get(Resource, listed[0]["id"])
        assert row.data_hash == resource_data_hash("acc4|pw")
        events = list((await db.execute(
            select(LogEntry).where(LogEntry.metadata_["event"].astext == "resource_duplicate_upload")
        )).scalars())
    assert len(events) == 1 and events[0].metadata_["count"] == 1


@pytest.mark.asyncio
async def test_sold_item_can_never_be_listed_again(client):
    token_a, variant_a = await _seller_variant(client, "dedup_sold_a@example.com", "A")
    token_b, variant_b = await _seller_variant(client, "dedup_sold_b@example.com", "B")
    await client.post(f"/seller/variants/{variant_a}/resources", json={"items": ["sold|key"]}, headers=_auth(token_a))
    async with SessionLocal() as db:
        row = (await db.execute(select(Resource).where(Resource.variant_id == variant_a))).scalar_one()
        row.status = "assigned"
        row.is_archived = True
        await db.commit()
    again = await client.post(f"/seller/variants/{variant_b}/resources", json={"items": ["sold|key"]}, headers=_auth(token_b))
    assert again.status_code == 201 and again.json()["count"] == 0 and again.json()["skipped_market"] == 1


@pytest.mark.asyncio
async def test_migration_backfill_matches_python_digest_and_resolves_legacy_duplicates(client):
    """Runs the migration's SQL against rows inserted without the constraint:
    the oldest copy keeps the digest, later copies are re-keyed, unsold ones archived."""
    spec = importlib.util.spec_from_file_location("resource_data_hash_rev", _REV_PATH)
    rev = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rev)

    token, variant = await _seller_variant(client, "dedup_mig@example.com", "M")
    async with SessionLocal() as db:
        seller_id = (await client.get("/me", headers=_auth(token))).json()["id"]
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE resources DROP CONSTRAINT uq_resources_data_hash"))
        try:
            for i, (data, status) in enumerate([("dup|key\r\n", "available"), ("dup|key", "available"), ("dup|key", "assigned"), ("solo|key", "available")]):
                await conn.execute(text(
                    "INSERT INTO resources (variant_id, seller_id, status, data, data_hash, created_at, is_archived)"
                    " VALUES (:v, :s, :st, :d, :h, now() + make_interval(secs => :i), false)"
                ), {"v": variant, "s": seller_id, "st": status, "d": data, "h": f"placeholder-{i}", "i": i})
            await conn.run_sync(rev.backfill_hashes)
            rekeyed, archived = await conn.run_sync(rev.resolve_duplicates)
            rows = (await conn.execute(text("SELECT data, status, data_hash, is_archived FROM resources ORDER BY id"))).all()
        finally:
            await conn.execute(text("ALTER TABLE resources ADD CONSTRAINT uq_resources_data_hash UNIQUE (data_hash)"))

    ids = [r[0] for r in rows]
    assert len(rekeyed) == 2 and len(archived) == 1
    # SQL digest == Python digest, line endings ignored.
    assert rows[0][2] == resource_data_hash("dup|key") and rows[3][2] == resource_data_hash("solo|key")
    # Later copies: unique salted digests; the unsold one archived, the sold one untouched.
    assert rows[1][2] != rows[0][2] and rows[2][2] != rows[0][2] and rows[1][2] != rows[2][2]
    assert rows[1][3] is True and rows[2][3] is False and rows[0][3] is False
    assert ids == ["dup|key\r\n", "dup|key", "dup|key", "solo|key"]
    async with SessionLocal() as db:
        note = (await db.execute(select(LogEntry).where(LogEntry.metadata_["event"].astext == "resource_dedup_migration"))).scalar_one()
    assert note.metadata_["rekeyed_count"] == 2 and note.metadata_["archived_count"] == 1
