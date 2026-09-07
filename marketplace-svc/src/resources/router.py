from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, get_seller_account, require_role, verify_internal_key
from src.audit.service import log_event
from src.database import get_session
from src.logging import current_request_id
from src.models.account import Account
from src.models.resource import ResourceStatus

from . import schemas, service

router = APIRouter(tags=["resources"])


@router.post("/seller/variants/{variant_id}/resources", response_model=schemas.BulkResourceResponse, status_code=status.HTTP_201_CREATED)
async def bulk_add(variant_id: int, body: schemas.BulkResourceCreate, account: Account = Depends(get_seller_account), db: AsyncSession = Depends(get_session)):
    count = await service.bulk_add_resources(variant_id, account.id, body.items, db)
    return schemas.BulkResourceResponse(count=count)


@router.get("/seller/variants/{variant_id}/resources", response_model=list[schemas.ResourceResponse])
async def list_res(
    variant_id: int,
    response: Response,
    resource_status: ResourceStatus | None = Query(None, alias="status"),
    search: str | None = None,
    include_archived: bool = False,
    archived_only: bool = False,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    items, total = await service.list_resources(
        variant_id,
        account.id,
        db,
        status_filter=resource_status,
        search=search,
        include_archived=include_archived,
        archived_only=archived_only,
        page=page,
        per_page=per_page,
    )
    response.headers["X-Total-Count"] = str(total)
    return items


@router.get("/seller/inventory/summary", response_model=schemas.InventorySummaryResponse)
async def inventory_summary(
    search: str | None = None,
    stock: Literal["out", "low", "error"] | None = Query(None),
    product_status: Literal["active", "all"] = Query("active"),
    product_id: int | None = Query(None, ge=1),
    variant_id: int | None = Query(None, ge=1),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.seller_inventory_summary(
        account.id, db, search=search, stock=stock, product_status=product_status,
        product_id=product_id, variant_id=variant_id,
        page=page, per_page=per_page,
    )


@router.get("/seller/variants/{variant_id}/resources/export")
async def export_resources(
    variant_id: int,
    format: str = Query("csv", pattern="^(csv|txt)$"),
    resource_status: ResourceStatus | None = Query(None, alias="status"),
    search: str | None = None,
    archived_only: bool = False,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    stream = await service.export_resources(
        variant_id, account.id, db, format=format, status_filter=resource_status,
        search=search, archived_only=archived_only,
    )
    filename = f"inventory_variant_{variant_id}.{format}"
    return StreamingResponse(
        stream,
        media_type="text/csv" if format == "csv" else "text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/seller/resources/{resource_id}", response_model=schemas.ResourceResponse)
async def update_res(resource_id: int, body: schemas.ResourceUpdate, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.update_resource_data(resource_id, account.id, body.data, db)


@router.post("/seller/resources/{resource_id}/restock", response_model=schemas.ResourceResponse)
async def restock_res(
    resource_id: int,
    body: schemas.ResourceRestock,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.restock_resource(resource_id, account.id, db, data=body.data)


@router.post("/seller/resources/{resource_id}/archive", response_model=schemas.ResourceResponse)
async def archive_res(
    resource_id: int,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.archive_resource(resource_id, account.id, db)


@router.post("/seller/resources/{resource_id}/restore", response_model=schemas.ResourceResponse)
async def restore_res(
    resource_id: int,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.restore_resource(resource_id, account.id, db)


@router.post("/seller/variants/{variant_id}/resources/bulk-action", response_model=schemas.BulkResourceActionResult)
async def bulk_action_res(
    variant_id: int,
    body: schemas.BulkResourceAction,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    action, count, ids = await service.bulk_resource_action(
        variant_id, account.id, body.action, body.resource_ids, db,
    )
    return schemas.BulkResourceActionResult(action=action, count=count, resource_ids=ids)


@router.delete("/seller/resources/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_res(resource_id: int, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    await service.delete_resource(resource_id, account.id, db)


@router.post("/internal/resources/acquire", response_model=schemas.InternalAcquireResponse)
async def internal_acquire(body: schemas.InternalAcquireRequest, db: AsyncSession = Depends(get_session), _=Depends(verify_internal_key)):
    resources = await service.claim_resources(body.variant_id, body.quantity, db, order_id=None, duration_days=None)
    resource_ids = [r.id for r in resources]
    await log_event(
        db,
        "info",
        f"Internal acquire variant={body.variant_id} qty={body.quantity}",
        request_id=current_request_id(),
        metadata={
            "event": "internal_resources_acquired",
            "actor_type": "internal_service",
            "subject_type": "variant",
            "subject_id": body.variant_id,
            "outcome": "success",
            "source": "internal",
            "variant_id": body.variant_id,
            "quantity": body.quantity,
            "resource_ids": resource_ids,
            # Never include resource plaintext `data`.
        },
    )
    await db.commit()
    return schemas.InternalAcquireResponse(resources=[{"resource_id": r.id, "data": r.data} for r in resources])


@router.post("/internal/resources/release")
async def internal_release(body: schemas.InternalReleaseRequest, db: AsyncSession = Depends(get_session), _=Depends(verify_internal_key)):
    await service.release_resources(body.resource_ids, db)
    await log_event(
        db,
        "info",
        f"Internal release {len(body.resource_ids)} resources",
        request_id=current_request_id(),
        metadata={
            "event": "internal_resources_released",
            "actor_type": "internal_service",
            "subject_type": "resource",
            "subject_id": body.resource_ids[0] if body.resource_ids else None,
            "outcome": "success",
            "source": "internal",
            "resource_ids": list(body.resource_ids),
        },
    )
    await db.commit()
    return {"status": "released"}


@router.get("/orders/{order_id}/resources", response_model=list[schemas.ResourceResponse])
async def order_res(order_id: int, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.order_resources(order_id, account.id, db)


@router.post("/seller/resources/{resource_id}/error", response_model=schemas.ResourceResponse)
async def mark_error(resource_id: int, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.mark_resource_error(resource_id, account.id, db)


@router.get("/admin/resources", response_model=schemas.AdminResourceListResponse)
async def admin_resources(
    resource_status: ResourceStatus | None = Query(None, alias="status"),
    variant_id: int | None = Query(None, ge=1),
    product_id: int | None = Query(None, ge=1),
    seller_id: int | None = Query(None, ge=1),
    search: str | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_all_resources(
        db,
        status=resource_status,
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


@router.get("/admin/resources/sellers", response_model=list[schemas.ResourceSellerFacet])
async def res_seller_facet(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.resource_seller_facet(db)
