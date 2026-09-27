from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["questions"])

StatusFilter = Literal["all", "pending", "answered", "hidden"]


@router.get("/products/{product_id}/questions", response_model=schemas.PublicQuestionList)
async def product_questions(
    product_id: int,
    page: int = Query(1, ge=1),
    per_page: int = Query(service.PUBLIC_PAGE_SIZE, ge=1, le=50),
    db: AsyncSession = Depends(get_session),
):
    return await service.public_questions(product_id, db, page=page, per_page=per_page)


@router.get("/products/{product_id}/questions/mine", response_model=list[schemas.MyQuestion])
async def my_product_questions(
    product_id: int,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.my_questions(account, product_id, db)


@router.post("/products/{product_id}/questions", response_model=schemas.MyQuestion, status_code=status.HTTP_201_CREATED)
async def ask_question(
    product_id: int,
    body: schemas.QuestionCreate,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.ask(account, product_id, body.question, db)


@router.get("/seller/questions", response_model=schemas.SellerQuestionList)
async def seller_questions(
    status_filter: StatusFilter = Query("all", alias="status"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    seller: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.seller_questions(seller.id, db, status_filter=status_filter, page=page, per_page=per_page)


@router.put("/seller/questions/{question_id}/answer", response_model=schemas.SellerQuestion)
async def answer_question(
    question_id: int,
    body: schemas.AnswerUpdate,
    seller: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.answer(seller, question_id, body.answer, db)


@router.patch("/seller/questions/{question_id}/visibility", response_model=schemas.SellerQuestion)
async def seller_question_visibility(
    question_id: int,
    body: schemas.VisibilityUpdate,
    seller: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.seller_set_visibility(seller, question_id, body.hidden, db)


@router.get("/admin/questions", response_model=schemas.SellerQuestionList)
async def admin_questions(
    status_filter: StatusFilter = Query("all", alias="status"),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.admin_questions(db, status_filter=status_filter, page=page, per_page=per_page)


@router.patch("/admin/questions/{question_id}/visibility", response_model=schemas.SellerQuestion)
async def admin_question_visibility(
    question_id: int,
    body: schemas.VisibilityUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.admin_set_visibility(admin, question_id, body.hidden, db)
