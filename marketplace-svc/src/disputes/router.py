from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["disputes"])


@router.post("/orders/{order_id}/dispute", response_model=schemas.DisputeResponse, status_code=status.HTTP_201_CREATED)
async def create_dispute(order_id: int, body: schemas.DisputeCreate, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.create_dispute(order_id, account.id, body.reason, db)


@router.get("/orders/{order_id}/dispute", response_model=schemas.DisputeResponse)
async def buyer_get_dispute(order_id: int, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    result = await service.get_buyer_dispute(order_id, account.id, db)
    if not result:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")
    return result


@router.get("/seller/orders/{order_id}/dispute", response_model=schemas.DisputeResponse)
async def seller_get_dispute(order_id: int, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    result = await service.get_seller_dispute(order_id, account.id, db)
    if not result:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")
    return result


@router.post("/seller/disputes/{dispute_id}/respond", response_model=schemas.DisputeResponse)
async def seller_respond(dispute_id: int, body: schemas.SellerDisputeRespond, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.seller_respond_dispute(dispute_id, account.id, body.seller_note, db)


@router.get("/admin/disputes", response_model=list[schemas.DisputeResponse])
async def list_disputes(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.list_disputes(db)


@router.get("/admin/disputes/{dispute_id}", response_model=schemas.DisputeResponseFull)
async def get_dispute(dispute_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.get_dispute_detail(dispute_id, db)


@router.post("/admin/disputes/{dispute_id}/refund", response_model=schemas.DisputeResponse)
async def refund(dispute_id: int, body: schemas.AdminDisputeAction, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.refund_dispute(dispute_id, body.admin_note, db)


@router.post("/admin/disputes/{dispute_id}/reject", response_model=schemas.DisputeResponse)
async def reject(dispute_id: int, body: schemas.AdminDisputeAction, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.reject_dispute(dispute_id, body.admin_note, db)


@router.post("/admin/disputes/{dispute_id}/partial-refund", response_model=schemas.DisputeResponse)
async def partial_refund(dispute_id: int, body: schemas.AdminDisputePartialRefund, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.partial_refund_dispute(dispute_id, body.admin_note, body.refund_amount, db)


@router.post("/admin/disputes/{dispute_id}/replace", response_model=schemas.DisputeResponse)
async def replace(dispute_id: int, body: schemas.AdminDisputeAction, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.replace_dispute(dispute_id, body.admin_note, db)


@router.post("/admin/disputes/{dispute_id}/extend-warranty", response_model=schemas.DisputeResponse)
async def extend_warranty(dispute_id: int, body: schemas.AdminDisputeExtendWarranty, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.extend_warranty_dispute(dispute_id, body.admin_note, body.extra_days, db)
