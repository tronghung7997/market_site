"use client";

/** Single category page — filter/sort product grid. */

import { Link } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { flattenCategories, subtreeIds } from "@/lib/categories";
import { useMoney } from "@/lib/money";
import { effectiveMinPrice } from "@/lib/pricing-display";
import type { Category, Product } from "@/lib/types";
import { Card, Spinner } from "@/components/ui";
import { ChevronRight } from "@/components/Icons";
import { categoryIcon } from "@/components/CategoryIcon";
import ProductTile from "@/components/ProductTile";

export default function CategoryPage() {
  const t = useTranslations("categories");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const { id } = useParams<{ id: string }>();
  const categoryId = Number(id);
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subFilter, setSubFilter] = useState<number | null>(null);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sort, setSort] = useState<string>("newest");

  const sortOptions = useMemo(() => [
    { value: "newest", label: t("sortNewest") },
    { value: "bestseller", label: t("sortBestseller") },
    { value: "price_asc", label: t("sortPriceAsc") },
    { value: "price_desc", label: t("sortPriceDesc") },
  ], [t]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [c, p] = await Promise.all([api.categories(), api.products({ categoryId })]);
        setCats(c);
        setProducts(p.items);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("loadError"));
      } finally {
        setLoading(false);
      }
    })();
  }, [categoryId, t]);

  useEffect(() => { setSubFilter(null); }, [categoryId]);

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

  if (loading) return <div className="w-full mx-auto max-w-[1200px] px-6 py-20"><Spinner label={t("loading")} /></div>;
  if (error || !category) return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-16">
      <Card className="p-6 text-sm">
        <p className="text-bad">{error ?? t("notFound")}</p>
        <Link href="/categories" className="inline-block mt-3 text-iris-hi hover:underline text-[13px]">{t("backToAll")}</Link>
      </Card>
    </div>
  );

  const Icon = categoryIcon(category.name);

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
        <span className="grid place-items-center h-11 w-11 shrink-0 rounded-xl bg-iris-soft text-iris border border-iris/15">
          <Icon size={20} />
        </span>
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
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={() => setSubFilter(null)}
            className={cn("h-8 px-3.5 rounded-full text-[13px] font-medium border transition-colors",
              subFilter == null ? "bg-fg text-surface border-fg" : "bg-surface text-muted border-line hover:text-fg hover:border-line-2")}
          >
            {t("allWithCount", { count: inCategory.length })}
          </button>
          {children.map((c) => (
            <button
              key={c.id}
              onClick={() => setSubFilter(subFilter === c.id ? null : c.id)}
              className={cn("h-8 px-3.5 rounded-full text-[13px] font-medium border transition-colors",
                subFilter === c.id ? "bg-fg text-surface border-fg" : "bg-surface text-muted border-line hover:text-fg hover:border-line-2")}
            >
              {c.name} · {countFor(c)}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-4 mb-5">
        <button onClick={() => setInStockOnly((v) => !v)}
          className={cn("flex items-center gap-2 h-9 px-3 rounded-lg border text-[13px] font-medium transition-colors",
            inStockOnly ? "border-good/40 bg-good-soft text-good" : "border-line bg-surface text-muted hover:text-fg")}>
          <span className={cn("h-3.5 w-6 rounded-full relative transition-colors", inStockOnly ? "bg-good" : "bg-line-2")}>
            <span className={cn("absolute top-0.5 h-2.5 w-2.5 rounded-full bg-surface transition-all", inStockOnly ? "left-3" : "left-0.5")} />
          </span>
          {t("inStockOnly")}
        </button>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label={tc("sort")}
          className="ml-auto h-9 rounded-lg bg-surface border border-line px-2.5 text-[12.5px] text-muted focus:border-iris focus:outline-none cursor-pointer"
        >
          {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
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
