import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.base import ProvisionResult
from src.adapters.factory import get_adapter
from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["providers"])


@router.post("/admin/providers", response_model=schemas.ProviderResponse, status_code=status.HTTP_201_CREATED)
async def create(_body: schemas.ProviderCreate, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.create_provider(_body.model_dump(), db)


@router.get("/providers", response_model=list[schemas.ProviderResponse])
async def list_all(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.list_providers(db)


@router.get("/providers/{provider_id}/health", response_model=list[schemas.ProviderHealthResponse])
async def health(provider_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.get_health_history(provider_id, db)


@router.put("/admin/providers/{provider_id}", response_model=schemas.ProviderResponse)
async def update_provider(
    provider_id: int,
    body: schemas.ProviderUpdateRequest,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    updates = body.model_dump(exclude_unset=True)
    return await service.update_provider(provider_id, updates, db)


@router.post("/admin/providers/{provider_id}/test", response_model=schemas.ProviderTestResponse)
async def test_provider(
    provider_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        adapter = await get_adapter(provider_id, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    health_result = await adapter.check_health()

    provision_test = None
    if health_result.get("status") == "healthy":
        try:
            result: ProvisionResult = await adapter.provision(
                order_id=0, user_config={"test": True}
            )
            provision_test = {
                "success": result.success,
                "data": result.data,
                "error": result.error,
            }
        except Exception as e:
            logger.warning("Test provision failed for provider %s: %s", provider_id, e, exc_info=True)
            provision_test = {"success": False, "error": "Kết nối nhà cung cấp thất bại"}

    return schemas.ProviderTestResponse(
        health=health_result,
        provision_test=provision_test,
    )
