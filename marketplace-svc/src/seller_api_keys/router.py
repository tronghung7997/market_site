from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_min_seller_tier, require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["seller-api-keys"])


@router.post("/seller/api-keys", response_model=schemas.SellerApiKeyCreated, status_code=201)
async def create_key(
    account: Account = Depends(require_min_seller_tier("trusted")),
    db: AsyncSession = Depends(get_session),
):
    row, plaintext = await service.create_api_key(account.id, db)
    return schemas.SellerApiKeyCreated(
        id=row.id, key=plaintext, key_prefix=row.key_prefix, created_at=row.created_at,
    )


@router.get("/seller/api-keys", response_model=list[schemas.SellerApiKeyResponse])
async def list_keys(
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_api_keys(account.id, db)


@router.delete("/seller/api-keys/{key_id}", response_model=schemas.SellerApiKeyResponse)
async def revoke_key(
    key_id: int,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.revoke_api_key(account.id, key_id, db)
