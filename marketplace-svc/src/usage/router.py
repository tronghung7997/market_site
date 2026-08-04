from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, verify_internal_key
from src.audit.service import log_event
from src.database import get_session
from src.logging import current_request_id
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["usage"])


@router.post("/orders/{order_id}/usage", response_model=schemas.ChargeUsageResponse)
async def charge_order_usage(
    order_id: int,
    body: schemas.ChargeUsageRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.charge_usage_as(
        order_id, account, body.endpoint, body.units, db, request_id=body.request_id,
    )


@router.post("/internal/usage/charge", response_model=schemas.ChargeUsageResponse)
async def internal_charge_usage(
    body: schemas.InternalChargeUsageRequest,
    db: AsyncSession = Depends(get_session),
    _=Depends(verify_internal_key),
):
    """Chỗ để một gateway/proxy thật (chưa có hôm nay) cắm vào sau này — xác
    thực bằng khoá nội bộ, không qua tài khoản buyer, giống các endpoint
    `/internal/resources/*`."""
    result = await service.charge_usage(
        body.order_id, body.endpoint, body.units, db, request_id=body.request_id,
    )
    await log_event(
        db,
        "warning",
        "Internal usage charged",
        request_id=current_request_id(),
        metadata={
            "order_id": body.order_id,
            "endpoint": body.endpoint,
            "units": body.units,
        },
    )
    await db.commit()
    return result
