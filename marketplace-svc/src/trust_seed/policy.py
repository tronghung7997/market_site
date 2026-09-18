"""Content rules every generated review must satisfy before it can be applied.

A model follows instructions probabilistically; the platform's leakage rule is
not negotiable. The same off-platform contact patterns the marketplace blocks
in chat are rejected here, deterministically, after generation — an admin can
never apply a draft that advertises Telegram or a phone number, whether it came
from the model or was typed by hand in the editor.
"""
from __future__ import annotations

import re
import unicodedata

MIN_COMMENT_CHARS = 2
MAX_COMMENT_CHARS = 500
MAX_REPLY_CHARS = 300

# Off-platform contact channels. Matched after separator-stripping so
# "z.a.l.o" and "t e l e" collapse onto the same token.
_BANNED_TOKENS = (
    "zalo", "telegram", "telegramme", "whatsapp", "viber", "messenger",
    "skype", "wechat", "facebookcom", "fbcom", "imessage", "discord",
)

_URL = re.compile(r"(https?://|www\.|\b[a-z0-9-]+\.(com|net|org|vn|io|me|xyz|shop|info)\b)", re.I)
# Vietnamese mobile numbers, with or without country code and separators.
_PHONE = re.compile(r"(?:\+?84|0)(?:[\s.\-]?\d){8,10}")
_TELEGRAM_HANDLE = re.compile(r"@[a-z0-9_]{4,}", re.I)
_EMAIL = re.compile(r"[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}", re.I)
_SEPARATORS = re.compile(r"[\s._\-*|/\\+]")


def _collapse(text: str) -> str:
    """Strip diacritics and separators so obfuscated spellings still match."""
    folded = unicodedata.normalize("NFD", text.lower())
    folded = "".join(c for c in folded if unicodedata.category(c) != "Mn")
    return _SEPARATORS.sub("", folded)


def find_violations(text: str) -> list[str]:
    """Machine-readable reasons this text may not be published. Empty = clean."""
    if not text:
        return []
    reasons: list[str] = []
    collapsed = _collapse(text)

    for token in _BANNED_TOKENS:
        if token in collapsed:
            reasons.append(f"contact:{token}")
    if _URL.search(text):
        reasons.append("link")
    if _PHONE.search(text):
        reasons.append("phone")
    if _TELEGRAM_HANDLE.search(text):
        reasons.append("handle")
    if _EMAIL.search(text):
        reasons.append("email")
    return reasons


def validate_draft(rating: int, comment: str | None, seller_reply: str | None) -> list[str]:
    """All problems with one draft row, so the console can show them at once."""
    problems: list[str] = []

    if rating < 1 or rating > 5:
        problems.append("rating_range")

    if comment is not None:
        stripped = comment.strip()
        if stripped and len(stripped) < MIN_COMMENT_CHARS:
            problems.append("comment_too_short")
        if len(stripped) > MAX_COMMENT_CHARS:
            problems.append("comment_too_long")
        problems.extend(find_violations(stripped))

    if seller_reply is not None:
        stripped_reply = seller_reply.strip()
        if len(stripped_reply) > MAX_REPLY_CHARS:
            problems.append("reply_too_long")
        problems.extend(f"reply_{r}" for r in find_violations(stripped_reply))

    return problems
