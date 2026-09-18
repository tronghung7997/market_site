from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.database import SessionLocal
from src.i18n.search_text import fold
from src.logging import current_request_id
from src.models.content_filter_config import ContentFilterConfig
from src.runtime_config import ProcessConfigCache

_CONFIG_ID = 1
ACTIONS = ("block", "mask")
MAX_KEYWORDS = 200
MAX_KEYWORD_LENGTH = 64
_EDITABLE = ("enabled", "action", "keywords", "block_phone_numbers", "block_links", "mask_char")

_cache: ProcessConfigCache[dict] = ProcessConfigCache("content_filter")

# Vietnamese mobile/landline numbers, with or without +84, allowing the usual
# obfuscation between digits ("0 9 1 2 . 345 - 678"). Applied to the text
# with separators squeezed out, so the regex itself stays simple.
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?84|0)(?:[35789]\d{8}|2\d{9})(?!\d)")
# Any 9+ digit run is treated as a phone-like number too (foreign numbers,
# "zalo 84912345678" variants). Bounded above so order codes / amounts with
# separators are not eaten: ORD-… codes contain letters, VND amounts are < 9 digits.
_LONG_DIGITS_RE = re.compile(r"(?<!\d)\d{9,12}(?!\d)")
_LINK_RE = re.compile(r"(?:https?://|www\.)[^\s]+", re.IGNORECASE)
# Characters people put between letters/digits to dodge a naive filter.
_SEPARATORS_RE = re.compile(r"[\s._\-*·•|/\\()\[\]{}<>~^'\"`,;:+]+")


@dataclass(slots=True)
class ScreenResult:
    blocked: bool
    text: str
    matches: list[str] = field(default_factory=list)


class ContentBlocked(Exception):
    """Raised when the configured action is "block" and the text matched."""

    def __init__(self, matches: list[str]) -> None:
        super().__init__("content blocked")
        self.matches = matches


def normalize_keyword(raw: str) -> str:
    return " ".join(fold(raw).split())[:MAX_KEYWORD_LENGTH]


def _payload(row: ContentFilterConfig) -> dict:
    return {
        "enabled": bool(row.enabled),
        "action": row.action,
        "keywords": list(row.keywords or []),
        "block_phone_numbers": bool(row.block_phone_numbers),
        "block_links": bool(row.block_links),
        "mask_char": row.mask_char or "*",
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "updated_by_id": row.updated_by_id,
    }


async def ensure_seeded(db: AsyncSession) -> ContentFilterConfig:
    row = await db.get(ContentFilterConfig, _CONFIG_ID)
    if row is not None:
        return row
    await db.execute(
        pg_insert(ContentFilterConfig)
        .values(id=_CONFIG_ID, keywords=[])
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.flush()
    row = await db.get(ContentFilterConfig, _CONFIG_ID)
    assert row is not None
    return row


async def get_config(db: AsyncSession) -> dict:
    cached = _cache.get()
    if cached is not None:
        return cached
    payload = _payload(await ensure_seeded(db))
    _cache.set(payload)
    return payload


async def update_config(
    db: AsyncSession,
    *,
    actor_id: int,
    enabled: bool | None = None,
    action: str | None = None,
    keywords: list[str] | None = None,
    block_phone_numbers: bool | None = None,
    block_links: bool | None = None,
    mask_char: str | None = None,
) -> dict:
    row = await ensure_seeded(db)
    old = _payload(row)
    if enabled is not None:
        row.enabled = bool(enabled)
    if action is not None:
        if action not in ACTIONS:
            raise ValueError("action must be 'block' or 'mask'")
        row.action = action
    if keywords is not None:
        cleaned = list(dict.fromkeys(k for k in (normalize_keyword(k) for k in keywords) if k))
        if len(cleaned) > MAX_KEYWORDS:
            raise ValueError(f"at most {MAX_KEYWORDS} keywords")
        row.keywords = cleaned
    if block_phone_numbers is not None:
        row.block_phone_numbers = bool(block_phone_numbers)
    if block_links is not None:
        row.block_links = bool(block_links)
    if mask_char is not None:
        if len(mask_char) != 1 or mask_char.isspace():
            raise ValueError("mask_char must be one visible character")
        row.mask_char = mask_char
    row.updated_by_id = actor_id
    new = {k: getattr(row, k) for k in _EDITABLE}
    await db.flush()
    await log_event(
        db, "info", "Content filter config updated",
        request_id=current_request_id(),
        metadata={
            "event": "content_filter_config_changed",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "content_filter_config",
            "subject_id": _CONFIG_ID,
            "old": {k: old[k] for k in _EDITABLE},
            "new": new,
            "outcome": "success",
            "source": "admin",
        },
    )
    await db.commit()
    await db.refresh(row)
    _cache.invalidate()
    return _payload(row)


# ── matching ────────────────────────────────────────────────────────────────

def _squeeze(text: str) -> str:
    return _SEPARATORS_RE.sub("", text)


def _find_keyword_spans(original: str, keywords: list[str]) -> list[tuple[int, int, str]]:
    """Spans in `original` that spell a keyword, ignoring case, accents and
    separator characters between letters ("Z.a.l.o" → zalo)."""
    if not keywords:
        return []
    # Map every folded character back to its offset in the original so a
    # match on the squeezed text can be masked in place.
    folded_chars: list[str] = []
    offsets: list[int] = []
    for index, char in enumerate(original):
        f = fold(char)
        if not f or _SEPARATORS_RE.fullmatch(f):
            continue
        folded_chars.append(f[0])
        offsets.append(index)
    squeezed = "".join(folded_chars)
    spans: list[tuple[int, int, str]] = []
    for keyword in keywords:
        needle = _squeeze(keyword)
        if not needle:
            continue
        start = 0
        while True:
            hit = squeezed.find(needle, start)
            if hit == -1:
                break
            spans.append((offsets[hit], offsets[hit + len(needle) - 1] + 1, keyword))
            start = hit + 1
    return spans


def _find_regex_spans(original: str, patterns: list[tuple[re.Pattern[str], str]]) -> list[tuple[int, int, str]]:
    """Regexes run on the digit-squeezed text (so "0912 345 678" matches) and
    the span is mapped back onto the original string."""
    kept: list[int] = []
    squeezed_chars: list[str] = []
    for index, char in enumerate(original):
        if char.isdigit() or char in "+":
            squeezed_chars.append(char)
            kept.append(index)
        elif char.isalpha():
            squeezed_chars.append(char)
            kept.append(index)
        # separators dropped
    squeezed = "".join(squeezed_chars)
    spans: list[tuple[int, int, str]] = []
    for pattern, label in patterns:
        for match in pattern.finditer(squeezed):
            if match.end() <= match.start():
                continue
            spans.append((kept[match.start()], kept[match.end() - 1] + 1, label))
    return spans


def screen(text: str, config: dict) -> ScreenResult:
    """Pure check: what would happen to `text` under `config`."""
    if not config.get("enabled", True) or not text:
        return ScreenResult(blocked=False, text=text)
    spans = _find_keyword_spans(text, config.get("keywords") or [])
    regexes: list[tuple[re.Pattern[str], str]] = []
    if config.get("block_phone_numbers", True):
        regexes.append((_PHONE_RE, "phone"))
        regexes.append((_LONG_DIGITS_RE, "phone"))
    if regexes:
        spans.extend(_find_regex_spans(text, regexes))
    if config.get("block_links"):
        spans.extend((m.start(), m.end(), "link") for m in _LINK_RE.finditer(text))
    if not spans:
        return ScreenResult(blocked=False, text=text)
    matches = list(dict.fromkeys(label for _s, _e, label in spans))
    if config.get("action", "block") == "block":
        return ScreenResult(blocked=True, text=text, matches=matches)
    mask_char = (config.get("mask_char") or "*")[0]
    chars = list(text)
    for start, end, _label in spans:
        for i in range(start, min(end, len(chars))):
            if not chars[i].isspace():
                chars[i] = mask_char
    return ScreenResult(blocked=False, text="".join(chars), matches=matches)


async def screen_text(
    db: AsyncSession,
    text: str,
    *,
    actor_id: int,
    context: str,
    subject_id: str | None = None,
) -> str:
    """Apply the admin filter to user text before it is stored.

    Returns the (possibly masked) text. Raises ``ContentBlocked`` when the
    action is "block". Either way a violation is written as an audit row in
    its own transaction, independent of whether the caller commits.
    """
    config = await get_config(db)
    result = screen(text, config)
    if result.matches:
        # Own session: a blocked message aborts the caller's transaction, and
        # the violation must survive that so repeat offenders stay visible.
        async with SessionLocal() as audit_db:
            await log_event(
                audit_db, "warning", f"Off-platform contact detected in {context}",
                request_id=current_request_id(),
                metadata={
                    "event": "content_filter_hit",
                    "actor_id": actor_id,
                    "actor_type": "user",
                    "subject_type": context,
                    "subject_id": subject_id,
                    "outcome": "blocked" if result.blocked else "masked",
                    "source": "user",
                    "matches": result.matches,
                },
            )
            await audit_db.commit()
    if result.blocked:
        raise ContentBlocked(result.matches)
    return result.text
