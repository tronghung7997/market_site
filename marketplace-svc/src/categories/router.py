from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["categories"])


@router.get("/categories", response_model=list[schemas.CategoryTreeResponse])
async def list_categories(db: AsyncSession = Depends(get_session)):
    return await service.list_categories_tree(db)


@router.post("/admin/categories", response_model=schemas.CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(body: schemas.CategoryCreate, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.create_category(body.name, body.slug, body.icon, body.parent_id, body.sort_order, db, commission_rate=body.commission_rate)


@router.patch("/admin/categories/{cat_id}", response_model=schemas.CategoryResponse)
async def update_category(cat_id: int, body: schemas.CategoryUpdate, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.update_category(cat_id, body.model_dump(exclude_unset=True), db)


@router.delete("/admin/categories/{cat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(cat_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    await service.delete_category(cat_id, db)
