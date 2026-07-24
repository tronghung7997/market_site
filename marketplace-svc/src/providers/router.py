import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.base import ProvisionResult
from src.adapters.dproxy import DProxyAdapter
from src.adapters.factory import get_adapter
from src.adapters.topproxy import TopProxyAdapter
from src.auth.dependencies import require_min_seller_tier, require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["providers"])


async def _run_provider_test(provider_id: int, db: AsyncSession) -> schemas.ProviderTestResponse:
    """Shared by the admin test button and the seller self-service test button
    (spec 2026-07-21: "seller tự chạy contract test trước khi nộp admin
    duyệt") — same check, same result shape, whoever is looking at it."""
    try:
        adapter = await get_adapter(provider_id, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    health_result = await adapter.check_health()

    provision_test = None
    # provision() có SIDE EFFECT THẬT với proxy-adapter mua-theo-đơn:
    # - DProxy: bind một assignment sống vào order_id (chiếm mất của buyer sau).
    # - TopProxy: gọi muaproxy.php / apimua*.php — TRỪ XU THẬT của tài khoản
    #   reseller để mua một proxy/key cho một order không tồn tại (order_id=0).
    # Với cả hai, check_health() (một lệnh list read-only) đã là bài test đúng —
    # xác nhận base_url + api_key hoạt động mà không tiêu tiền. Không bao giờ
    # gọi provision() ở nút test cho các adapter này.
    _has_purchase_side_effect = isinstance(adapter, (DProxyAdapter, TopProxyAdapter))
    if health_result.get("status") == "healthy" and not _has_purchase_side_effect:
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
    return await _run_provider_test(provider_id, db)


@router.post("/admin/providers/{provider_id}/approve", response_model=schemas.ProviderResponse)
async def approve_provider(
    provider_id: int,
    body: schemas.AdminProviderReview,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.review_provider(provider_id, "approved", body.note, db)


@router.post("/admin/providers/{provider_id}/reject", response_model=schemas.ProviderResponse)
async def reject_provider(
    provider_id: int,
    body: schemas.AdminProviderReview,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.review_provider(provider_id, "rejected", body.note, db)


# ---------------------------------------------------------------------------
# Seller self-service — spec 2026-07-21 mục "Trạng thái triển khai", Phần A.
# Gated behind seller tier "trusted", cùng ngưỡng với seller_api_keys — đăng
# ký một backend ngoài để platform gọi thay mặt buyer là năng lực nhạy cảm
# tương đương, không mở đại trà cho seller mới.
# ---------------------------------------------------------------------------


@router.post("/seller/providers", response_model=schemas.ProviderResponse, status_code=status.HTTP_201_CREATED)
async def create_seller_provider(
    body: schemas.SellerProviderCreate,
    account: Account = Depends(require_min_seller_tier("trusted")),
    db: AsyncSession = Depends(get_session),
):
    return await service.create_seller_provider(account.id, body.model_dump(), db)


@router.get("/seller/providers", response_model=list[schemas.ProviderResponse])
async def list_seller_providers(
    account: Account = Depends(require_min_seller_tier("trusted")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_seller_providers(account.id, db)


@router.get("/seller/providers/{provider_id}", response_model=schemas.ProviderResponse)
async def get_seller_provider(
    provider_id: int,
    account: Account = Depends(require_min_seller_tier("trusted")),
    db: AsyncSession = Depends(get_session),
):
    return await service.get_seller_provider(account.id, provider_id, db)


@router.put("/seller/providers/{provider_id}", response_model=schemas.ProviderResponse)
async def update_seller_provider(
    provider_id: int,
    body: schemas.SellerProviderUpdate,
    account: Account = Depends(require_min_seller_tier("trusted")),
    db: AsyncSession = Depends(get_session),
):
    updates = body.model_dump(exclude_unset=True)
    return await service.update_seller_provider(account.id, provider_id, updates, db)


@router.post("/seller/providers/{provider_id}/test", response_model=schemas.ProviderTestResponse)
async def test_seller_provider(
    provider_id: int,
    account: Account = Depends(require_min_seller_tier("trusted")),
    db: AsyncSession = Depends(get_session),
):
    # Ownership check trước — không cho seller dò sức khoẻ provider người khác
    # chỉ bằng cách đoán provider_id.
    await service.get_seller_provider(account.id, provider_id, db)
    return await _run_provider_test(provider_id, db)
