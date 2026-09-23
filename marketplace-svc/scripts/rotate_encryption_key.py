"""Re-encrypt provider credentials and stock content after ENCRYPTION_KEY rotation.

Stock lines (`resources.data`) are Fernet-encrypted and their `data_hash` /
`data_lookup` are HMACs under subkeys of the same key, so every row is
re-encrypted and re-keyed in the same transaction as the providers.

Usage:
  OLD_ENCRYPTION_KEY=... uv run python scripts/rotate_encryption_key.py
  OLD_ENCRYPTION_KEY=... uv run python scripts/rotate_encryption_key.py --apply

The dry run is the default. No credential value is ever printed.
"""

import argparse
import asyncio
import base64
import hashlib
import os
from pathlib import Path
import sys

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.database import SessionLocal
from src.models.provider import Provider
from src.models.resource import HASH_PURPOSE, normalize_resource_data, resource_data_hash, resource_lookup_key
from src.security.crypto import FERNET_PREFIX, SENSITIVE_CONFIG_KEYS, encrypt_str, is_encrypted, keyed_digest

RESOURCE_BATCH = 500


def _fernet(secret: str) -> Fernet:
    key = hashlib.sha256(secret.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


async def rotate(*, apply: bool) -> None:
    old_secret = os.environ.get("OLD_ENCRYPTION_KEY")
    if not old_secret:
        raise SystemExit("OLD_ENCRYPTION_KEY is required")
    old_fernet = _fernet(old_secret)
    providers_changed = 0
    fields_rotated = 0
    fields_already_current = 0
    plaintext_fields_encrypted = 0
    invalid_ciphertexts: list[tuple[int, str]] = []

    async with SessionLocal() as db:
        providers = list((await db.execute(select(Provider).order_by(Provider.id))).scalars())
        for provider in providers:
            config = dict(provider.config or {})
            changed = False
            for key in SENSITIVE_CONFIG_KEYS:
                value = config.get(key)
                if not isinstance(value, str) or not value:
                    continue
                if is_encrypted(value):
                    fields_already_current += 1
                    continue
                try:
                    plaintext = old_fernet.decrypt(value.encode()).decode()
                except (InvalidToken, ValueError, UnicodeDecodeError):
                    if value.startswith("gAAAA"):
                        invalid_ciphertexts.append((provider.id, key))
                        continue
                    plaintext = value
                    plaintext_fields_encrypted += 1
                else:
                    fields_rotated += 1
                config[key] = encrypt_str(plaintext)
                changed = True
            if changed:
                providers_changed += 1
                provider.config = config

        resources = await _rotate_resources(db, old_fernet, old_secret)
        if resources["undecryptable"]:
            invalid_ciphertexts.extend(("resource", str(rid)) for rid in resources["undecryptable"][:20])

        if invalid_ciphertexts:
            await db.rollback()
            locations = ", ".join(
                f"resource={key}" if pid == "resource" else f"provider={pid}:{key}" for pid, key in invalid_ciphertexts
            )
            raise SystemExit(f"Aborted: ciphertext cannot be decrypted ({locations})")
        if apply:
            await db.commit()
        else:
            await db.rollback()

    mode = "APPLIED" if apply else "DRY RUN"
    print(
        f"{mode}: providers_changed={providers_changed} fields_rotated={fields_rotated} "
        f"plaintext_fields_encrypted={plaintext_fields_encrypted} "
        f"fields_already_current={fields_already_current} "
        f"resources_rotated={resources['rotated']} resources_already_current={resources['current']}"
    )


def _rekeyed_hash(row_id: int, digest: str, normalised: str, old_secret: str) -> str:
    if digest == keyed_digest(HASH_PURPOSE, normalised, secret=old_secret):
        return resource_data_hash(normalised)
    legacy_dup = f"legacy-dup:{row_id}\n{normalised}"
    if digest == keyed_digest(HASH_PURPOSE, legacy_dup, secret=old_secret):
        return keyed_digest(HASH_PURPOSE, legacy_dup)
    # Salted rows (supplier re-deliveries): the salt is not stored, so wrap the
    # old digest — still unique, and duplicates of them are allowed anyway.
    return keyed_digest(HASH_PURPOSE, f"rotated:{digest}")


async def _rotate_resources(db, old_fernet: Fernet, old_secret: str) -> dict:  # noqa: ANN001
    """Raw SQL on purpose: the ORM column would try to decrypt with the new key."""
    stats = {"rotated": 0, "current": 0, "undecryptable": []}
    cursor = 0
    while True:
        rows = (await db.execute(
            text("SELECT id, data, data_hash FROM resources WHERE id > :cursor ORDER BY id LIMIT :limit"),
            {"cursor": cursor, "limit": RESOURCE_BATCH},
        )).all()
        if not rows:
            return stats
        updates = []
        for row_id, data, digest in rows:
            if is_encrypted(data):
                stats["current"] += 1
                continue
            try:
                plain = old_fernet.decrypt(data.encode()).decode()
            except (InvalidToken, ValueError, UnicodeDecodeError):
                if data.startswith(FERNET_PREFIX):
                    stats["undecryptable"].append(row_id)
                    continue
                plain = data  # never encrypted (pre-migration row)
            normalised = normalize_resource_data(plain)
            updates.append({
                "id": row_id,
                "data": encrypt_str(plain),
                "data_hash": _rekeyed_hash(row_id, digest, normalised, old_secret),
                "data_lookup": resource_lookup_key(plain),
            })
        if updates:
            await db.execute(
                text("UPDATE resources SET data = :data, data_hash = :data_hash, data_lookup = :data_lookup WHERE id = :id"),
                updates,
            )
            stats["rotated"] += len(updates)
        cursor = rows[-1][0]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    asyncio.run(rotate(apply=args.apply))
