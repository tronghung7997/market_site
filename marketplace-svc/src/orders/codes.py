"""Order codes and counterparty masking for buyer/seller-facing payloads.

``orders.order_code`` (``ORD-`` + 8 uppercase base36, always containing a
letter) is the identifier shown to buyers and sellers and accepted on every
``/orders/{order_ref}`` route. The sequential ``orders.id`` stays internal: a
buyer with two orders must not be able to read the marketplace's daily volume
off their own order numbers.
"""

from __future__ import annotations

import re

from src.i18n.slug import new_public_key

ORDER_CODE_PREFIX = "ORD-"
_CODE_BODY_RE = re.compile(r"^[0-9A-Z]{8}$")


def new_order_code() -> str:
    return ORDER_CODE_PREFIX + new_public_key().upper()


def parse_order_ref(raw: str) -> tuple[str, int] | tuple[str, str] | None:
    """``("id", 123)`` for a legacy integer, ``("code", "ORD-K7F3Q9X2")`` for a
    code (with or without the prefix, any case), None for anything else."""
    token = (raw or "").strip()
    if not token:
        return None
    if token.isdigit():
        return ("id", int(token))
    body = token.upper()
    if body.startswith(ORDER_CODE_PREFIX):
        body = body[len(ORDER_CODE_PREFIX):]
    if _CODE_BODY_RE.match(body) and not body.isdigit():
        return ("code", ORDER_CODE_PREFIX + body)
    return None


def mask_email(email: str | None) -> str | None:
    """``buyer.name@gmail.com`` -> ``bu***@gmail.com``. Enough for a seller to
    recognise a returning customer, not enough to contact them off-platform."""
    if not email or "@" not in email:
        return None
    local, domain = email.split("@", 1)
    visible = local[:2] if len(local) >= 3 else ""
    return f"{visible}***@{domain}"
