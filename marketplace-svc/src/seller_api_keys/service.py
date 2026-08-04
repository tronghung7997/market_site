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
    from src.audit.service import log_event
    from src.logging import current_request_id

    plaintext, key_hash, key_prefix = generate_api_key()
    row = SellerApiKey(account_id=account_id, key_hash=key_hash, key_prefix=key_prefix)
    db.add(row)
    await db.flush()
    await log_event(
        db, "info", f"Seller API key created for account {account_id}",
        request_id=current_request_id(),
        metadata={
            "event": "seller_api_key_created",
            "actor_id": account_id,
            "actor_type": "seller",
            "subject_type": "seller_api_key",
            "subject_id": row.id,
            "outcome": "success",
            "source": "seller",
            "key_id": row.id,
            "prefix": key_prefix,
        },
    )
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
    from src.audit.service import log_event
    from src.logging import current_request_id
    from sqlalchemy import func

    row = await db.get(SellerApiKey, key_id)
    if not row or row.account_id != account_id:
        raise HTTPException(status_code=404, detail="Không tìm thấy API key")
    if row.revoked_at is not None:
        raise HTTPException(status_code=400, detail="API key đã bị thu hồi trước đó")
    prefix = row.key_prefix
    row.revoked_at = func.now()
    await log_event(
        db, "info", f"Seller API key {key_id} revoked",
        request_id=current_request_id(),
        metadata={
            "event": "seller_api_key_revoked",
            "actor_id": account_id,
            "actor_type": "seller",
            "subject_type": "seller_api_key",
            "subject_id": key_id,
            "outcome": "success",
            "source": "seller",
            "key_id": key_id,
            "prefix": prefix,
        },
    )
    await db.commit()
    await db.refresh(row)
    return row
