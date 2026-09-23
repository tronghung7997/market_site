"""resources: encrypt stock content at rest, keyed digests, exact-search key

Revision ID: fx1a2b3c4d5e6
Revises: fo1a2b3c4d5e6
Create Date: 2026-09-23

Stock lines (passwords, cookies, tokens, API keys) were stored verbatim and
de-duplicated by a plain sha256 that a short password could be brute-forced
back from. This migration, in batches and idempotently:

- encrypts `resources.data` with Fernet under ENCRYPTION_KEY (the ORM column
  becomes `EncryptedText`, which decrypts on read);
- re-keys `data_hash` as HMAC-SHA256 under a subkey of the same key. Rows
  keyed by the fg migration's `legacy-dup:{id}` salt are re-derived exactly;
  supplier-salted rows (whose salt index was never stored) get an HMAC of
  their old digest, which keeps them unique without exposing it;
- adds `data_lookup`, the keyed digest of the first `|` field, so sellers can
  still find a line by username / UID / licence key (exact, case-insensitive).

Rows whose content already decrypts are skipped, so a re-run is a no-op.
Counts land in log_entries as `resource_encryption_migration`.
"""
import hashlib
import json

from alembic import op
import sqlalchemy as sa
from cryptography.fernet import InvalidToken

from src.security.crypto import FERNET_PREFIX, decrypt_str, encrypt_str, keyed_digest

revision = "fx1a2b3c4d5e6"
down_revision = "fo1a2b3c4d5e6"
branch_labels = None
depends_on = None

BATCH = 500
# Pinned here on purpose: these must never drift from the values the rows were
# written with (src/models/resource.py uses the same strings).
HASH_PURPOSE = "resource-data-hash"
LOOKUP_PURPOSE = "resource-lookup"


def _normalise(data: str) -> str:
    return data.replace("\r\n", "\n").replace("\r", "\n").strip(" \t\r\n")


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _lookup(normalised: str) -> str | None:
    first = normalised.split("|", 1)[0].strip().casefold()
    return keyed_digest(LOOKUP_PURPOSE, first) if first else None


def _decrypted(value: str) -> str | None:
    if not value.startswith(FERNET_PREFIX):
        return None
    try:
        return decrypt_str(value)
    except InvalidToken:
        return None


def _rekey(row_id: int, old_hash: str, normalised: str) -> str:
    if old_hash == _sha(normalised):
        return keyed_digest(HASH_PURPOSE, normalised)
    legacy_dup = f"legacy-dup:{row_id}\n{normalised}"
    if old_hash == _sha(legacy_dup):
        return keyed_digest(HASH_PURPOSE, legacy_dup)
    return keyed_digest(HASH_PURPOSE, f"legacy-salted:{old_hash}")


def encrypt_rows(conn) -> tuple[int, int]:  # noqa: ANN001
    """Encrypt and re-key every not-yet-encrypted row. Returns (encrypted, skipped)."""
    encrypted = skipped = 0
    cursor = 0
    while True:
        rows = conn.execute(
            sa.text("SELECT id, data, data_hash FROM resources WHERE id > :cursor ORDER BY id LIMIT :limit"),
            {"cursor": cursor, "limit": BATCH},
        ).all()
        if not rows:
            break
        updates = []
        for row_id, data, old_hash in rows:
            if _decrypted(data) is not None:
                skipped += 1
                continue
            normalised = _normalise(data)
            updates.append({
                "id": row_id,
                "data": encrypt_str(data),
                "data_hash": _rekey(row_id, old_hash, normalised),
                "data_lookup": _lookup(normalised),
            })
        if updates:
            conn.execute(
                sa.text("UPDATE resources SET data = :data, data_hash = :data_hash, data_lookup = :data_lookup WHERE id = :id"),
                updates,
            )
            encrypted += len(updates)
        cursor = rows[-1][0]
    return encrypted, skipped


def upgrade() -> None:
    op.add_column("resources", sa.Column("data_lookup", sa.String(length=64), nullable=True))
    conn = op.get_bind()
    encrypted, skipped = encrypt_rows(conn)
    op.create_index("ix_resources_data_lookup", "resources", ["data_lookup"])
    conn.execute(sa.text(
        "INSERT INTO log_entries (service, level, message, metadata, created_at)"
        " VALUES ('marketplace', 'info', :message, CAST(:metadata AS json), now())"
    ), {
        "message": f"Resource encryption migration: {encrypted} rows encrypted, {skipped} already encrypted",
        "metadata": json.dumps({"event": "resource_encryption_migration", "encrypted": encrypted, "skipped": skipped}),
    })


def downgrade() -> None:
    conn = op.get_bind()
    cursor = 0
    while True:
        rows = conn.execute(
            sa.text("SELECT id, data, data_hash FROM resources WHERE id > :cursor ORDER BY id LIMIT :limit"),
            {"cursor": cursor, "limit": BATCH},
        ).all()
        if not rows:
            break
        updates = []
        for row_id, data, digest in rows:
            plain = _decrypted(data)
            if plain is None:
                continue
            normalised = _normalise(plain)
            legacy_dup = f"legacy-dup:{row_id}\n{normalised}"
            if digest == keyed_digest(HASH_PURPOSE, normalised):
                digest = _sha(normalised)
            elif digest == keyed_digest(HASH_PURPOSE, legacy_dup):
                digest = _sha(legacy_dup)
            # Supplier-salted rows keep their keyed digest: still unique, and the
            # original salt index cannot be recovered.
            updates.append({"id": row_id, "data": plain, "data_hash": digest})
        if updates:
            conn.execute(sa.text("UPDATE resources SET data = :data, data_hash = :data_hash WHERE id = :id"), updates)
        cursor = rows[-1][0]
    op.drop_index("ix_resources_data_lookup", table_name="resources")
    op.drop_column("resources", "data_lookup")
