import hashlib
import secrets

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.seller_api_key import SellerApiKey


def generate_api_key() -> tuple[str, str, str]:
    """Returns (plaintext, key_hash, key_prefix)."""
    raw = secrets.token_urlsafe(32)
    plaintext = f"sk_live_{raw}"
    key_hash = hashlib.sha256(plaintext.encode()).hexdigest()
    key_prefix = f"{plaintext[:12]}...{plaintext[-4:]}"
    return plaintext, key_hash, key_prefix


async def create_api_key(account_id: int, db: AsyncSession) -> tuple[SellerApiKey, str]:
    plaintext, key_hash, key_prefix = generate_api_key()
    row = SellerApiKey(account_id=account_id, key_hash=key_hash, key_prefix=key_prefix)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row, plaintext


async def list_api_keys(account_id: int, db: AsyncSession) -> list[SellerApiKey]:
    result = await db.execute(
        select(SellerApiKey).where(SellerApiKey.account_id == account_id)
        .order_by(SellerApiKey.created_at.desc())
    )
    return list(result.scalars().all())


async def revoke_api_key(account_id: int, key_id: int, db: AsyncSession) -> SellerApiKey:
    row = await db.get(SellerApiKey, key_id)
    if not row or row.account_id != account_id:
        raise HTTPException(status_code=404, detail="Không tìm thấy API key")
    if row.revoked_at is not None:
        raise HTTPException(status_code=400, detail="API key đã bị thu hồi trước đó")
    from sqlalchemy import func
    row.revoked_at = func.now()
    await db.commit()
    await db.refresh(row)
    return row
