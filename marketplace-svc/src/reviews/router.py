from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["reviews"])


@router.post("/orders/{order_id}/review", response_model=schemas.ReviewResponse, status_code=status.HTTP_201_CREATED)
async def create_review(
    order_id: int,
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
    db: AsyncSession = Depends(get_session),
):
    return await service.get_product_reviews(product_id, db, page=page, per_page=per_page)


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
