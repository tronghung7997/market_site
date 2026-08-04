"""Re-encrypt provider credentials after ENCRYPTION_KEY rotation.

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
from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.database import SessionLocal
from src.models.provider import Provider
from src.security.crypto import SENSITIVE_CONFIG_KEYS, encrypt_str, is_encrypted


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

        if invalid_ciphertexts:
            await db.rollback()
            locations = ", ".join(f"provider={pid}:{key}" for pid, key in invalid_ciphertexts)
            raise SystemExit(f"Aborted: ciphertext cannot be decrypted ({locations})")
        if apply:
            await db.commit()
        else:
            await db.rollback()

    mode = "APPLIED" if apply else "DRY RUN"
    print(
        f"{mode}: providers_changed={providers_changed} fields_rotated={fields_rotated} "
        f"plaintext_fields_encrypted={plaintext_fields_encrypted} "
        f"fields_already_current={fields_already_current}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    asyncio.run(rotate(apply=args.apply))
