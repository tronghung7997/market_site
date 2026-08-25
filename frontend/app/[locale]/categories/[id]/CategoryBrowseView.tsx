"use client";

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { flattenCategories, subtreeIds } from "@/lib/categories";
import { useMoney } from "@/lib/money";
import { effectiveMinPrice } from "@/lib/pricing-display";
import type { Category, Product } from "@/lib/types";
import { Button, Card, Select } from "@/components/ui";
import { ChevronRight } from "@/components/Icons";
import { categoryCoverId, ProductCover } from "@/features/product-covers";
import ProductTile from "@/components/ProductTile";
import type { CategoryPageCatalog } from "@/features/catalog";

export function CategoryBrowseView({
  categoryId,
  initial,
}: {
  categoryId: number;
  initial: CategoryPageCatalog;
}) {
  const t = useTranslations("categories");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const cats = initial.categories;
  const products = initial.products;
  const error = initial.error ? t("loadError") : null;
  const [subFilter, setSubFilter] = useState<number | null>(null);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sort, setSort] = useState<string>("newest");

  const sortOptions = useMemo(() => [
    { value: "newest", label: t("sortNewest") },
    { value: "bestseller", label: t("sortBestseller") },
    { value: "price_asc", label: t("sortPriceAsc") },
    { value: "price_desc", label: t("sortPriceDesc") },
  ], [t]);

  const flatCats = useMemo(() => flattenCategories(cats), [cats]);
  const category = flatCats.find((c) => c.id === categoryId) ?? null;
  const parent = category?.parent_id != null ? flatCats.find((c) => c.id === category.parent_id) ?? null : null;
  const children = category?.children ?? [];

  const stock = (p: Product) => (p.variants ?? []).reduce((s, v) => s + (v.stock_count ?? 0), 0);

  const inCategory = useMemo(() => {
    if (!category) return [];
    const ids = new Set(subtreeIds(category));
    return products.filter((p) => ids.has(p.category_id));
  }, [category, products]);

  const countFor = (c: Category) => {
    const ids = new Set(subtreeIds(c));
    return products.filter((p) => ids.has(p.category_id)).length;
  };

  const shown = useMemo(() => {
    let list = inCategory;
    if (subFilter != null) {
      const sub = flatCats.find((c) => c.id === subFilter);
      const ids = sub ? new Set(subtreeIds(sub)) : new Set([subFilter]);
      list = list.filter((p) => ids.has(p.category_id));
    }
    if (inStockOnly) list = list.filter((p) => stock(p) > 0);
    const sorted = [...list];
    switch (sort) {
      case "bestseller": sorted.sort((a, b) => b.sold_count - a.sold_count); break;
      case "price_asc": sorted.sort((a, b) => (effectiveMinPrice(a) || Infinity) - (effectiveMinPrice(b) || Infinity)); break;
      case "price_desc": sorted.sort((a, b) => effectiveMinPrice(b) - effectiveMinPrice(a)); break;
    }
    return sorted;
  }, [inCategory, subFilter, inStockOnly, sort, flatCats]);

  const minPrices = inCategory.map((p) => effectiveMinPrice(p)).filter((v) => v > 0);
  const fromPrice = minPrices.length ? Math.min(...minPrices) : 0;

  if (error || !category) {
    return (
      <div className="w-full mx-auto max-w-[1200px] px-6 py-16">
        <Card className="p-6 text-sm">
          <p className="text-bad">{error ?? t("notFound")}</p>
          <Link href="/categories" className="inline-block mt-3 text-iris-hi hover:underline text-[13px]">{t("backToAll")}</Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-5 sm:py-6">
      <nav aria-label={tc("breadcrumb")} className="flex items-center gap-1.5 text-[12.5px] text-muted mb-4">
        <Link href="/" className="hover:text-fg transition-colors shrink-0">{tc("marketplace")}</Link>
        <ChevronRight size={12} className="text-faint shrink-0" />
        <Link href="/categories" className="hover:text-fg transition-colors shrink-0">{tc("categories")}</Link>
        {parent && (
          <>
            <ChevronRight size={12} className="text-faint shrink-0" />
            <Link href={`/categories/${parent.id}`} className="hover:text-fg transition-colors shrink-0">{parent.name}</Link>
          </>
        )}
        <ChevronRight size={12} className="text-faint shrink-0" />
        <span className="text-faint truncate">{category.name}</span>
      </nav>

      <div className="flex items-center gap-3.5">
        <ProductCover
          coverId={categoryCoverId(category)}
          title={category.name}
          className="h-11 w-11 rounded-xl"
        />
        <div className="min-w-0">
          <h1 className="font-serif text-[24px] sm:text-[26px] leading-tight tracking-tight font-semibold">{category.name}</h1>
          <p className="text-[12.5px] text-muted mt-0.5">
            {fromPrice > 0
              ? t("sellingCountFrom", { count: inCategory.length, price: formatBrowseMoney(fromPrice, { locale }) })
              : t("sellingCount", { count: inCategory.length })}
          </p>
        </div>
      </div>

      {children.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={subFilter == null ? "secondary" : "ghost"}
            className={subFilter == null ? "rounded-full" : "rounded-full border border-line"}
            onClick={() => setSubFilter(null)}
          >
            {t("allWithCount", { count: inCategory.length })}
          </Button>
          {children.map((c) => (
            <Button
              key={c.id}
              type="button"
              size="sm"
              variant={subFilter === c.id ? "secondary" : "ghost"}
              className={subFilter === c.id ? "rounded-full" : "rounded-full border border-line"}
              onClick={() => setSubFilter(subFilter === c.id ? null : c.id)}
            >
              {c.name} · {countFor(c)}
            </Button>
          ))}
        </div>
      )}

      <div className="mb-5 mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant={inStockOnly ? "secondary" : "ghost"}
          className={inStockOnly ? "border-good/40 bg-good-soft text-good" : "border border-line"}
          onClick={() => setInStockOnly((v) => !v)}
        >
          {t("inStockOnly")}
        </Button>
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label={tc("sort")}
          className="ml-auto w-auto"
        >
          {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>

      {shown.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-[13px] text-muted">
            {inCategory.length === 0 ? t("emptyCategory") : t("emptyFilter")}
          </p>
          <Link href="/categories" className="inline-block mt-3 text-[13px] text-iris-hi hover:underline">{t("otherCategories")}</Link>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:[grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {shown.map((p) => <ProductTile key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}
