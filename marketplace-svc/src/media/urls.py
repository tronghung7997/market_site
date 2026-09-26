"""Object keys and the URLs clients use to fetch them.

Keys are provider-neutral and never change:
``pub|prv/<purpose>/<yyyy>/<mm>/<public_id>_<variant>.webp``. The same key is
used in Postgres, R2 or MinIO, so moving between providers is a plain copy.
"""

from __future__ import annotations

import re
import secrets
from datetime import datetime

from src.config import settings

VARIANTS = ("full", "thumb")
# 16 × base32 = 80 random bits; lower-case and no "_" (it separates the variant).
_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"
PUBLIC_ID_LENGTH = 16
PUBLIC_ID_PATTERN = re.compile(rf"^[a-z2-7]{{{PUBLIC_ID_LENGTH}}}$")
_KEY_PATTERN = re.compile(
    r"^(?P<prefix>pub/[a-z_]+/\d{4}/\d{2}/(?P<public_id>[a-z2-7]{16}))_(?P<variant>full|thumb)\.webp$"
)
# Served by the Next.js app (frontend/app/media/[...key]/route.ts) while
# MEDIA_PUBLIC_BASE_URL is empty.
APP_MEDIA_PATH = "/media"


def new_public_id() -> str:
    return "".join(secrets.choice(_ID_ALPHABET) for _ in range(PUBLIC_ID_LENGTH))


def key_prefix(*, public: bool, purpose: str, public_id: str, now: datetime) -> str:
    return f"{'pub' if public else 'prv'}/{purpose}/{now:%Y}/{now:%m}/{public_id}"


def object_key(prefix: str, variant: str) -> str:
    return f"{prefix}_{variant}.webp"


def parse_public_key(key: str) -> tuple[str, str] | None:
    """``(key_prefix, variant)`` for a public object key, else None."""
    match = _KEY_PATTERN.match(key)
    return (match["prefix"], match["variant"]) if match else None


def public_url(prefix: str, variant: str) -> str:
    base = settings.media_public_base_url.rstrip("/") or APP_MEDIA_PATH
    return f"{base}/{object_key(prefix, variant)}"
