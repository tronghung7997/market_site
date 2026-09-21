"""Catalog of AI task ids.

A task is the unit an admin edits copy for and the unit spend is attributed
to. Adding an AI feature means adding an id here plus a prompt template row —
never a new provider integration.

Ids are stable strings, not an enum value chain: they are persisted as the
primary key of ``ai_prompt_templates`` and referenced by ``ai_usage_log``.
"""
from __future__ import annotations

from typing import Final

# Generated demo reviews for the seeded-liquidity console (admin only).
TRUST_SEED_REVIEWS: Final = "trust_seed.reviews"

# Every task the prompt catalog may hold. The admin API rejects anything else,
# so a typo cannot silently create an orphan template.
KNOWN_TASKS: Final[frozenset[str]] = frozenset({
    TRUST_SEED_REVIEWS,
})

SUPPORTED_LOCALES: Final[tuple[str, ...]] = ("vi", "en")


def is_known_task(task: str) -> bool:
    return task in KNOWN_TASKS
