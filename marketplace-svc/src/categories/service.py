from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.i18n.catalog import DEFAULT_LOCALE, merge_i18n_locale, resolve_category_fields
from src.models.category import Category


async def create_category(name: str, slug: str, icon: str | None, parent_id: int | None, sort_order: int, db: AsyncSession, commission_rate: float | None = None) -> Category:
    existing = await db.scalar(select(Category).where(Category.slug == slug))
    if existing:
        raise HTTPException(status_code=409, detail="Slug này đã tồn tại")
    if parent_id:
        parent = await db.get(Category, parent_id)
        if not parent:
            raise HTTPException(status_code=404, detail="Không tìm thấy danh mục cha")
    # Admin still creates categories in the operational language (VI today);
    # EN names are backfilled / set later. Mirror into i18n.vi for consistency.
    cat = Category(
        name=name,
        slug=slug,
        icon=icon,
        parent_id=parent_id,
        sort_order=sort_order,
        commission_rate=commission_rate,
        i18n=merge_i18n_locale({}, "vi", {"name": name}),
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


async def update_category(cat_id: int, data: dict, db: AsyncSession) -> Category:
    cat = await db.get(Category, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Không tìm thấy danh mục")
    icon_provided = "icon" in data
    icon_value = data.pop("icon", None)
    for key, value in data.items():
        if value is not None:
            setattr(cat, key, value)
    if icon_provided:
        cat.icon = icon_value
    if "name" in data and data["name"] is not None:
        cat.i18n = merge_i18n_locale(cat.i18n, "vi", {"name": data["name"]})
    await db.commit()
    await db.refresh(cat)
    return cat


async def delete_category(cat_id: int, db: AsyncSession) -> None:
    cat = await db.get(Category, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Không tìm thấy danh mục")
    from src.models.product import Product
    has_products = await db.scalar(select(Product).where(Product.category_id == cat_id).limit(1))
    if has_products:
        raise HTTPException(status_code=400, detail="Danh mục đang có sản phẩm, không thể xoá")
    await db.delete(cat)
    await db.commit()


async def list_categories_tree(db: AsyncSession, locale: str = DEFAULT_LOCALE) -> list[dict]:
    result = await db.execute(select(Category).where(Category.is_active).order_by(Category.sort_order))
    all_cats = list(result.scalars().all())
    by_parent: dict[int | None, list] = {}
    for cat in all_cats:
        by_parent.setdefault(cat.parent_id, []).append(cat)

    def build_tree(parent_id: int | None) -> list[dict]:
        children = by_parent.get(parent_id, [])
        nodes = []
        for c in children:
            localized = resolve_category_fields(c, locale)
            nodes.append({
                "id": c.id,
                "name": localized["name"],
                "slug": c.slug,
                "icon": c.icon,
                "parent_id": c.parent_id,
                "sort_order": c.sort_order,
                "is_active": c.is_active,
                "commission_rate": c.commission_rate,
                "locale": localized["locale"],
                "available_locales": localized["available_locales"],
                "children": build_tree(c.id),
            })
        return nodes

    return build_tree(None)
