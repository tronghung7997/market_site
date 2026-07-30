from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["products"])


@router.get("/products", response_model=schemas.ProductListPageResponse)
async def list_products(
    category_id: int | None = Query(None, description="Lọc theo danh mục VÀ toàn bộ danh mục con"),
    seller_id: int | None = Query(None),
    page: int | None = Query(None, ge=1, description="Bỏ trống = trả toàn bộ (không phân trang)"),
    per_page: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_products(
        db, category_id=category_id, seller_id=seller_id, page=page, per_page=per_page,
    )


@router.get("/products/{product_id}", response_model=schemas.ProductDetailResponse)
async def get_product(product_id: int, db: AsyncSession = Depends(get_session)):
    return await service.get_product_detail(product_id, db)


@router.get("/seller/products/{product_id}/detail", response_model=schemas.ProductDetailResponse)
async def get_own_product(product_id: int, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    """Như /products/{id} nhưng kèm cả gói đã tắt — trang quản lý cần thấy chúng
    để bật lại được."""
    return await service.get_own_product_detail(product_id, account.id, db)


@router.get("/seller/products", response_model=list[schemas.SellerProductResponse])
async def seller_products(account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.list_seller_products(account.id, db)


@router.get("/seller/stats")
async def seller_stats(account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.get_seller_stats(account.id, db)


@router.post("/seller/products", response_model=schemas.ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(body: schemas.ProductCreate, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.create_product(account.id, body.model_dump(), db)


@router.patch("/seller/products/{product_id}", response_model=schemas.ProductResponse)
async def update_product(product_id: int, body: schemas.ProductUpdate, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.update_product(product_id, account.id, body.model_dump(exclude_unset=True), db)


@router.delete("/seller/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(product_id: int, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    await service.delete_product(product_id, account.id, db)


@router.post("/seller/products/{product_id}/variants", response_model=schemas.VariantResponse, status_code=status.HTTP_201_CREATED)
async def create_variant(product_id: int, body: schemas.VariantCreate, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.create_variant(product_id, account.id, body.model_dump(), db)


@router.patch("/seller/variants/{variant_id}", response_model=schemas.VariantResponse)
async def update_variant(variant_id: int, body: schemas.VariantUpdate, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.update_variant(variant_id, account.id, body.model_dump(exclude_unset=True), db)


@router.delete("/seller/variants/{variant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_variant(variant_id: int, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    await service.delete_variant(variant_id, account.id, db)


@router.put("/seller/products/{product_id}/pricing", response_model=schemas.ProductResponse)
async def set_seller_pricing(
    product_id: int,
    body: schemas.SellerPricingUpdate,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_seller_pricing(product_id, account.id, body.model_dump(exclude_unset=True), db)


@router.get("/admin/products")
async def list_all_products(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_all_products_admin(db)


@router.get("/admin/products/{product_id}", response_model=schemas.AdminProductDetailResponse)
async def admin_get_product(
    product_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """Như GET /products/{id} nhưng kèm commission_rate — trường này đã rút
    khỏi response public (hoa hồng là thoả thuận admin↔seller, buyer/đối thủ
    không cần thấy), trang admin sửa sản phẩm đọc từ đây."""
    return await service.get_product_detail(product_id, db)


@router.patch("/admin/products/{product_id}", response_model=schemas.ProductResponse)
async def admin_update_product(
    product_id: int,
    body: schemas.ProductUpdate,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.admin_update_product(product_id, body.model_dump(exclude_unset=True), db)


@router.put("/admin/products/{product_id}/operations")
async def update_product_operations(
    product_id: int,
    body: schemas.ProductOperationsUpdate,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_product_operations(product_id, body.model_dump(exclude_unset=True), db)


@router.post("/admin/products/{product_id}/suspend", response_model=schemas.ProductResponse)
async def suspend_product(product_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.suspend_product(product_id, db)
