#!/usr/bin/env python3
"""Backfill ``i18n.en`` for categories / products / variants from en_catalog.

Idempotent: merges into existing i18n without wiping ``i18n.vi``.
Only overwrites ``i18n.en`` keys present in the catalog map.

Usage (from marketplace-svc/):
  uv run python scripts/backfill_catalog_en.py
  uv run python scripts/backfill_catalog_en.py --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

# Allow `python scripts/backfill_catalog_en.py` from marketplace-svc/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select

from src.database import SessionLocal
from src.i18n.catalog import merge_i18n_locale
from src.i18n.en_catalog import CATEGORY_EN, PRODUCT_EN, VARIANT_EN
from src.models.category import Category
from src.models.product import Product, ProductVariant


async def backfill(*, dry_run: bool = False) -> dict[str, int]:
    stats = {"categories": 0, "products": 0, "variants": 0, "skipped_products": 0}

    async with SessionLocal() as db:
        # --- categories by slug ---
        cats = list((await db.execute(select(Category))).scalars())
        for cat in cats:
            en_name = CATEGORY_EN.get(cat.slug)
            if not en_name:
                continue
            new_i18n = merge_i18n_locale(cat.i18n, "en", {"name": en_name})
            if new_i18n != (cat.i18n or {}):
                cat.i18n = new_i18n
                stats["categories"] += 1

        # --- products by exact title ---
        products = list((await db.execute(select(Product))).scalars())
        product_by_id = {p.id: p for p in products}
        for product in products:
            en = PRODUCT_EN.get(product.title)
            if not en:
                if product.status and getattr(product.status, "value", product.status) == "active":
                    stats["skipped_products"] += 1
                continue
            fields = {k: v for k, v in en.items() if v is not None}
            new_i18n = merge_i18n_locale(product.i18n, "en", fields)
            if new_i18n != (product.i18n or {}):
                product.i18n = new_i18n
                stats["products"] += 1

        # --- variants by exact name ---
        variants = list((await db.execute(select(ProductVariant))).scalars())
        for variant in variants:
            en_name = VARIANT_EN.get(variant.name)
            if not en_name:
                continue
            new_i18n = merge_i18n_locale(variant.i18n, "en", {"name": en_name})
            if new_i18n != (variant.i18n or {}):
                variant.i18n = new_i18n
                stats["variants"] += 1

        if dry_run:
            await db.rollback()
        else:
            await db.commit()

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Do not commit")
    args = parser.parse_args()
    stats = asyncio.run(backfill(dry_run=args.dry_run))
    mode = "DRY-RUN" if args.dry_run else "APPLIED"
    print(f"[{mode}] categories={stats['categories']} products={stats['products']} "
          f"variants={stats['variants']} active_without_en_map={stats['skipped_products']}")


if __name__ == "__main__":
    main()
