from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.i18n.deps import get_request_locale
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["categories"])


@router.get("/categories", response_model=list[schemas.CategoryTreeResponse])
async def list_categories(
    locale: str = Depends(get_request_locale),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_categories_tree(db, locale=locale)


@router.get("/categories/{category_ref}/content", response_model=schemas.CategoryContentPublic)
async def category_content(
    category_ref: str,
    locale: str = Depends(get_request_locale),
    db: AsyncSession = Depends(get_session),
):
    """Description, guide and FAQ of an active category page (slug or legacy id)."""
    content = await service.get_public_category_content(category_ref, db, locale=locale)
    if content is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy danh mục")
    return content


@router.get("/categories/redirects", response_model=list[schemas.CategoryRedirectRow])
async def category_redirects(db: AsyncSession = Depends(get_session)):
    """Old slug → current slug of every renamed active category: the
    storefront proxy answers ``/categories/{old_slug}`` with a 301 from it."""
    return await service.list_redirects(db)


@router.get("/categories/{old_slug}/redirect", response_model=schemas.CategoryRedirectPublic)
async def category_redirect(old_slug: str, db: AsyncSession = Depends(get_session)):
    """Current slug of a category that used to be at ``old_slug`` (renamed or
    merged); 404 when the slug never moved. The storefront answers a 308."""
    slug = await service.resolve_redirect(old_slug, db)
    if slug is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy danh mục")
    return {"slug": slug}


@router.get("/admin/categories/{cat_id}/content", response_model=schemas.CategoryContentAdmin)
async def admin_category_content(cat_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.get_admin_category_content(cat_id, db)


@router.get("/admin/categories", response_model=schemas.CategoryAdminListResponse)
async def list_categories_admin(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.list_categories_admin(db)


@router.post("/admin/categories", response_model=schemas.CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(body: schemas.CategoryCreate, account: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.create_category(
        body.name, body.slug, body.icon, body.parent_id, body.sort_order, db,
        commission_rate=body.commission_rate, name_en=body.name_en,
        image_id=body.image_id, actor_id=account.id,
    )


@router.post("/admin/categories/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_categories(body: schemas.CategoryReorder, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    await service.reorder_categories(body.ids, db)


@router.patch("/admin/categories/{cat_id}", response_model=schemas.CategoryResponse)
async def update_category(cat_id: int, body: schemas.CategoryUpdate, account: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.update_category(cat_id, body.model_dump(exclude_unset=True), db, actor_id=account.id)


@router.delete("/admin/categories/{cat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(cat_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    await service.delete_category(cat_id, db)
