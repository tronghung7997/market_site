import hashlib
import secrets

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.seller_api_key import SellerApiKey
from src.security.crypto import encrypt_str

# Public key_id: ak_live_ + 128 bits entropy (token_urlsafe(16)).
_KEY_ID_BYTES = 16
# Signing secret: sk_live_ + 256 bits entropy (token_urlsafe(32)).
_SECRET_BYTES = 32


def _mask_credential(value: str) -> str:
    if len(value) <= 16:
        return f"{value[:4]}…{value[-2:]}"
    return f"{value[:12]}...{value[-4:]}"


def generate_signed_credentials() -> tuple[str, str, str, str]:
    """Return (key_id, api_secret, key_prefix, signing_secret_encrypted).

    Plaintext api_secret is returned only so the create handler can show it
    once — callers must not persist it.
    """
    key_id = f"ak_live_{secrets.token_urlsafe(_KEY_ID_BYTES)}"
    api_secret = f"sk_live_{secrets.token_urlsafe(_SECRET_BYTES)}"
    key_prefix = _mask_credential(key_id)
    encrypted = encrypt_str(api_secret)
    return key_id, api_secret, key_prefix, encrypted


def generate_api_key() -> tuple[str, str, str]:
    """Legacy helper kept for tests that mint bearer keys directly.

    Production create path uses generate_signed_credentials only.
    """
    raw = secrets.token_urlsafe(32)
    plaintext = f"sk_live_{raw}"
    key_hash = hashlib.sha256(plaintext.encode()).hexdigest()
    key_prefix = _mask_credential(plaintext)
    return plaintext, key_hash, key_prefix


async def create_api_key(account_id: int, db: AsyncSession) -> tuple[SellerApiKey, str, str]:
    """Create a signed credential. Returns (row, key_id, api_secret).

    api_secret is plaintext and appears only in this return value / create
    response — never in audit logs or subsequent list/get endpoints.
    """
    from src.audit.service import log_event
    from src.logging import current_request_id

    key_id, api_secret, key_prefix, encrypted = generate_signed_credentials()
    row = SellerApiKey(
        account_id=account_id,
        key_hash=None,
        key_prefix=key_prefix,
        key_id=key_id,
        signing_secret_encrypted=encrypted,
        signing_version="v1",
    )
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
            "signing_version": "v1",
            # Never include api_secret or full key_id material beyond prefix.
        },
    )
    await db.commit()
    await db.refresh(row)
    return row, key_id, api_secret


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
