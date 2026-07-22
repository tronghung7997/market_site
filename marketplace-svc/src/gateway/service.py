import hashlib
import secrets

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.order import Order

_PREFIX = "gwk_live_"


def generate_gateway_key() -> tuple[str, str, str]:
    """Returns (plaintext, key_hash, key_prefix) — sha256 at rest, same
    reasoning as seller_api_keys/service.py: the plaintext already has 256
    bits of entropy from secrets.token_urlsafe, bcrypt would only add latency
    to every gateway-forwarded request for no security benefit."""
    raw = secrets.token_urlsafe(32)
    plaintext = f"{_PREFIX}{raw}"
    key_hash = hashlib.sha256(plaintext.encode()).hexdigest()
    key_prefix = f"{plaintext[:16]}...{plaintext[-4:]}"
    return plaintext, key_hash, key_prefix


async def mint_gateway_key(order: Order) -> str:
    """Attach a fresh gateway key to `order` (caller flushes/commits) and
    return the plaintext — shown to the buyer exactly once, in
    order.delivered_data. The seller's real base_url/api_key never appear in
    anything the buyer can read."""
    plaintext, key_hash, key_prefix = generate_gateway_key()
    order.gateway_key_hash = key_hash
    order.gateway_key_prefix = key_prefix
    return plaintext


async def resolve_order_by_gateway_key(plaintext: str, db: AsyncSession) -> Order:
    key_hash = hashlib.sha256(plaintext.encode()).hexdigest()
    order = await db.scalar(select(Order).where(Order.gateway_key_hash == key_hash))
    if not order:
        raise HTTPException(status_code=401, detail="Gateway key không hợp lệ")
    return order
