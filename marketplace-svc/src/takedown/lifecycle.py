"""Pure rules for takedown requests — no DB, no network (unit-tested directly).

Partner statuses (API.vi.md §6) → GMMO statuses:

    pending_review           → review
    quoted                   → review until an admin sets the buyer price, then quoted
    awaiting_payment         → started   (buyer accepted, money held in an order)
    processing               → processing
    in_warranty              → warranty
    warranty_pending         → warranty_claim
    success                  → done
    failed                   → failed     (buyer refunded)
    rejected                 → declined   (partner will not take it; nothing was charged)
    quote_rejected           → rejected   (buyer declined the quote)
    cancelled                → cancelled  (refunded if money was held)
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit

PARTNER_STATUSES = (
    "pending_review", "quoted", "awaiting_payment", "processing", "in_warranty", "warranty_pending",
    "success", "failed", "rejected", "quote_rejected", "cancelled",
)

_DIRECT = {
    "pending_review": "review",
    "awaiting_payment": "started",
    "processing": "processing",
    "in_warranty": "warranty",
    "warranty_pending": "warranty_claim",
    "success": "done",
    "failed": "failed",
    "rejected": "declined",
    "quote_rejected": "rejected",
    "cancelled": "cancelled",
}

TERMINAL = frozenset({"done", "failed", "declined", "rejected", "cancelled"})


def status_for(partner_status: str, *, price_set: bool, order_held: bool) -> str:
    """Our status for a partner status. ``order_held`` = the buyer already paid
    (accept may still be on its way to the partner, so a partner ``quoted``
    reads as ``started``)."""
    if partner_status == "quoted":
        if order_held:
            return "started"
        return "quoted" if price_set else "review"
    if partner_status == "pending_review" and order_held:
        return "started"
    return _DIRECT.get(partner_status, "review")


# A webhook carries one step (from → to). It is applied only when it starts
# where we are; anything else means we missed or reordered something and the
# request is re-read from the partner instead.
def webhook_applies(current_partner_status: str | None, from_status: str | None) -> bool:
    if current_partner_status is None:
        return from_status in (None, "pending_review")
    return from_status == current_partner_status


REFUND_ON = frozenset({"failed", "cancelled"})


# ---------------------------------------------------------------- the link

_HOSTS: tuple[tuple[str, str], ...] = (
    ("tiktok.com", "tiktok"),
    ("facebook.com", "facebook"), ("fb.com", "facebook"), ("fb.watch", "facebook"),
    ("instagram.com", "instagram"),
    ("youtube.com", "youtube"), ("youtu.be", "youtube"),
    ("threads.net", "threads"),
    ("x.com", "x"), ("twitter.com", "x"),
    ("shopee.vn", "shopee"),
)


def platform_for(url: str) -> str:
    """Partner `platform` (2–20 chars, ``^[a-z][a-z0-9_-]*$``) guessed from the link; ``web`` otherwise."""
    text = url.strip()
    try:
        host = (urlsplit(text if re.match(r"^https?://", text, re.I) else f"https://{text}").hostname or "").lower()
    except ValueError:
        return "web"
    for suffix, name in _HOSTS:
        if host == suffix or host.endswith("." + suffix):
            return name
    return "web"


def reason_for(code: str, note: str | None) -> str:
    """Partner `reason`: our code first, so a lost create response can be found again."""
    text = f"[{code}]"
    if note and note.strip():
        text += " " + note.strip()
    return text[:2000]


def code_in_reason(reason: str | None) -> str | None:
    match = re.match(r"^\[(TD-[0-9A-Z]{8})\]", reason or "")
    return match.group(1) if match else None


def safe_http_url(value: str | None) -> str | None:
    """Evidence URLs are shown only when they are http(s) (API.vi.md §7.5)."""
    if not value:
        return None
    return value if re.match(r"^https?://", value.strip(), re.I) else None
