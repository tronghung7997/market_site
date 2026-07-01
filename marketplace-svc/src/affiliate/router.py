from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session

from . import schemas, service

router = APIRouter(tags=["affiliate"])


@router.post("/affiliate/click", status_code=status.HTTP_204_NO_CONTENT)
async def click(body: schemas.ClickRequest, db: AsyncSession = Depends(get_session)):
    await service.record_click(body.code, db, path=body.path, referrer=body.referrer)
    return None
