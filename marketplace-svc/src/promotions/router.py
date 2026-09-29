from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["promotions"])


@router.get("/admin/promotions", response_model=list[schemas.PromotionAdmin])
async def list_promotions(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.list_promotions(db)


@router.post("/admin/promotions", response_model=schemas.PromotionAdmin, status_code=201)
async def create_promotion(
    body: schemas.PromotionInput,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.create_promotion(db, actor_id=admin.id, data=body.model_dump())


@router.patch("/admin/promotions/{promotion_id}", response_model=schemas.PromotionAdmin)
async def update_promotion(
    promotion_id: int,
    body: schemas.PromotionPatch,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_promotion(
        db, actor_id=admin.id, promotion_id=promotion_id, patch=body.model_dump(exclude_unset=True),
    )


@router.delete("/admin/promotions/{promotion_id}", status_code=204)
async def delete_promotion(
    promotion_id: int,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await service.delete_promotion(db, actor_id=admin.id, promotion_id=promotion_id)
    return Response(status_code=204)


@router.get("/admin/promotions/{promotion_id}/redemptions", response_model=list[schemas.PromotionRedemptionRow])
async def list_redemptions(
    promotion_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_redemptions(db, promotion_id)
