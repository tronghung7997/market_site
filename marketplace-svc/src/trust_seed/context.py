"""Turn a product row into prompt context.

This is what separates a usable demo review from obvious filler: the model is
told what the thing actually is — age of the accounts, proxy protocol, warranty
terms, price tiers — so it writes about the product instead of about
"the product". Everything here is already public on the storefront; no seller
credentials, no inventory data, no buyer information ever enters a prompt.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.category import Category
from src.models.product import Product, ProductVariant

# Prompt budget guard: a product with 40 variants must not blow up the request.
_MAX_VARIANTS = 8
_MAX_FEATURES = 8
_MAX_SPEC_KEYS = 10
_MAX_TEXT = 400


def _trim(value: Any, limit: int = _MAX_TEXT) -> str:
    text = str(value or "").strip().replace("\n", " ")
    return text[:limit]


async def _category_path(db: AsyncSession, category_id: int | None) -> str:
    """"Tài khoản > Facebook > Via cổ" — the taxonomy tells the model the
    domain vocabulary to use."""
    if category_id is None:
        return ""
    names: list[str] = []
    current_id: int | None = category_id
    # Bounded walk: a cycle in the tree must not hang generation.
    for _ in range(5):
        if current_id is None:
            break
        category = await db.get(Category, current_id)
        if category is None:
            break
        names.append(category.name)
        current_id = category.parent_id
    return " > ".join(reversed(names))


async def build_product_context(db: AsyncSession, product: Product) -> str:
    """Compact, human-readable block injected as ``{product_context}``."""
    lines: list[str] = [f"Tên sản phẩm: {_trim(product.title)}"]

    path = await _category_path(db, product.category_id)
    if path:
        lines.append(f"Danh mục: {path}")
    if product.service_type:
        lines.append(f"Loại dịch vụ: {product.service_type}")
    if product.description:
        lines.append(f"Mô tả: {_trim(product.description)}")
    if product.highlight_text:
        lines.append(f"Điểm nổi bật: {_trim(product.highlight_text, 200)}")
    if product.warranty_text:
        lines.append(f"Bảo hành: {_trim(product.warranty_text, 200)}")
    lines.append(f"Thời gian giữ tiền: {product.escrow_days} ngày")

    if isinstance(product.features, list) and product.features:
        features = [_trim(f, 80) for f in product.features[:_MAX_FEATURES]]
        lines.append("Tính năng: " + "; ".join(f for f in features if f))

    if isinstance(product.specs, dict) and product.specs:
        specs = dict(list(product.specs.items())[:_MAX_SPEC_KEYS])
        lines.append("Thông số: " + json.dumps(specs, ensure_ascii=False)[:500])

    variants = (await db.execute(
        select(ProductVariant)
        .where(ProductVariant.product_id == product.id, ProductVariant.is_active.is_(True))
        .order_by(ProductVariant.price)
        .limit(_MAX_VARIANTS)
    )).scalars().all()
    if variants:
        rendered = ", ".join(f"{_trim(v.name, 60)} — {v.price:,}đ" for v in variants)
        lines.append(f"Các gói: {rendered}")
        modes = {v.delivery_mode.value if hasattr(v.delivery_mode, "value") else str(v.delivery_mode)
                 for v in variants}
        lines.append("Hình thức giao: " + ", ".join(sorted(modes)))

    return "\n".join(lines)


def format_distribution(distribution: dict[int, int]) -> str:
    """{5: 6, 4: 2} -> "6 đánh giá 5 sao, 2 đánh giá 4 sao"."""
    parts = [f"{count} đánh giá {star} sao"
             for star, count in sorted(distribution.items(), reverse=True) if count > 0]
    return ", ".join(parts)
