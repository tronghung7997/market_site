from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.i18n.catalog import DEFAULT_LOCALE, merge_i18n_locale, resolve_category_fields
from src.i18n.search_text import normalize_query, search_terms
from src.models.category import Category


async def create_category(
    name: str, slug: str, icon: str | None, parent_id: int | None, sort_order: int, db: AsyncSession,
    commission_rate: float | None = None, name_en: str | None = None,
) -> Category:
    existing = await db.scalar(select(Category).where(Category.slug == slug))
    if existing:
        raise HTTPException(status_code=409, detail="Slug này đã tồn tại")
    if parent_id:
        parent = await db.get(Category, parent_id)
        if not parent:
            raise HTTPException(status_code=404, detail="Không tìm thấy danh mục cha")
    # Admin still creates categories in the operational language (VI today);
    # EN names are backfilled / set later. Mirror into i18n.vi for consistency.
    i18n = merge_i18n_locale({}, "vi", {"name": name})
    if name_en and name_en.strip():
        i18n = merge_i18n_locale(i18n, "en", {"name": name_en.strip()})
    if sort_order == 0:
        # Append after the current last sibling so a new category lands at the end.
        last = await db.scalar(select(func.max(Category.sort_order)).where(Category.parent_id == parent_id))
        sort_order = (last or 0) + 1
    cat = Category(
        name=name,
        slug=slug,
        icon=icon,
        parent_id=parent_id,
        sort_order=sort_order,
        commission_rate=commission_rate,
        i18n=i18n,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


async def _descendant_ids(cat_id: int, db: AsyncSession) -> set[int]:
    """Every descendant id (active or not) — used to refuse cyclic moves."""
    rows = (await db.execute(select(Category.id, Category.parent_id))).all()
    children: dict[int | None, list[int]] = {}
    for cid, pid in rows:
        children.setdefault(pid, []).append(cid)
    out: set[int] = set()
    stack = list(children.get(cat_id, []))
    while stack:
        current = stack.pop()
        if current in out:
            continue
        out.add(current)
        stack.extend(children.get(current, []))
    return out


async def update_category(cat_id: int, data: dict, db: AsyncSession) -> Category:
    cat = await db.get(Category, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Không tìm thấy danh mục")
    icon_provided = "icon" in data
    icon_value = data.pop("icon", None)
    name_en_provided = "name_en" in data
    name_en = data.pop("name_en", None)
    if "parent_id" in data:
        new_parent = data.pop("parent_id")
        if new_parent is not None:
            if new_parent == cat_id or new_parent in await _descendant_ids(cat_id, db):
                raise HTTPException(status_code=400, detail="Không thể chuyển danh mục vào chính nó hoặc danh mục con của nó")
            if not await db.get(Category, new_parent):
                raise HTTPException(status_code=404, detail="Không tìm thấy danh mục cha")
        if new_parent != cat.parent_id:
            cat.parent_id = new_parent
            last = await db.scalar(select(func.max(Category.sort_order)).where(Category.parent_id == new_parent))
            cat.sort_order = (last or 0) + 1
    if "slug" in data and data["slug"] is not None and data["slug"] != cat.slug:
        taken = await db.scalar(select(Category.id).where(Category.slug == data["slug"], Category.id != cat_id))
        if taken:
            raise HTTPException(status_code=409, detail="Slug này đã tồn tại")
    for key, value in data.items():
        if value is not None:
            setattr(cat, key, value)
    if icon_provided:
        cat.icon = icon_value
    if "name" in data and data["name"] is not None:
        cat.i18n = merge_i18n_locale(cat.i18n, "vi", {"name": data["name"]})
    if name_en_provided:
        cleaned = (name_en or "").strip() or None
        cat.i18n = merge_i18n_locale(cat.i18n, "en", {"name": cleaned})
    await db.commit()
    await db.refresh(cat)
    return cat


async def reorder_categories(ids: list[int], db: AsyncSession) -> None:
    """Assign sort_order by position; the ids must all be siblings."""
    rows = (await db.execute(select(Category).where(Category.id.in_(ids)))).scalars().all()
    if len(rows) != len(set(ids)):
        raise HTTPException(status_code=404, detail="Không tìm thấy danh mục")
    if len({c.parent_id for c in rows}) > 1:
        raise HTTPException(status_code=400, detail="Chỉ sắp xếp được các danh mục cùng cấp")
    position = {cid: idx for idx, cid in enumerate(ids)}
    for cat in rows:
        cat.sort_order = position[cat.id]
    await db.commit()


async def delete_category(cat_id: int, db: AsyncSession) -> None:
    cat = await db.get(Category, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Không tìm thấy danh mục")
    from src.models.product import Product
    has_products = await db.scalar(select(Product).where(Product.category_id == cat_id).limit(1))
    if has_products:
        raise HTTPException(status_code=400, detail="Danh mục đang có sản phẩm, không thể xoá")
    has_children = await db.scalar(select(Category.id).where(Category.parent_id == cat_id).limit(1))
    if has_children:
        raise HTTPException(status_code=400, detail="Danh mục đang có danh mục con, hãy chuyển hoặc xoá chúng trước")
    await db.delete(cat)
    await db.commit()


async def list_categories_admin(db: AsyncSession) -> dict:
    """Flat directory for the admin console: hidden categories included,
    with per-node and per-branch product counts so the UI never needs a second call."""
    from src.models.product import Product, ProductStatus

    cats = list((await db.execute(select(Category).order_by(Category.sort_order, Category.id))).scalars().all())
    counts = (await db.execute(
        select(
            Product.category_id,
            func.count(Product.id),
            func.count(Product.id).filter(Product.status == ProductStatus.active),
            func.count(func.distinct(Product.seller_id)),
        ).group_by(Product.category_id)
    )).all()
    by_cat = {cid: (total, active, sellers) for cid, total, active, sellers in counts}
    children: dict[int | None, list[int]] = {}
    for c in cats:
        children.setdefault(c.parent_id, []).append(c.id)

    def branch(cid: int) -> tuple[int, int]:
        total, active, _ = by_cat.get(cid, (0, 0, 0))
        for child in children.get(cid, []):
            t, a = branch(child)
            total += t
            active += a
        return total, active

    items = []
    for c in cats:
        total, active, sellers = by_cat.get(c.id, (0, 0, 0))
        b_total, b_active = branch(c.id)
        en = (c.i18n or {}).get("en") or {}
        items.append({
            "id": c.id,
            "name": c.name,
            "name_en": en.get("name") or None,
            "slug": c.slug,
            "icon": c.icon,
            "parent_id": c.parent_id,
            "sort_order": c.sort_order,
            "is_active": c.is_active,
            "commission_rate": c.commission_rate,
            "child_count": len(children.get(c.id, [])),
            "product_count": total,
            "active_product_count": active,
            "branch_product_count": b_total,
            "branch_active_product_count": b_active,
            "seller_count": sellers,
        })
    return {
        "items": items,
        "summary": {
            "total": len(items),
            "roots": len(children.get(None, [])),
            "active": sum(1 for i in items if i["is_active"]),
            "hidden": sum(1 for i in items if not i["is_active"]),
            "empty": sum(1 for i in items if i["branch_product_count"] == 0),
        },
    }


async def category_subtree_ids_any(category_id: int, db: AsyncSession) -> list[int]:
    """Id + every descendant regardless of is_active — admin views must see hidden branches too."""
    return [category_id, *sorted(await _descendant_ids(category_id, db))]


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


async def category_subtree_ids(category_ids, db: AsyncSession) -> list[int]:
    """Each id plus every ACTIVE descendant, de-duplicated (order preserved).

    Sellers pick "Mạng xã hội" and expect Facebook/TikTok/… underneath it to
    come along; same semantics as subtreeIds() in frontend/lib/categories.ts."""
    wanted = [int(c) for c in category_ids if c is not None]
    if not wanted:
        return []
    rows = (await db.execute(select(Category.id, Category.parent_id).where(Category.is_active))).all()
    children: dict[int | None, list[int]] = {}
    for cid, pid in rows:
        children.setdefault(pid, []).append(cid)
    known = {cid for cid, _ in rows}
    out: list[int] = []
    seen: set[int] = set()
    for root in wanted:
        if root not in known:
            continue
        stack = [root]
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            out.append(current)
            stack.extend(children.get(current, []))
    return out


async def search_categories(db: AsyncSession, query: str, *, locale: str = DEFAULT_LOCALE, limit: int = 5) -> list[dict]:
    """Ranked active categories whose name (any locale) or slug matches.

    One indexed query on ``categories.search_text``; the parent name rides
    along so the UI can show "Facebook · Mạng xã hội" without a tree walk.
    """
    query = normalize_query(query)
    if not query:
        return []
    terms = search_terms(query)
    parent = aliased(Category)
    stmt = (
        select(Category, parent)
        .outerjoin(parent, parent.id == Category.parent_id)
        .where(Category.is_active, terms.match(Category.search_text))
        .order_by(
            terms.rank(Category.search_text).asc(),
            terms.similarity(Category.search_text).desc(),
            Category.sort_order.asc(),
            Category.id.asc(),
        )
        .limit(limit)
    )
    hits: list[dict] = []
    for category, parent_row in (await db.execute(stmt)).all():
        hits.append({
            "id": category.id,
            "name": resolve_category_fields(category, locale)["name"],
            "slug": category.slug,
            "icon": category.icon,
            "parent_id": category.parent_id,
            "parent_name": resolve_category_fields(parent_row, locale)["name"] if parent_row is not None else None,
            "parent_slug": parent_row.slug if parent_row is not None else None,
        })
    return hits
