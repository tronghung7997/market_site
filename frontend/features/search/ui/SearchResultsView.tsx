"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { categoryPath, sellerPath } from "@/lib/routes";
import { categoryCoverId } from "@/lib/product-covers";
import type { Category, Product, SearchCategoryHit, SellerSummary } from "@/lib/types";
import { Button, Card, Monogram, Pagination, Select, Tag } from "@/components/ui";
import { ArrowRight, ChevronRight, Search, Star, X } from "@/components/Icons";
import { ProductCover } from "@/features/product-covers";
import ProductTile from "@/components/ProductTile";
import type { SearchFallback, SearchPageData } from "../data/load-search-page";
import { SEARCH_PAGE_SIZE, SEARCH_SORTS, searchPageHref, type SearchFilters, type SearchSort } from "../model";

function CategoryHitRow({ hit, active, onNarrow, narrowLabel }: {
  hit: SearchCategoryHit;
  active: boolean;
  onNarrow: () => void;
  narrowLabel: string;
}) {
  const t = useTranslations("search.page");
  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-raised">
      <ProductCover coverId={categoryCoverId(hit)} title={hit.name} className="h-9 w-9 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <Link href={categoryPath(hit)} className="block truncate text-[13.5px] font-medium text-fg hover:text-iris-hi">
          {hit.name}
        </Link>
        {hit.parent_name && <div className="truncate text-[12px] text-muted">{hit.parent_name}</div>}
      </div>
      <button
        type="button"
        onClick={onNarrow}
        aria-pressed={active}
        title={narrowLabel}
        className={cn(
          "shrink-0 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors",
          active ? "border-iris/30 bg-iris-soft text-iris-hi" : "border-line bg-surface text-muted hover:border-line-2 hover:text-fg",
        )}
      >
        {active ? t("narrowClear") : t("narrowShort")}
      </button>
    </li>
  );
}

function SellerHitRow({ seller }: { seller: SellerSummary }) {
  const t = useTranslations("search");
  const ts = useTranslations("sellers");
  return (
    <li>
      <Link href={sellerPath(seller)} className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-raised">
        <Monogram text={seller.display_name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-[13.5px] font-medium text-fg group-hover:text-iris-hi">{seller.display_name}</span>
            <Tag tone={seller.seller_tier === "new" ? "neutral" : "iris"}>{ts(`tier_${seller.seller_tier}`)}</Tag>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span>{t("orderCount", { count: seller.completed_order_count })}</span>
            {seller.rating_avg != null && (
              <span className="inline-flex items-center gap-0.5"><Star size={11} className="text-warn" />{seller.rating_avg.toFixed(1)}</span>
            )}
          </div>
        </div>
        <ChevronRight size={14} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

function BrowseFallback({
  fallback, heading, onPick,
}: { fallback: SearchFallback; heading: string; onPick: (query: string) => void }) {
  const t = useTranslations("search.page");
  const categories = fallback.categories.slice(0, 12);
  return (
    <div className="space-y-8">
      {categories.length > 0 && (
        <section aria-labelledby="search-browse-categories">
          <h2 id="search-browse-categories" className="text-[15px] font-semibold text-fg">{heading}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {categories.map((category: Category) => (
              <li key={category.id}>
                <Link
                  href={categoryPath(category)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-fg transition-colors hover:border-iris/40 hover:bg-iris-soft hover:text-iris-hi"
                >
                  {category.name}
                  <ChevronRight size={13} className="text-faint" />
                </Link>
              </li>
            ))}
            <li>
              <Link href="/categories" className="inline-flex h-9 items-center gap-1 px-2 text-[13px] font-medium text-iris-hi hover:underline">
                {t("allCategoriesLink")}
                <ArrowRight size={13} />
              </Link>
            </li>
          </ul>
        </section>
      )}
      {fallback.products.length > 0 && (
        <section aria-labelledby="search-browse-bestsellers">
          <div className="flex items-end justify-between gap-3">
            <h2 id="search-browse-bestsellers" className="text-[15px] font-semibold text-fg">{t("bestsellersHeading")}</h2>
            <Link href="/#market" className="inline-flex items-center gap-1 text-[13px] font-medium text-iris-hi hover:underline">
              {t("bestsellersAll")}
              <ArrowRight size={13} />
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {fallback.products.map((product: Product) => (
              <ProductTile key={product.public_key} product={product} />
            ))}
          </div>
        </section>
      )}
      {categories.length === 0 && fallback.products.length === 0 && (
        <Link href="/categories" className="inline-flex">
          <Button variant="secondary" size="md" onClick={() => onPick("")}>{t("browseCategories")}</Button>
        </Link>
      )}
    </div>
  );
}

export function SearchResultsView({ initial }: { initial: SearchPageData }) {
  const t = useTranslations("search.page");
  const tc = useTranslations("categories");
  const tcommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { filters, result, fallback, error } = initial;
  const [draft, setDraft] = useState(filters.q);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(filters.q); }, [filters.q]);

  const navigate = (next: Partial<SearchFilters>) => {
    const merged: SearchFilters = { ...filters, page: 1, ...next };
    startTransition(() => router.push(searchPageHref(merged)));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    navigate({ q: draft.trim(), categoryId: null });
  };

  const products = result?.products.items ?? [];
  const total = result?.products.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));
  const from = total === 0 ? 0 : (filters.page - 1) * SEARCH_PAGE_SIZE + 1;
  const to = Math.min(total, filters.page * SEARCH_PAGE_SIZE);
  const categories = result?.categories ?? [];
  const sellers = result?.sellers ?? [];
  const activeCategory = categories.find((c) => c.id === filters.categoryId) ?? null;
  const hasQuery = filters.q.length > 0;
  const hasSidePanels = categories.length > 0 || sellers.length > 0;

  const sortLabel: Record<SearchSort, string> = {
    relevance: t("sortRelevance"),
    newest: tc("sortNewest"),
    bestseller: tc("sortBestseller"),
    rating: tc("sortRating"),
    price_asc: tc("sortPriceAsc"),
    price_desc: tc("sortPriceDesc"),
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">
      {/* Page header */}
      <div className="mb-5">
        <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-iris-hi">
          <Search size={14} />
          <span>{t("title")}</span>
        </div>
        <h1 className="font-serif text-[26px] font-semibold leading-tight tracking-tight text-fg sm:text-[32px]">
          {hasQuery ? t("heading", { q: filters.q }) : t("headingEmpty")}
        </h1>
        {hasQuery && result && total + categories.length + sellers.length > 0 && (
          <p className="mt-1 text-[13.5px] text-muted" aria-live="polite">
            {t("summary", { products: total, categories: categories.length, sellers: sellers.length })}
          </p>
        )}
      </div>

      {/* Toolbar */}
      <form onSubmit={submit} role="search" className="mb-6 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            ref={inputRef}
            type="search"
            name="q"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("inputPlaceholder")}
            aria-label={t("inputLabel")}
            maxLength={80}
            enterKeyHint="search"
            className="h-10 w-full rounded-lg border border-line bg-surface pl-10 pr-10 text-sm text-fg placeholder:text-faint transition-colors focus:border-iris focus:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
          />
          {draft && (
            <button
              type="button"
              onClick={() => { setDraft(""); inputRef.current?.focus(); }}
              aria-label={tc("clearAllFilters")}
              className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-faint hover:bg-raised hover:text-fg"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <Button type="submit" size="md" className="md:w-auto">{t("submit")}</Button>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="search-sort">{tcommon("sort")}</label>
          <Select
            id="search-sort"
            value={filters.sort}
            onChange={(event) => navigate({ sort: event.target.value as SearchSort })}
            className="h-10 w-auto pr-8"
            disabled={!hasQuery}
          >
            {SEARCH_SORTS.map((value) => (
              <option key={value} value={value}>{sortLabel[value]}</option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() => navigate({ inStock: !filters.inStock })}
            aria-pressed={filters.inStock}
            disabled={!hasQuery}
            className={cn(
              "h-10 rounded-lg border px-3 text-[13px] font-medium transition-colors disabled:opacity-50",
              filters.inStock ? "border-iris/30 bg-iris-soft text-iris-hi" : "border-line bg-surface text-muted hover:border-line-2 hover:text-fg",
            )}
          >
            {tc("inStockOnly")}
          </button>
          <button
            type="button"
            onClick={() => navigate({ instant: !filters.instant })}
            aria-pressed={filters.instant}
            disabled={!hasQuery}
            className={cn(
              "h-10 rounded-lg border px-3 text-[13px] font-medium transition-colors disabled:opacity-50",
              filters.instant ? "border-iris/30 bg-iris-soft text-iris-hi" : "border-line bg-surface text-muted hover:border-line-2 hover:text-fg",
            )}
          >
            {tc("instantOnly")}
          </button>
        </div>
      </form>

      {activeCategory && (
        <div className="mb-4 flex items-center gap-2 text-[13px] text-muted">
          <Tag tone="iris">{t("narrowTo", { name: activeCategory.name })}</Tag>
          <button type="button" onClick={() => navigate({ categoryId: null })} className="inline-flex items-center gap-1 font-medium text-iris-hi hover:underline">
            <X size={12} />{t("allCategories")}
          </button>
        </div>
      )}

      {/* States */}
      {!hasQuery && fallback && (
        <BrowseFallback fallback={fallback} heading={t("browseHeading")} onPick={(q) => navigate({ q })} />
      )}

      {hasQuery && error && (
        <Card className="px-6 py-10 text-center">
          <p className="text-[14px] font-medium text-fg">{t("loadError")}</p>
          <Button variant="secondary" size="md" className="mt-4" onClick={() => router.refresh()}>{t("retry")}</Button>
        </Card>
      )}

      {hasQuery && result && (
        <div className={cn("grid gap-6", hasSidePanels && "lg:grid-cols-[280px_minmax(0,1fr)]")}>
          {hasSidePanels && (
            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              {categories.length > 0 && (
                <Card className="p-2">
                  <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">{t("categoriesPanel")}</div>
                  <ul>
                    {categories.map((hit) => (
                      <CategoryHitRow
                        key={hit.id}
                        hit={hit}
                        active={filters.categoryId === hit.id}
                        narrowLabel={t("narrowTo", { name: hit.name })}
                        onNarrow={() => navigate({ categoryId: filters.categoryId === hit.id ? null : hit.id })}
                      />
                    ))}
                  </ul>
                </Card>
              )}
              {sellers.length > 0 && (
                <Card className="p-2">
                  <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">{t("sellersPanel")}</div>
                  <ul>
                    {sellers.map((seller) => <SellerHitRow key={seller.public_key} seller={seller} />)}
                  </ul>
                </Card>
              )}
            </aside>
          )}

          <section aria-busy={isPending} className={cn("min-w-0 transition-opacity duration-150", isPending && "opacity-60")}>
            {products.length > 0 && (
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-semibold text-fg">{t("productsHeading")}</h2>
                <span className="text-[12.5px] text-muted tabular">{t("showing", { from, to, total })}</span>
              </div>
            )}
            {products.length === 0 ? (
              <div className="space-y-8">
                <div className="rounded-card border border-dashed border-line-2 bg-surface px-5 py-6 sm:px-6">
                  <p className="text-[15px] font-medium text-fg">{t("empty", { q: filters.q })}</p>
                  <p className="mt-1.5 text-[13px] text-muted">
                    {[t("emptyTipSpelling"), t("emptyTipShorter"), t("emptyTipAbbrev")].join(" · ")}
                  </p>
                  {(activeCategory || filters.inStock || filters.instant) && (
                    <button
                      type="button"
                      onClick={() => navigate({ categoryId: null, inStock: false, instant: false })}
                      className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-iris-hi hover:underline"
                    >
                      <X size={12} />{t("emptyClearFilters")}
                    </button>
                  )}
                </div>
                {fallback && (
                  <BrowseFallback fallback={fallback} heading={t("browseInsteadHeading")} onPick={(q) => navigate({ q })} />
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
                  {products.map((product) => (
                    <ProductTile key={product.public_key} product={product} />
                  ))}
                </div>
                <div className="mt-6">
                  <Pagination page={filters.page} totalPages={totalPages} onChange={(page) => navigate({ page })} />
                </div>
              </>
            )}
          </section>
        </div>
      )}
      <span className="sr-only" aria-live="polite">{isPending ? tcommon("loading") : ""}</span>
    </div>
  );
}
