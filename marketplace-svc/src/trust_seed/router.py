"""Admin HTTP surface for seeded liquidity."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account
from src.trust_seed import schemas, service
from src.trust_seed.service import TrustSeedError

router = APIRouter(prefix="/admin/trust-seed", tags=["admin-trust-seed"])

_STATUS_BY_CODE = {
    "product_not_found": status.HTTP_404_NOT_FOUND,
    "batch_not_found": status.HTTP_404_NOT_FOUND,
    "already_purged": status.HTTP_409_CONFLICT,
    "ai_disabled": status.HTTP_409_CONFLICT,
    "ai_not_configured": status.HTTP_400_BAD_REQUEST,
    "ai_budget_exceeded": status.HTTP_429_TOO_MANY_REQUESTS,
    "ai_unavailable": status.HTTP_503_SERVICE_UNAVAILABLE,
    "ai_invalid_output": status.HTTP_502_BAD_GATEWAY,
}


def _http(exc: TrustSeedError) -> HTTPException:
    return HTTPException(
        status_code=_STATUS_BY_CODE.get(exc.code, status.HTTP_400_BAD_REQUEST),
        detail=str(exc),
    )


@router.post("/generate", response_model=schemas.GenerateResponse)
async def generate_drafts(
    body: schemas.GenerateRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """Return drafts only. Nothing is written until the admin posts /apply."""
    try:
        return await service.generate(
            db,
            product_id=body.product_id,
            count=body.count,
            distribution=body.distribution,
            locale=body.locale,
            actor_id=admin.id,
            system_override=body.system_override,
            user_override=body.user_override,
            extra_instructions=body.extra_instructions,
        )
    except TrustSeedError as exc:
        raise _http(exc) from exc


@router.post("/apply", response_model=schemas.ApplyResponse, status_code=status.HTTP_201_CREATED)
async def apply_drafts(
    body: schemas.ApplyRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await service.apply(
            db,
            product_id=body.product_id,
            items=[item.model_dump() for item in body.items],
            date_from=body.date_from,
            date_to=body.date_to,
            actor_id=admin.id,
            source=body.source,
            model=body.model,
            locale=body.locale,
            prompt_snapshot=body.prompt_snapshot,
            options_snapshot=body.options_snapshot,
            bump_sold_count=body.bump_sold_count,
        )
    except TrustSeedError as exc:
        raise _http(exc) from exc


@router.get("/batches", response_model=list[schemas.BatchRow])
async def list_batches(
    product_id: int | None = Query(default=None),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_batches(db, product_id=product_id)


@router.delete("/batches/{batch_id}", response_model=schemas.PurgeResponse)
async def purge_batch(
    batch_id: int,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await service.purge_batch(db, batch_id=batch_id, actor_id=admin.id)
    except TrustSeedError as exc:
        raise _http(exc) from exc


@router.get("/products/{product_id}/summary", response_model=schemas.ProductSummary)
async def product_summary(
    product_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.product_summary(db, product_id)
