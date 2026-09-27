from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session

from . import schemas, service

router = APIRouter(tags=["storefront"])


@router.get("/public/marketplace-stats", response_model=schemas.MarketplaceStats)
async def marketplace_stats(db: AsyncSession = Depends(get_session)):
    """Unauthenticated; cached per process for a minute."""
    return await service.get_marketplace_stats(db)
