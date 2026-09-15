from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session

from . import schemas, service

router = APIRouter(tags=["sellers"])


@router.get("/sellers/top", response_model=list[schemas.SellerSummary])
async def top_sellers(limit: int = Query(6, ge=1, le=20), db: AsyncSession = Depends(get_session)):
    return await service.get_top_sellers(db, limit)


@router.get("/sellers/{seller_ref}", response_model=schemas.SellerProfile)
async def seller_profile(seller_ref: str, db: AsyncSession = Depends(get_session)):
    """Public profile by ``{handle}-{key}``, bare key, or legacy account id.
    The integer form stays so old links resolve; the frontend redirects them
    to ``canonical_path``. Unknown refs and non-sellers both answer 404."""
    account = await service.resolve_seller_ref(seller_ref, db)
    profile = await service.get_seller_profile(account.id, db) if account else None
    if not profile:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhà bán")
    return profile
