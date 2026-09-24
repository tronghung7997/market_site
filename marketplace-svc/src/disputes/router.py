from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.models.account import Account

from . import admin_case, schemas, service
from src.orders.codes import mask_email
from src.orders.refs import OrderRef


def _seller_view(row):
    """Seller-facing dispute: the buyer's email is masked (contact goes through order chat)."""
    if isinstance(row, dict) and "buyer_email" in row:
        return {**row, "buyer_email": mask_email(row.get("buyer_email"))}
    return row


def _seller_page(page: dict) -> dict:
    return {**page, "items": [_seller_view(item) for item in page.get("items", [])]}


def _buyer_view(row):
    """Buyer-facing dispute: no email echo at all (it is their own address)."""
    if isinstance(row, dict) and "buyer_email" in row:
        return {**row, "buyer_email": None}
    return row

router = APIRouter(tags=["disputes"])


@router.post("/orders/{order_ref}/dispute", response_model=schemas.DisputeResponse, status_code=status.HTTP_201_CREATED)
async def create_dispute(order_id: OrderRef, body: schemas.DisputeCreate, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return _buyer_view(await service.create_dispute(
        order_id, account.id, body.reason, db,
        evidence_type=body.evidence_type,
        evidence=body.evidence,
        resource_ids=body.resource_ids,
        idempotency_key=body.idempotency_key,
    ))


@router.get("/orders/{order_ref}/dispute", response_model=schemas.DisputeResponse)
async def buyer_get_dispute(order_id: OrderRef, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    result = _buyer_view(await service.get_buyer_dispute(order_id, account.id, db))
    if not result:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return result


@router.get("/seller/orders/{order_ref}/dispute", response_model=schemas.DisputeResponse)
async def seller_get_dispute(order_id: OrderRef, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    result = _seller_view(await service.get_seller_dispute(order_id, account.id, db))
    if not result:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return result


@router.post("/seller/disputes/{dispute_id}/respond", response_model=schemas.DisputeResponse)
async def seller_respond(dispute_id: int, body: schemas.SellerDisputeRespond, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return _seller_view(await service.seller_respond_dispute(dispute_id, account.id, body.seller_note, db))


@router.post("/orders/{order_ref}/dispute/claims", response_model=schemas.DisputeResponse)
async def append_claims(order_id: OrderRef, body: schemas.DisputeClaimAppend, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return _buyer_view(await service.append_claim_batch(
        order_id,
        account.id,
        body.resource_ids,
        body.reason,
        body.idempotency_key,
        db,
    ))


@router.post("/orders/{order_ref}/dispute/messages", response_model=schemas.DisputeResponse)
async def buyer_message(order_id: OrderRef, body: schemas.DisputeMessageCreate, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return _buyer_view(await service.append_buyer_message(
        order_id,
        account.id,
        body.body,
        body.idempotency_key,
        db,
    ))


@router.post("/orders/{order_ref}/dispute/accept", response_model=schemas.DisputeResponse)
async def buyer_accept(order_id: OrderRef, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return _buyer_view(await service.accept_dispute_resolution(order_id, account.id, db))


@router.post("/orders/{order_ref}/dispute/withdraw", response_model=schemas.DisputeResponse)
async def buyer_withdraw(order_id: OrderRef, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return _buyer_view(await service.withdraw_dispute(order_id, account.id, db))


@router.post("/orders/{order_ref}/dispute/escalate", response_model=schemas.DisputeResponse)
async def escalate_dispute(
    order_id: OrderRef,
    body: schemas.DisputeEscalate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return _buyer_view(await service.request_marketplace_review(
        account,
        body.note,
        body.idempotency_key,
        db,
        order_id=order_id,
    ))


@router.get("/seller/disputes")
async def seller_disputes(page: int = Query(1, ge=1), per_page: int = Query(100, ge=1, le=100), account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return _seller_page(await service.list_seller_disputes(account.id, db, page=page, per_page=per_page))


@router.post("/seller/disputes/{dispute_id}/resources/action")
async def seller_resource_action(dispute_id: int, body: schemas.SellerResourceAction, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return _seller_view(await service.seller_resolve_resources(
        dispute_id,
        account.id,
        body.resource_ids,
        body.action,
        body.replacement_resource_ids,
        body.idempotency_key,
        db,
        seller_note=body.seller_note,
    ))


@router.post("/seller/disputes/{dispute_id}/escalate", response_model=schemas.DisputeResponse)
async def seller_escalate(dispute_id: int, body: schemas.SellerDisputeEscalate, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return _seller_view(await service.seller_escalate_dispute(
        dispute_id, account.id, body.seller_note, body.idempotency_key, db
    ))


@router.get("/seller/disputes/{dispute_id}/replacement-resources")
async def seller_replacement_resource_list(
    dispute_id: int,
    search: str | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    ids_only: bool = False,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.seller_replacement_resources(
        dispute_id,
        account.id,
        db,
        search=search,
        page=page,
        per_page=per_page,
        ids_only=ids_only,
    )


@router.get("/seller/disputes/{dispute_id}/resources")
async def seller_dispute_resource_list(
    dispute_id: int,
    search: str | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    pending_only: bool = False,
    ids_only: bool = False,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.seller_dispute_resources(
        dispute_id,
        account.id,
        db,
        search=search,
        page=page,
        per_page=per_page,
        pending_only=pending_only,
        ids_only=ids_only,
    )


@router.get("/admin/disputes", response_model=schemas.DisputeListResponse)
async def list_disputes(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_disputes(db, page=page, per_page=per_page)


@router.get("/admin/disputes/{dispute_id}", response_model=schemas.DisputeResponseFull)
async def get_dispute(dispute_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.get_dispute_detail(dispute_id, db)


@router.get("/admin/disputes/{dispute_id}/case", response_model=schemas.AdminDisputeCase)
async def get_dispute_case(dispute_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    """The admin case file: full timeline, per-line state, both parties'
    record, money at stake, signals and a suggested next step."""
    return await admin_case.admin_case(dispute_id, db)


@router.post("/admin/disputes/{dispute_id}/refund", response_model=schemas.DisputeResponse)
async def refund(dispute_id: int, body: schemas.AdminDisputeAction, account: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.refund_dispute(dispute_id, body.admin_note, db, admin_id=account.id)


@router.post("/admin/disputes/{dispute_id}/reject", response_model=schemas.DisputeResponse)
async def reject(dispute_id: int, body: schemas.AdminDisputeAction, account: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.reject_dispute(dispute_id, body.admin_note, db, admin_id=account.id)


@router.post("/admin/disputes/{dispute_id}/partial-refund", response_model=schemas.DisputeResponse)
async def partial_refund(dispute_id: int, body: schemas.AdminDisputePartialRefund, account: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.partial_refund_dispute(dispute_id, body.admin_note, body.refund_amount, db, admin_id=account.id)


@router.post("/admin/disputes/{dispute_id}/replace", response_model=schemas.DisputeResponse)
async def replace(dispute_id: int, body: schemas.AdminDisputeAction, account: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.replace_dispute(dispute_id, body.admin_note, db, admin_id=account.id)


@router.post("/admin/disputes/{dispute_id}/extend-warranty", response_model=schemas.DisputeResponse)
async def extend_warranty(dispute_id: int, body: schemas.AdminDisputeExtendWarranty, account: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.extend_warranty_dispute(dispute_id, body.admin_note, body.extra_days, db, admin_id=account.id)
