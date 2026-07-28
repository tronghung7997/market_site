import asyncio
import logging
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

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


# --- Seed TopProxy qua API (một lần lúc go-live) ---------------------------
# Chạy scripts/seed_topproxy.py dưới dạng SUBPROCESS thay vì import lại logic:
# script đã idempotent, đã qua thực chiến, và là nguồn sự thật duy nhất về
# danh mục sản phẩm/giá — nhân bản nó thành code endpoint là mời hai bản drift
# nhau. Subprocess kế thừa DATABASE_URL/ENCRYPTION_KEY của chính backend nên
# ghi đúng DB, mã hoá đúng key đang chạy.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_SEED_SCRIPT = _PROJECT_ROOT / "scripts" / "seed_topproxy.py"
_SEED_TIMEOUT_SECONDS = 180
# Chặn hai admin (hoặc double-click) chạy seed chồng nhau — script idempotent
# theo tuần tự, không idempotent theo song song.
_seed_lock = asyncio.Lock()


@router.post("/admin/providers/topproxy/seed", response_model=schemas.TopProxySeedResponse)
async def seed_topproxy(
    body: schemas.TopProxySeedRequest,
    _: Account = Depends(require_role("admin")),
):
    """Seed provider TopProxy + danh mục sản phẩm vào DB — thay cho việc ssh
    vào server chạy tay. Idempotent: chạy lại chỉ cập nhật, không tạo trùng.
    Sau lần seed này, đổi key TopProxy làm ở PUT /admin/providers/{id}."""
    if urlsplit(body.base_url).scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="base_url phải là http(s) URL")
    if body.xoay_get_url and urlsplit(body.xoay_get_url).scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="xoay_get_url phải là http(s) URL")
    if not _SEED_SCRIPT.exists():
        # Image build từ Dockerfile trước khi có `COPY scripts/` sẽ rơi vào đây.
        raise HTTPException(
            status_code=500,
            detail="Không tìm thấy scripts/seed_topproxy.py trong image — build lại image với Dockerfile mới",
        )
    if _seed_lock.locked():
        raise HTTPException(status_code=409, detail="Một lượt seed khác đang chạy — chờ nó xong")

    env = {
        **os.environ,
        "TOPPROXY_BASE_URL": body.base_url,
        "TOPPROXY_API_KEY": body.api_key,
        "TOPPROXY_SELLER_PASSWORD": body.seller_password,
    }
    if body.xoay_get_url:
        env["TOPPROXY_XOAY_GET_URL"] = body.xoay_get_url

    async with _seed_lock:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, str(_SEED_SCRIPT),
            cwd=str(_PROJECT_ROOT), env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        try:
            out, _stderr = await asyncio.wait_for(proc.communicate(), timeout=_SEED_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            proc.kill()
            raise HTTPException(status_code=504, detail="Seed chạy quá lâu và đã bị dừng — kiểm tra kết nối DB")

    output = out.decode(errors="replace")
    if proc.returncode != 0:
        # Thông điệp thất bại của script (preflight, lỗi DB) không chứa secret —
        # api_key không bao giờ được in ra.
        logger.error("topproxy_seed_failed rc=%s", proc.returncode)
        raise HTTPException(
            status_code=400,
            detail=f"Seed thất bại (exit {proc.returncode}): {output[-600:]}",
        )
    logger.info("topproxy_seed_ok base_url=%s", body.base_url)
    return schemas.TopProxySeedResponse(ok=True, output=output)


@router.post("/admin/providers/{provider_id}/test", response_model=schemas.ProviderTestResponse)
async def test_provider(
    provider_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await _run_provider_test(provider_id, db)


@router.put("/admin/providers/{provider_id}/credit", response_model=schemas.ProviderResponse)
async def update_provider_credit(
    provider_id: int,
    body: schemas.ProviderCreditUpdate,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """Nhập lại số dư Xu của tài khoản nhà cung cấp trả trước (TopProxy).

    TopProxy không có API xem số dư nên con số này phải do người nhập — hệ
    thống chỉ trừ dần theo giá vốn mỗi lệnh mua để cảnh báo trước khi cạn.
    Gọi endpoint này sau mỗi lần nạp Xu: nó bật lại provider và gỡ cảnh báo
    hết tiền luôn.
    """
    from src.providers.credit import set_credit_balance

    try:
        return await set_credit_balance(provider_id, body.balance_xu, body.low_threshold_xu, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


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
