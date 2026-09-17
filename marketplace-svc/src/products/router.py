from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.exceptions import ErrorCode, api_error
from src.i18n.deps import get_request_locale
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["products"])


@router.get("/product-covers", response_model=schemas.ProductCoverCatalogResponse)
async def list_product_covers():
    return service.list_product_covers()


@router.get("/products", response_model=schemas.ProductListPageResponse)
async def list_products(
    category_id: int | None = Query(None, description="Lọc theo danh mục VÀ toàn bộ danh mục con"),
    seller: str | None = Query(None, min_length=1, max_length=200, description="Lọc theo nhà bán: {handle}-{key} hoặc key"),
    search: str | None = Query(None, min_length=1, max_length=100),
    in_stock: bool = Query(False),
    fulfillment: Literal["instant"] | None = Query(None),
    min_price: int | None = Query(None, ge=0),
    max_price: int | None = Query(None, ge=0),
    sort: Literal["relevance", "newest", "bestseller", "rating", "price_asc", "price_desc"] = Query("newest"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    locale: str = Depends(get_request_locale),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_products(
        db,
        category_id=category_id,
        seller=seller,
        search=search,
        in_stock=in_stock,
        fulfillment=fulfillment,
        min_price=min_price,
        max_price=max_price,
        sort=sort,
        page=page,
        per_page=per_page,
        locale=locale,
    )


@router.get("/products/shelves", response_model=schemas.CategoryShelvesResponse)
async def product_shelves(
    per_shelf: int = Query(8, ge=1, le=24),
    locale: str = Depends(get_request_locale),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_category_shelves(db, per_shelf=per_shelf, locale=locale)


@router.get("/products/catalog-summary", response_model=schemas.ProductCatalogSummaryResponse)
async def product_catalog_summary(db: AsyncSession = Depends(get_session)):
    return await service.get_product_catalog_summary(db)


@router.get("/products/{product_ref}", response_model=schemas.ProductDetailResponse)
async def get_product(
    product_ref: str,
    locale: str = Depends(get_request_locale),
    db: AsyncSession = Depends(get_session),
):
    """Public detail by ``{slug}-{public_key}``, bare key, or legacy integer id.

    The integer form stays so old bookmarks, chat history and indexed pages
    resolve; the frontend redirects them to ``canonical_path``. Unparseable
    refs and unknown keys both answer 404 without revealing which."""
    product = await service.resolve_product_ref(product_ref, db)
    if product is None:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return await service.get_product_detail(product.id, db, locale=locale, public=True)


@router.get("/seller/products/{product_ref}/detail", response_model=schemas.ProductDetailResponse)
async def get_own_product(product_ref: str, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    """Như /products/{id} nhưng kèm cả gói đã tắt — trang quản lý cần thấy chúng
    để bật lại được. Nhận public key (URL /seller/products/{key}) hoặc id cũ."""
    product = await service.resolve_product_ref(product_ref, db)
    if product is None:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return await service.get_own_product_detail(product.id, account.id, db)


@router.get("/seller/products", response_model=schemas.SellerProductListResponse)
async def seller_products(
    search: str | None = None,
    status: Literal["active", "paused", "draft", "low_stock", "out_of_stock"] | None = Query(None),
    category: str | None = None,
    category_ids: str | None = Query(None, description="Comma-separated category ids; a parent means its whole branch"),
    service_type: str | None = None,
    sort: Literal[
        "newest", "oldest", "title", "stock_asc", "stock_desc", "sold_desc", "rating_desc", "price_asc", "price_desc",
    ] = Query("newest"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_seller_products(
        account.id, db, search=search, status=status, category=category,
        category_ids=_id_list(category_ids),
        service_type=service_type, sort=sort, page=page, per_page=per_page,
    )


def _id_list(raw: str | None) -> list[int] | None:
    if not raw:
        return None
    out = [int(part) for part in (piece.strip() for piece in raw.split(",")) if part.isdigit()]
    return out or None


@router.post("/seller/products/bulk-status", response_model=schemas.SellerProductBulkStatusResponse)
async def bulk_update_own_product_status(
    body: schemas.SellerProductBulkStatusRequest,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.bulk_update_seller_product_status(body.ids, account.id, body.status, db)


@router.get("/seller/stats")
async def seller_stats(account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.get_seller_stats(account.id, db)


@router.post("/seller/products", response_model=schemas.ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(body: schemas.ProductCreate, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.create_product(account.id, body.model_dump(), db)


@router.patch("/seller/products/{product_id}", response_model=schemas.ProductResponse)
async def update_product(product_id: int, body: schemas.SellerProductUpdate, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.update_product(product_id, account.id, body.model_dump(exclude_unset=True), db)


@router.put(
    "/seller/products/{product_id}/status",
    response_model=schemas.ProductResponse,
)
async def update_own_product_status(
    product_id: int,
    body: schemas.SellerProductStatusUpdate,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_seller_product_status(product_id, account.id, body.status, db)


@router.patch(
    "/seller/products/{product_id}/translations/{locale}",
    response_model=schemas.ProductResponse,
)
async def update_own_product_translation(
    product_id: int,
    locale: Literal["en", "vi"],
    body: schemas.ProductTranslationUpdate,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_product_translation(
        product_id, locale, body.model_dump(exclude_unset=True), db, seller_id=account.id,
    )


@router.delete("/seller/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(product_id: int, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    await service.delete_product(product_id, account.id, db)


@router.post("/seller/products/{product_id}/variants", response_model=schemas.VariantResponse, status_code=status.HTTP_201_CREATED)
async def create_variant(product_id: int, body: schemas.VariantCreate, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.create_variant(product_id, account.id, body.model_dump(), db)


@router.patch("/seller/variants/{variant_id}", response_model=schemas.VariantResponse)
async def update_variant(variant_id: int, body: schemas.VariantUpdate, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.update_variant(variant_id, account.id, body.model_dump(exclude_unset=True), db)


@router.patch(
    "/seller/variants/{variant_id}/translations/{locale}",
    response_model=schemas.VariantResponse,
)
async def update_variant_translation(
    variant_id: int,
    locale: Literal["en", "vi"],
    body: schemas.VariantTranslationUpdate,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_variant_translation(
        variant_id, account.id, locale, body.name, db,
    )


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


@router.get("/admin/products", response_model=schemas.AdminProductListResponse)
async def list_all_products(
    search: str | None = None,
    status: Literal["active", "draft", "paused", "suspended", "needs_setup"] | None = Query(None),
    seller: str | None = None,
    provider: str | None = None,
    service_type: str | None = None,
    has_provider: bool | None = Query(None),
    sort_by: Literal[
        "created_at", "title", "status", "service_type", "seller_email",
        "provider_name", "order_count", "revenue",
    ] | None = Query(None),
    sort_dir: Literal["asc", "desc"] = Query("desc"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_all_products_admin(
        db, search=search, status=status, seller=seller, provider=provider,
        service_type=service_type, has_provider=has_provider,
        sort_by=sort_by, sort_dir=sort_dir, page=page, per_page=per_page,
    )


@router.get("/admin/products/{product_id}", response_model=schemas.AdminProductDetailResponse)
async def admin_get_product(
    product_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """Như GET /products/{id} nhưng kèm commission_rate — trường này đã rút
    khỏi response public (hoa hồng là thoả thuận admin↔seller, buyer/đối thủ
    không cần thấy), trang admin sửa sản phẩm đọc từ đây.

    ``localize=False`` so the edit form sees stored scalars, not storefront EN.
    """
    return await service.get_product_detail(product_id, db, localize=False)


@router.patch("/admin/products/{product_id}", response_model=schemas.ProductResponse)
async def admin_update_product(
    product_id: int,
    body: schemas.ProductUpdate,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.admin_update_product(product_id, body.model_dump(exclude_unset=True), db)


@router.patch(
    "/admin/products/{product_id}/translations/{locale}",
    response_model=schemas.ProductResponse,
)
async def admin_update_product_translation(
    product_id: int,
    locale: Literal["en", "vi"],
    body: schemas.ProductTranslationUpdate,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_product_translation(
        product_id, locale, body.model_dump(exclude_unset=True), db,
    )


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
