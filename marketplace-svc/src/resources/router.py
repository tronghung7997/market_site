from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, get_seller_account_jwt_or_api_key, require_role, verify_internal_key
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["resources"])


@router.post("/seller/variants/{variant_id}/resources", response_model=schemas.BulkResourceResponse, status_code=status.HTTP_201_CREATED)
async def bulk_add(variant_id: int, body: schemas.BulkResourceCreate, account: Account = Depends(get_seller_account_jwt_or_api_key), db: AsyncSession = Depends(get_session)):
    count = await service.bulk_add_resources(variant_id, account.id, body.items, db)
    return schemas.BulkResourceResponse(count=count)


@router.get("/seller/variants/{variant_id}/resources", response_model=list[schemas.ResourceResponse])
async def list_res(variant_id: int, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.list_resources(variant_id, account.id, db)


@router.delete("/seller/resources/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_res(resource_id: int, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    await service.delete_resource(resource_id, account.id, db)


@router.post("/internal/resources/acquire", response_model=schemas.InternalAcquireResponse)
async def internal_acquire(body: schemas.InternalAcquireRequest, db: AsyncSession = Depends(get_session), _=Depends(verify_internal_key)):
    resources = await service.claim_resources(body.variant_id, body.quantity, db, order_id=None, duration_days=None)
    await db.commit()
    return schemas.InternalAcquireResponse(resources=[{"resource_id": r.id, "data": r.data} for r in resources])


@router.post("/internal/resources/release")
async def internal_release(body: schemas.InternalReleaseRequest, db: AsyncSession = Depends(get_session), _=Depends(verify_internal_key)):
    await service.release_resources(body.resource_ids, db)
    return {"status": "released"}


@router.get("/orders/{order_id}/resources", response_model=list[schemas.ResourceResponse])
async def order_res(order_id: int, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.order_resources(order_id, account.id, db)


@router.post("/seller/resources/{resource_id}/error", response_model=schemas.ResourceResponse)
async def mark_error(resource_id: int, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.mark_resource_error(resource_id, account.id, db)


@router.get("/admin/resources", response_model=schemas.AdminResourceListResponse)
async def admin_resources(
    status: str | None = None,
    variant_id: int | None = None,
    product_id: int | None = None,
    seller_id: int | None = None,
    search: str | None = None,
    page: int = 1,
    per_page: int = 20,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_all_resources(
        db,
        status=status,
        variant_id=variant_id,
        product_id=product_id,
        seller_id=seller_id,
        search=search,
        page=page,
        per_page=per_page,
    )


@router.get("/admin/resources/summary", response_model=schemas.ResourceStatusSummary)
async def res_summary(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.resource_status_summary(db)
