"use client";

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { flattenCategories, subtreeIds } from "@/lib/categories";
import { useMoney } from "@/lib/money";
import { effectiveMinPrice } from "@/lib/pricing-display";
import type { Category } from "@/lib/types";
import { Card, Input, Tag } from "@/components/ui";
import { ArrowRight, ChevronRight, Search } from "@/components/Icons";
import { categoryCoverId, ProductCover } from "@/features/product-covers";
import ProductTile from "@/components/ProductTile";
import type { CategoryHubCatalog } from "@/features/catalog";

export function CategoryHubView({ initial }: { initial: CategoryHubCatalog }) {
  const t = useTranslations("categories");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const cats = initial.categories;
  const products = initial.products;
  const error = initial.error ? t("loadError") : null;
  const [q, setQ] = useState("");

  const flatCats = useMemo(() => flattenCategories(cats), [cats]);
  const topCats = cats.length > 0 ? cats : flatCats.filter((c) => c.parent_id == null);

  const productsOf = (c: Category) => {
    const ids = new Set(subtreeIds(c));
    return products.filter((p) => ids.has(p.category_id));
  };

  const matches = (c: Category) =>
    q === "" ||
    c.name.toLowerCase().includes(q.toLowerCase()) ||
    (c.children ?? []).some((s) => s.name.toLowerCase().includes(q.toLowerCase()));

  const shelves = topCats
    .map((c) => ({ c, items: productsOf(c) }))
    .filter(({ c, items }) => items.length > 0 && matches(c))
    .sort((a, b) => b.items.length - a.items.length);
  const empty = topCats.filter((c) => productsOf(c).length === 0);

  return (
    <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-5 sm:py-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-5">
        <div>
          <h1 className="font-serif text-[26px] sm:text-[28px] leading-tight tracking-tight font-semibold">{t("title")}</h1>
          <p className="text-[13px] text-muted mt-1">
            {t("subtitle", { cats: topCats.length, products: products.length })}
          </p>
        </div>
        <div className="relative w-full sm:w-[280px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="pl-9"
          />
        </div>
      </div>

      {error && <Card className="p-5 text-bad text-sm">{error}</Card>}
      {!error && shelves.length === 0 && (
        <Card className="p-8 text-center text-muted text-sm">{t("noMatch", { q })}</Card>
      )}

      <div className="space-y-4">
        {shelves.map(({ c, items }) => {
          const children = c.children ?? [];
          const minPrices = items.map((p) => effectiveMinPrice(p)).filter((v) => v > 0);
          const fromPrice = minPrices.length ? Math.min(...minPrices) : 0;
          const preview = items.slice(0, 3);
          return (
            <Card key={c.id} className="overflow-hidden">
              <div className="grid lg:grid-cols-[260px_minmax(0,1fr)]">
                <div className="p-5 lg:border-r border-b lg:border-b-0 border-line bg-raised/30 flex flex-col">
                  <Link href={`/categories/${c.id}`} className="group flex items-center gap-3">
                    <ProductCover
                      coverId={categoryCoverId(c)}
                      title={c.name}
                      className="h-10 w-10 rounded-xl"
                    />
                    <div className="min-w-0">
                      <div className="font-serif text-[17px] leading-tight tracking-tight font-semibold group-hover:text-iris-hi transition-colors">
                        {c.name}
                      </div>
                      <div className="text-[12px] text-muted mt-0.5">
                        {fromPrice > 0
                          ? t("productCountFrom", { count: items.length, price: formatBrowseMoney(fromPrice, { locale }) })
                          : t("productCount", { count: items.length })}
                      </div>
                    </div>
                  </Link>

                  {children.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3.5">
                      {children.map((s) => (
                        <Link key={s.id} href={`/categories/${s.id}`}>
                          <Tag tone="neutral" className="hover:border-iris/40 hover:text-iris-hi transition-colors">{s.name}</Tag>
                        </Link>
                      ))}
                    </div>
                  )}

                  <Link
                    href={`/categories/${c.id}`}
                    className="mt-auto pt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-iris-hi hover:underline"
                  >
                    {t("enterCategory")} <ArrowRight size={13} />
                  </Link>
                </div>

                <div className="p-4 grid gap-3 grid-cols-2 lg:grid-cols-4 items-stretch">
                  {preview.map((p) => <ProductTile key={p.id} product={p} />)}
                  <Link href={`/categories/${c.id}`} className="h-full min-h-[120px]">
                    <div className="h-full rounded-card border border-dashed border-line-2 grid place-items-center text-center px-3 hover:border-iris/40 hover:bg-iris/4 transition-colors">
                      <span className="text-[13px] font-medium text-muted hover:text-iris-hi inline-flex items-center gap-1">
                        {t("viewAllCount", { count: items.length })} <ChevronRight size={14} />
                      </span>
                    </div>
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {!error && empty.length > 0 && (
        <p className="mt-5 text-[12.5px] text-faint">
          {t("comingSoon", { names: empty.map((c) => c.name).join(" · ") })}
        </p>
      )}
    </div>
  );
}
