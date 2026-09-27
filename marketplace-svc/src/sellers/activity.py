"""Coarse, public signals of how present a shop is: how fast it answers
buyers and how recently the owner used the site. Only bands leave the
server, never timestamps."""
from __future__ import annotations

from datetime import datetime, timedelta
from statistics import median

# Fewer answered-or-overdue chats than this and the shop shows no response band.
MIN_RESPONSE_SAMPLE = 3
# A buyer message without a reply only counts against the shop after this long.
UNANSWERED_AFTER = timedelta(hours=24)

RESPONSE_BANDS: tuple[tuple[str, float], ...] = (("15m", 15), ("1h", 60), ("6h", 360), ("24h", 1440))
ACTIVE_BANDS: tuple[tuple[str, timedelta], ...] = (
    ("15m", timedelta(minutes=15)),
    ("1h", timedelta(hours=1)),
    ("24h", timedelta(hours=24)),
    ("7d", timedelta(days=7)),
    ("30d", timedelta(days=30)),
)


def response_band(threads: list[tuple[datetime, datetime | None]], now: datetime) -> dict | None:
    """``threads``: (first buyer message, first shop reply after it) per chat.
    Returns the median reply band, the share answered and the sample size."""
    answered = [(reply - asked).total_seconds() / 60 for asked, reply in threads if reply is not None]
    overdue = sum(1 for asked, reply in threads if reply is None and now - asked >= UNANSWERED_AFTER)
    sample = len(answered) + overdue
    if sample < MIN_RESPONSE_SAMPLE:
        return None
    within = "slow"
    if answered:
        typical = median(answered)
        within = next((band for band, limit in RESPONSE_BANDS if typical <= limit), "slow")
    return {"within": within, "rate": round(100 * len(answered) / sample), "sample": sample}


def active_band(last_seen: datetime | None, now: datetime) -> str | None:
    if last_seen is None:
        return None
    age = now - last_seen
    return next((band for band, limit in ACTIVE_BANDS if age <= limit), None)
