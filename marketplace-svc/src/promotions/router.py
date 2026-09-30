from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.common.csv_export import csv_response
from src.common.pagination import page_params
from src.database import get_session
from src.models.account import Account

from . import codes, schemas, service

router = APIRouter(tags=["promotions"])
Admin = Depends(require_role("admin"))


@router.get("/admin/promotions", response_model=schemas.PromotionPage)
async def list_promotions(
    q: str | None = Query(None, max_length=100),
    state: schemas.ListState | None = None,
    sort: schemas.ListSort = "updated",
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    _: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    return await service.list_promotions(db, q=q, state=state, sort=sort, params=page_params(page, per_page))


@router.post("/admin/promotions", response_model=schemas.PromotionAdmin, status_code=201)
async def create_promotion(
    body: schemas.PromotionPatch,
    admin: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    return await service.create_promotion(db, actor_id=admin.id, data=body.model_dump(exclude_unset=True))


@router.get("/admin/promotions/{promotion_id}", response_model=schemas.PromotionAdmin)
async def get_promotion(promotion_id: int, _: Account = Admin, db: AsyncSession = Depends(get_session)):
    return await service.get_promotion(db, promotion_id)


@router.patch("/admin/promotions/{promotion_id}", response_model=schemas.PromotionAdmin)
async def update_promotion(
    promotion_id: int,
    body: schemas.PromotionPatch,
    admin: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    return await service.update_promotion(
        db, actor_id=admin.id, promotion_id=promotion_id, patch=body.model_dump(exclude_unset=True),
    )


@router.delete("/admin/promotions/{promotion_id}", status_code=204)
async def delete_promotion(promotion_id: int, admin: Account = Admin, db: AsyncSession = Depends(get_session)):
    await service.delete_promotion(db, actor_id=admin.id, promotion_id=promotion_id)
    return Response(status_code=204)


@router.post("/admin/promotions/{promotion_id}/duplicate", response_model=schemas.PromotionAdmin, status_code=201)
async def duplicate_promotion(promotion_id: int, admin: Account = Admin, db: AsyncSession = Depends(get_session)):
    return await service.duplicate_promotion(db, actor_id=admin.id, promotion_id=promotion_id)


@router.post("/admin/promotions/{promotion_id}/archive", response_model=schemas.PromotionAdmin)
async def archive_promotion(promotion_id: int, admin: Account = Admin, db: AsyncSession = Depends(get_session)):
    return await service.set_archived(db, actor_id=admin.id, promotion_id=promotion_id, archived=True)


@router.post("/admin/promotions/{promotion_id}/unarchive", response_model=schemas.PromotionAdmin)
async def unarchive_promotion(promotion_id: int, admin: Account = Admin, db: AsyncSession = Depends(get_session)):
    return await service.set_archived(db, actor_id=admin.id, promotion_id=promotion_id, archived=False)


@router.get("/admin/promotions/{promotion_id}/redemptions", response_model=schemas.PromotionRedemptionPage)
async def list_redemptions(
    promotion_id: int,
    q: str | None = Query(None, max_length=200),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    _: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    return await service.list_redemptions(db, promotion_id, q=q, params=page_params(page, per_page))


@router.get("/admin/promotions/{promotion_id}/redemptions.csv")
async def export_redemptions(
    promotion_id: int,
    q: str | None = Query(None, max_length=200),
    _: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    rows = await service.redemption_csv_rows(db, promotion_id, q=q)
    return csv_response(
        service.REDEMPTION_CSV_HEADER, rows, f"promotion-{promotion_id}-redemptions-{date.today():%Y%m%d}.csv",
    )


@router.get("/admin/promotions/{promotion_id}/stats", response_model=schemas.PromotionStats)
async def promotion_stats(
    promotion_id: int,
    days: int = Query(30, ge=1, le=365),
    _: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    return await service.promotion_stats(db, promotion_id, days=days)


@router.post("/admin/promotions/{promotion_id}/codes", response_model=schemas.PromotionCodesCreated, status_code=201)
async def create_codes(
    promotion_id: int,
    body: schemas.PromotionCodesCreate,
    admin: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    created = await codes.create_codes(
        db, actor_id=admin.id, promotion_id=promotion_id, count=body.count, prefix=body.prefix, length=body.length,
    )
    return {"created": created}


CodeStatus = Literal["all", "unused", "used"]


@router.get("/admin/promotions/{promotion_id}/codes", response_model=schemas.PromotionCodePage)
async def list_codes(
    promotion_id: int,
    status: CodeStatus = "all",
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    _: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    return await codes.list_codes(db, promotion_id, code_status=status, params=page_params(page, per_page))


@router.get("/admin/promotions/{promotion_id}/codes.csv")
async def export_codes(
    promotion_id: int,
    status: CodeStatus = "all",
    _: Account = Admin,
    db: AsyncSession = Depends(get_session),
):
    rows = await codes.codes_csv_rows(db, promotion_id, code_status=status)
    return csv_response(codes.CODES_CSV_HEADER, rows, f"promotion-{promotion_id}-codes-{date.today():%Y%m%d}.csv")
