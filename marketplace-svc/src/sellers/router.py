from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session

from . import schemas, service

router = APIRouter(tags=["sellers"])


@router.get("/sellers/top", response_model=list[schemas.SellerSummary])
async def top_sellers(limit: int = Query(6, ge=1, le=20), db: AsyncSession = Depends(get_session)):
    return await service.get_top_sellers(db, limit)


@router.get("/sellers/{seller_id}", response_model=schemas.SellerProfile)
async def seller_profile(seller_id: int, db: AsyncSession = Depends(get_session)):
    profile = await service.get_seller_profile(seller_id, db)
    if not profile:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhà bán")
    return profile
