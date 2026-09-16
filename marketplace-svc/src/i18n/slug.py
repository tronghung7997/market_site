"""Public identifiers for catalog URLs: readable slug + opaque base36 key.

URL shape is ``/products/{slug}-{public_key}``. Only the key is used for
lookup; the slug is decorative and may change (title edit, seller override)
without breaking old links, because the page can redirect to the canonical
path once the key resolves.

Sequential integer ids stay internal. They are still accepted on the read
path for legacy links (``/products/123``) so bookmarks, chat history and
already-indexed pages keep working.
"""

from __future__ import annotations

import re
import secrets
import unicodedata

PUBLIC_KEY_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
PUBLIC_KEY_LENGTH = 8
SLUG_MAX_LENGTH = 140
SLUG_FALLBACK = "product"
# One segment of lowercase alphanumerics joined by single dashes.
SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"

_PUBLIC_KEY_RE = re.compile(rf"^[{PUBLIC_KEY_ALPHABET}]{{{PUBLIC_KEY_LENGTH}}}$")
_NON_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify_text(value: str | None, *, max_length: int = SLUG_MAX_LENGTH) -> str:
    """ASCII slug from Vietnamese or English text.

    ``đ`` has no NFKD decomposition, so it is mapped by hand; every other
    diacritic is stripped through NFKD. Anything that is not ``[a-z0-9]``
    becomes a single dash. Empty input falls back to a generic slug so the
    column can stay NOT NULL.
    """
    text = (value or "").replace("đ", "d").replace("Đ", "D")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = _NON_SLUG_RE.sub("-", text.lower()).strip("-")
    if len(text) > max_length:
        text = text[:max_length].rstrip("-")
    return text or SLUG_FALLBACK


def new_public_key() -> str:
    """Random base36 key that always contains a letter.

    The read path treats an all-digit path segment as a legacy integer id, so
    a purely numeric key would be unreachable. Regenerate until at least one
    letter is present (probability of all digits is (10/36)^8, negligible).
    """
    while True:
        key = "".join(secrets.choice(PUBLIC_KEY_ALPHABET) for _ in range(PUBLIC_KEY_LENGTH))
        if not key.isdigit():
            return key


def is_public_key(value: str | None) -> bool:
    return bool(value) and bool(_PUBLIC_KEY_RE.match(value)) and not value.isdigit()


def parse_public_ref(raw: str) -> tuple[str, int] | tuple[str, str] | None:
    """Classify a path segment as ``("id", 123)``, ``("key", "k7f3q9x2")`` or None.

    Accepted forms: ``123`` (legacy id), ``k7f3q9x2`` (bare key) and
    ``some-slug-k7f3q9x2`` (canonical). Anything else is not resolvable and
    the caller should answer 404 without hitting the database.
    """
    token = (raw or "").strip().lower()
    if not token:
        return None
    if token.isdigit():
        return ("id", int(token))
    candidate = token.rsplit("-", 1)[-1]
    if is_public_key(candidate):
        return ("key", candidate)
    return None


def canonical_path(prefix: str, slug: str | None, public_key: str) -> str:
    """``/products/{slug}-{key}``; slug-less rows still get ``/products/{key}``."""
    body = f"{slug}-{public_key}" if slug else public_key
    return f"{prefix.rstrip('/')}/{body}"
