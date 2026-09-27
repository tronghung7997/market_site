from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.i18n.deps import get_request_locale
from src.models.account import Account

from . import schemas, service
from src.orders.refs import OrderRef

router = APIRouter(tags=["reviews"])


@router.post("/orders/{order_ref}/review", response_model=schemas.ReviewResponse, status_code=status.HTTP_201_CREATED)
async def create_review(
    order_id: OrderRef,
    body: schemas.ReviewCreate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.create_review(order_id, account.id, body.rating, body.comment, db)


@router.get("/products/{product_id}/reviews", response_model=schemas.PublicReviewList)
async def product_reviews(
    product_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(service.PUBLIC_REVIEW_PAGE_SIZE, ge=1, le=50),
    rating: int | None = Query(None, ge=1, le=5),
    db: AsyncSession = Depends(get_session),
):
    return await service.get_product_reviews(product_id, db, page=page, per_page=per_page, rating=rating)


@router.get("/reviews/latest", response_model=list[schemas.ShowcaseReview])
async def latest_reviews(
    limit: int = Query(service.LATEST_REVIEW_LIMIT, ge=1, le=service.LATEST_REVIEW_MAX),
    locale: str = Depends(get_request_locale),
    db: AsyncSession = Depends(get_session),
):
    return await service.get_latest_reviews(db, limit=limit, locale=locale)


@router.get("/sellers/{seller_ref}/reviews", response_model=schemas.SellerPublicReviewList)
async def seller_public_reviews(
    seller_ref: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(service.PUBLIC_REVIEW_PAGE_SIZE, ge=1, le=50),
    rating: int | None = Query(None, ge=1, le=5),
    locale: str = Depends(get_request_locale),
    db: AsyncSession = Depends(get_session),
):
    """Same ref forms and the same 404 as ``GET /sellers/{seller_ref}``."""
    result = await service.get_seller_public_reviews(
        seller_ref, db, page=page, per_page=per_page, rating=rating, locale=locale,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhà bán")
    return result


# --- seller ---------------------------------------------------------------------

@router.get("/seller/reviews", response_model=schemas.SellerReviewList)
async def seller_reviews(
    product_id: int | None = Query(None, ge=1),
    unreplied_only: bool = False,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_seller_reviews(
        account.id, db, product_id=product_id, unreplied_only=unreplied_only, page=page, per_page=per_page,
    )


@router.put("/seller/reviews/{review_id}/reply", response_model=schemas.SellerReviewRow)
async def seller_reply(
    review_id: int,
    body: schemas.SellerReviewReply,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.reply_to_review(review_id, account.id, body.body, db)


@router.delete("/seller/reviews/{review_id}/reply", response_model=schemas.SellerReviewRow)
async def seller_delete_reply(
    review_id: int,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.delete_review_reply(review_id, account.id, db)


# --- admin ----------------------------------------------------------------------

@router.get("/admin/reviews", response_model=schemas.AdminReviewList)
async def admin_reviews(
    product_id: int | None = Query(None, ge=1),
    hidden: bool | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_admin_reviews(db, product_id=product_id, hidden=hidden, page=page, per_page=per_page)


@router.patch("/admin/reviews/{review_id}/visibility", response_model=schemas.AdminReviewRow)
async def admin_review_visibility(
    review_id: int,
    body: schemas.AdminReviewVisibility,
    account: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await service.set_review_visibility(review_id, account.id, body.hidden, body.reason, db)
    return await service.get_admin_review(review_id, db)
