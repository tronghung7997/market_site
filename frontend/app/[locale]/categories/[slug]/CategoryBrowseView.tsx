"use client";

/** Catalog explorer, one category: same rail as the hub, plus a toolbar for
 *  search / sort / filters and a paginated list. Filter changes update the
 *  URL with `history.replaceState` and refetch through `/api` while the
 *  current list stays on screen — no route re-render, no blank frame. */

import { Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { flattenCategories } from "@/lib/categories";
import { categoryPath, matchCategoryParam } from "@/lib/routes";
import { useMoney } from "@/lib/money";
import { Button, Card, Pagination } from "@/components/ui";
import { AlertCircle, Bolt, Check, ChevronRight, Grid, ListFilter, Rows, Search, ShieldCheck, X } from "@/components/Icons";
import { categoryCoverId, ProductCover } from "@/features/product-covers";
import ProductTile from "@/components/ProductTile";
import { ProductRow } from "@/components/products/ProductRow";
import { browseQueryToListOpts, browsePage, BROWSE_PER_PAGE, CategoryRail, useCategoryProducts } from "@/features/catalog/client";
import type { CategoryBrowseQuery } from "@/features/catalog/client";
import type { CategoryPageCatalog } from "@/features/catalog";
import { useDebounce } from "@/lib/hooks/useDebounce";

type ViewMode = "list" | "grid";

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
  const searchParams = useSearchParams();

  const { formatBrowseMoney, currency, fxRate } = useMoney();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  // Blocks the URL→state sync from overwriting q while the user is typing.
  const isTypingRef = useRef(false);

  const cats = initial.categories;
  const flatCats = useMemo(() => flattenCategories(cats), [cats]);
  const nameById = useMemo(() => new Map(flatCats.map((c) => [c.id, c.name])), [flatCats]);
  const category = flatCats.find((c) => c.id === categoryId) ?? null;
  const parent = category?.parent_id != null ? flatCats.find((c) => c.id === category.parent_id) ?? null : null;
  const children = category?.children ?? [];
  // `?sub=` narrows a parent page to one child; accepts a slug or a legacy id.
  const subFromParam = (raw: string | null | undefined) => matchCategoryParam(raw, children);

  // ---- URL state -------------------------------------------------------
  const readView = (): ViewMode => (searchParams?.get("view") === "grid" ? "grid" : "list");
  const [q, setQ] = useState(searchParams?.get("q") || "");
  const [sort, setSort] = useState<string>(searchParams?.get("sort") || "newest");
  const [inStockOnly, setInStockOnly] = useState(searchParams?.get("stock") === "1");
  const [instantOnly, setInstantOnly] = useState(searchParams?.get("instant") === "1");
  const [priceRange, setPriceRange] = useState<string>(searchParams?.get("price") || "all");
  const [customMin, setCustomMin] = useState(searchParams?.get("min") || "");
  const [customMax, setCustomMax] = useState(searchParams?.get("max") || "");
  const [minVnd, setMinVnd] = useState(searchParams?.get("min_vnd") || "");
  const [maxVnd, setMaxVnd] = useState(searchParams?.get("max_vnd") || "");
  const [viewMode, setViewMode] = useState<ViewMode>(readView);
  const [subSlug, setSubSlug] = useState<string | null>(subFromParam(searchParams?.get("sub"))?.slug ?? null);
  const [page, setPage] = useState<number>(browsePage(searchParams?.get("page") || undefined));
  const [customOpen, setCustomOpen] = useState((searchParams?.get("price") || "all") === "custom");

  // Back/forward and external navigation: mirror the URL into state.
  useEffect(() => {
    if (!isTypingRef.current) setQ(searchParams?.get("q") || "");
    setSort(searchParams?.get("sort") || "newest");
    setInStockOnly(searchParams?.get("stock") === "1");
    setInstantOnly(searchParams?.get("instant") === "1");
    setPriceRange(searchParams?.get("price") || "all");
    setCustomMin(searchParams?.get("min") || "");
    setCustomMax(searchParams?.get("max") || "");
    setMinVnd(searchParams?.get("min_vnd") || "");
    setMaxVnd(searchParams?.get("max_vnd") || "");
    setViewMode(readView());
    setSubSlug(subFromParam(searchParams?.get("sub"))?.slug ?? null);
    setPage(browsePage(searchParams?.get("page") || undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /** Pure client-side URL update: Next syncs `useSearchParams`, no RSC round-trip. */
  const syncToUrl = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(window.location.search);
    Object.entries(updates).forEach(([key, val]) => {
      const isDefault =
        val === null || val === "" ||
        (key === "page" && val === "1") || (key === "price" && val === "all") ||
        (key === "view" && val === "list") || (key === "sort" && val === "newest");
      if (isDefault) params.delete(key);
      else params.set(key, val);
    });
    const qs = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  };

  const debouncedQ = useDebounce(q, 250);
  useEffect(() => {
    const urlQuery = new URLSearchParams(window.location.search).get("q") || "";
    const normalized = debouncedQ.trim();
    if (normalized === urlQuery) {
      isTypingRef.current = false;
      return;
    }
    setPage(1);
    syncToUrl({ q: normalized || null, page: "1" });
    isTypingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  // ---- Data --------------------------------------------------------------
  const subCat = subSlug ? children.find((c) => c.slug === subSlug) ?? null : null;
  const activeCat = subCat ?? category;
  const browseQuery: CategoryBrowseQuery = {
    q, sort, stock: inStockOnly ? "1" : undefined, instant: instantOnly ? "1" : undefined,
    price: priceRange, minVnd, maxVnd, page: String(page),
  };
  const listOpts = browseQueryToListOpts(browseQuery, activeCat?.id ?? categoryId);
  const seed = initial.listOpts && initial.result ? { opts: initial.listOpts, data: initial.result } : null;
  const list = useCategoryProducts(listOpts, seed);
  const products = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const perPage = list.data?.per_page ?? BROWSE_PER_PAGE;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const validPage = Math.min(page, totalPages);
  const refreshing = list.isFetching && list.data != null;

  const rate = fxRate && fxRate > 0 ? fxRate : 25000;
  const tier1Vnd = currency === "USD" ? rate : 25000;
  const tier2Vnd = currency === "USD" ? rate * 2 : 50000;

  const setPageAndScroll = (next: number) => {
    setPage(next);
    syncToUrl({ page: next > 1 ? String(next) : null });
    paneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleResetFilters = () => {
    setQ("");
    setInStockOnly(false);
    setInstantOnly(false);
    setPriceRange("all");
    setCustomMin("");
    setCustomMax("");
    setMinVnd("");
    setMaxVnd("");
    setSort("newest");
    setPage(1);
    setCustomOpen(false);
    syncToUrl({ q: null, stock: null, instant: null, price: null, min: null, max: null, min_vnd: null, max_vnd: null, sort: null, page: null });
  };

  const activeFilterCount =
    (q.trim() ? 1 : 0) + (inStockOnly ? 1 : 0) + (instantOnly ? 1 : 0) + (priceRange !== "all" ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  const chip = (active: boolean, tone: "good" | "iris" = "iris") =>
    `inline-flex items-center gap-1.5 h-9 sm:h-8 px-3 rounded-lg text-[12.5px] font-medium border transition-colors cursor-pointer shrink-0 ${
      active
        ? tone === "good" ? "border-good/40 bg-good-soft text-good" : "border-iris/40 bg-iris-soft text-iris-hi"
        : "border-line bg-surface text-muted hover:text-fg hover:border-line-2"
    }`;

  const pricePresets = [
    { key: "all", label: t("priceAll") },
    { key: "under1", label: `< ${formatBrowseMoney(tier1Vnd, { locale })}` },
    { key: "1to2", label: `${formatBrowseMoney(tier1Vnd, { locale })} – ${formatBrowseMoney(tier2Vnd, { locale })}` },
    { key: "above2", label: `> ${formatBrowseMoney(tier2Vnd, { locale })}` },
  ];

  const applyPreset = (key: string) => {
    setPriceRange(key);
    setCustomMin("");
    setCustomMax("");
    setMinVnd("");
    setMaxVnd("");
    setCustomOpen(false);
    setPage(1);
    syncToUrl({ price: key === "all" ? null : key, min: null, max: null, min_vnd: null, max_vnd: null, page: "1" });
  };

  const applyCustomRange = () => {
    if (!customMin.trim() && !customMax.trim()) return;
    const toVnd = (raw: string) => (raw.trim() ? String(Math.round(Number(raw) * (currency === "USD" ? rate : 1))) : "");
    const nextMin = toVnd(customMin);
    const nextMax = toVnd(customMax);
    setPriceRange("custom");
    setMinVnd(nextMin);
    setMaxVnd(nextMax);
    setPage(1);
    syncToUrl({ price: "custom", min: customMin.trim() || null, max: customMax.trim() || null, min_vnd: nextMin || null, max_vnd: nextMax || null, page: "1" });
  };

  if (initial.error === "load" && !category) {
    return (
      <div className="w-full mx-auto max-w-[1200px] px-6 py-16">
        <Card className="p-8 text-sm max-w-md mx-auto text-center">
          <p className="text-bad font-medium">{t("loadError")}</p>
          <Link href="/categories" className="inline-block mt-4 text-iris-hi hover:underline text-[13px]">
            {t("backToAll")}
          </Link>
        </Card>
      </div>
    );
  }
  if (!category) {
    return (
      <div className="w-full mx-auto max-w-[1200px] px-6 py-16">
        <Card className="p-8 text-sm max-w-md mx-auto text-center">
          <p className="text-fg font-medium">{t("notFound")}</p>
          <Link href="/categories" className="inline-block mt-4 text-iris-hi hover:underline text-[13px]">
            {t("backToAll")}
          </Link>
        </Card>
      </div>
    );
  }

  const pageFrom = (validPage - 1) * perPage + 1;
  const pageTo = (validPage - 1) * perPage + products.length;
  const headline = activeCat ?? category;

  return (
    <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-5 sm:py-7">
      {/* Breadcrumb */}
      <nav aria-label={tc("breadcrumb")} className="flex items-center gap-1.5 text-[12.5px] text-muted mb-4 flex-wrap">
        <Link href="/" className="hover:text-fg transition-colors shrink-0">{tc("marketplace")}</Link>
        <ChevronRight size={12} className="text-faint shrink-0" />
        <Link href="/categories" className="hover:text-fg transition-colors shrink-0">{tc("categories")}</Link>
        {parent && (
          <>
            <ChevronRight size={12} className="text-faint shrink-0" />
            <Link href={categoryPath(parent)} className="hover:text-fg transition-colors shrink-0">{parent.name}</Link>
          </>
        )}
        {subCat && (
          <>
            <ChevronRight size={12} className="text-faint shrink-0" />
            <Link href={categoryPath(category)} className="hover:text-fg transition-colors shrink-0">{category.name}</Link>
          </>
        )}
        <ChevronRight size={12} className="text-faint shrink-0" />
        <span className="text-fg font-medium truncate" aria-current="page">{headline.name}</span>
      </nav>

      {/* Header */}
      <div className="flex items-center gap-3.5 min-w-0">
        <ProductCover coverId={categoryCoverId(headline)} title={headline.name} className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl shrink-0 shadow-sm" />
        <div className="min-w-0">
          <h1 className="font-serif text-[24px] sm:text-[28px] leading-tight font-semibold text-fg truncate">
            {headline.name}
          </h1>
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[12.5px] text-muted mt-1">
            <span>{t("sellingCount", { count: total })}</span>
            <span className="text-faint" aria-hidden="true">·</span>
            <span className="text-good font-medium inline-flex items-center gap-1">
              <ShieldCheck size={13} /> {t("escrowProtected")}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 sm:mt-6 lg:grid lg:grid-cols-[224px_minmax(0,1fr)] lg:gap-10">
        <aside className="lg:sticky lg:top-24 lg:self-start mb-5 lg:mb-0">
          <CategoryRail cats={cats} totals={initial.shelfTotals} activeId={headline.id} allTotal={Object.values(initial.shelfTotals).reduce((n, s) => n + s.total, 0)} />
        </aside>

        <div ref={paneRef} className="min-w-0 scroll-mt-24">
          {/* Toolbar */}
          <div className="rounded-card border border-line bg-surface">
            <div className="p-3 flex flex-col md:flex-row md:items-center gap-2.5">
              <div className="relative flex-1 min-w-0">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={q}
                  onChange={(e) => { isTypingRef.current = true; setQ(e.target.value); }}
                  placeholder={t("searchInCurrent", { name: headline.name })}
                  aria-label={t("searchInCurrent", { name: headline.name })}
                  className="h-10 w-full rounded-lg bg-base border border-line pl-10 pr-9 text-sm text-fg placeholder:text-faint transition-colors focus:border-iris focus:ring-1 focus:ring-iris/30 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => { setQ(""); searchInputRef.current?.focus(); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 grid place-items-center rounded-md text-faint hover:text-fg hover:bg-raised cursor-pointer"
                    aria-label={t("clearSearch")}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 md:shrink-0">
                <label className="flex-1 md:flex-none inline-flex items-center gap-2 h-10 rounded-lg bg-base border border-line pl-3 pr-2 text-[13px] text-muted focus-within:border-iris">
                  <span className="shrink-0">{tc("sort")}</span>
                  <select
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value);
                      setPage(1);
                      syncToUrl({ sort: e.target.value, page: "1" });
                    }}
                    aria-label={tc("sort")}
                    className="h-full min-w-0 flex-1 bg-transparent text-fg font-medium focus:outline-none cursor-pointer"
                  >
                    <option value="newest">{t("sortNewest")}</option>
                    <option value="bestseller">{t("sortBestseller")}</option>
                    <option value="rating">{t("sortRating")}</option>
                    <option value="price_asc">{t("sortPriceAsc")}</option>
                    <option value="price_desc">{t("sortPriceDesc")}</option>
                  </select>
                </label>

                <div role="group" aria-label={t("viewModeLabel")} className="flex items-center h-10 rounded-lg border border-line bg-base p-0.5 shrink-0">
                  {(["list", "grid"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => { setViewMode(mode); syncToUrl({ view: mode }); }}
                      className={`h-full w-9 rounded-md grid place-items-center transition-colors cursor-pointer ${
                        viewMode === mode ? "bg-surface text-fg shadow-xs" : "text-faint hover:text-fg"
                      }`}
                      title={mode === "list" ? t("viewList") : t("viewGrid")}
                      aria-label={mode === "list" ? t("viewList") : t("viewGrid")}
                      aria-pressed={viewMode === mode}
                    >
                      {mode === "list" ? <Rows size={15} /> : <Grid size={15} />}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-line px-3 py-2.5 flex items-center gap-2 flex-wrap">
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[12px] font-medium text-faint pr-1">
                <ListFilter size={13} />
                {t("filtersLabel")}
              </span>
              <button
                type="button"
                aria-pressed={inStockOnly}
                onClick={() => {
                  const next = !inStockOnly;
                  setInStockOnly(next);
                  setPage(1);
                  syncToUrl({ stock: next ? "1" : null, page: "1" });
                }}
                className={chip(inStockOnly, "good")}
              >
                <Check size={13} className={inStockOnly ? "stroke-[2.5]" : "text-faint"} />
                <span>{t("inStockOnly")}</span>
              </button>
              <button
                type="button"
                aria-pressed={instantOnly}
                onClick={() => {
                  const next = !instantOnly;
                  setInstantOnly(next);
                  setPage(1);
                  syncToUrl({ instant: next ? "1" : null, page: "1" });
                }}
                className={chip(instantOnly)}
              >
                <Bolt size={13} className={instantOnly ? "fill-iris-hi" : "text-faint"} />
                <span>{t("instantOnly")}</span>
              </button>

              <span className="hidden sm:block h-5 w-px bg-line mx-1" aria-hidden="true" />

              <div role="group" aria-label={t("priceLabel")} className="flex items-center gap-1.5 flex-wrap">
                {pricePresets.map((p) => (
                  <button key={p.key} type="button" aria-pressed={priceRange === p.key} onClick={() => applyPreset(p.key)} className={chip(priceRange === p.key)}>
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={priceRange === "custom"}
                  aria-expanded={customOpen}
                  aria-controls="category-price-custom"
                  onClick={() => setCustomOpen((v) => !v)}
                  className={chip(priceRange === "custom" || customOpen)}
                >
                  {t("priceCustom")}
                  {priceRange === "custom" && (customMin || customMax) && (
                    <span className="font-mono tabular text-[11.5px]">{customMin || "0"}–{customMax || "∞"}</span>
                  )}
                </button>
              </div>

            </div>

            {customOpen && (
              <form
                id="category-price-custom"
                onSubmit={(e) => { e.preventDefault(); applyCustomRange(); }}
                className="border-t border-line px-3 py-2.5 flex items-center gap-2 flex-wrap text-[13px]"
              >
                <span className="text-muted">{t("priceCustomHint")}</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number" min="0" step={currency === "USD" ? "0.1" : "1000"} inputMode="decimal"
                    placeholder={t("priceMin")} value={customMin} onChange={(e) => setCustomMin(e.target.value)}
                    className="w-24 h-9 px-2.5 rounded-lg bg-base border border-line text-fg font-mono tabular text-[13px] placeholder:text-faint placeholder:font-sans focus:outline-none focus:border-iris"
                    aria-label={t("priceMin")}
                  />
                  <span className="text-faint">–</span>
                  <input
                    type="number" min="0" step={currency === "USD" ? "0.1" : "1000"} inputMode="decimal"
                    placeholder={t("priceMax")} value={customMax} onChange={(e) => setCustomMax(e.target.value)}
                    className="w-24 h-9 px-2.5 rounded-lg bg-base border border-line text-fg font-mono tabular text-[13px] placeholder:text-faint placeholder:font-sans focus:outline-none focus:border-iris"
                    aria-label={t("priceMax")}
                  />
                  <span className="text-[12px] text-faint font-mono">{currency === "USD" ? "$" : "₫"}</span>
                </div>
                <Button type="submit" size="sm" variant="secondary" disabled={!customMin.trim() && !customMax.trim()}>
                  {t("priceApply")}
                </Button>
              </form>
            )}
          </div>

          {/* Result line */}
          <div className="mt-4 mb-3 flex items-center justify-between gap-3 text-[12.5px] text-muted" aria-live="polite">
            <span className="inline-flex items-center gap-2">
              {list.data
                ? totalPages > 1
                  ? t("paginationSummary", { from: pageFrom, to: pageTo, total })
                  : t("showingCount", { shown: products.length, total })
                : t("loading")}
              {refreshing && <span className="text-faint">{t("updating")}</span>}
            </span>
            <span className="flex items-center gap-3 shrink-0">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="inline-flex items-center gap-1 h-7 px-2 -mr-2 rounded-md text-[12.5px] font-medium text-iris-hi hover:bg-iris-soft transition-colors cursor-pointer"
                >
                  <X size={13} />
                  <span>{t("clearFiltersCount", { count: activeFilterCount })}</span>
                </button>
              )}
              {totalPages > 1 && (
                <span className="font-mono tabular text-faint">{t("pageOf", { current: validPage, total: totalPages })}</span>
              )}
            </span>
          </div>

          {/* Results */}
          <div aria-busy={list.isFetching} className={`transition-opacity duration-150 ${refreshing ? "opacity-60" : ""}`}>
            {list.isError && !list.data ? (
              <Card className="p-8 text-center max-w-md mx-auto">
                <div className="w-12 h-12 rounded-full bg-bad-soft text-bad flex items-center justify-center mx-auto mb-3">
                  <AlertCircle size={20} />
                </div>
                <p className="text-[14px] font-medium text-fg">{t("productsLoadError")}</p>
                <div className="mt-4">
                  <Button type="button" size="sm" variant="secondary" onClick={() => list.refetch()}>{t("retry")}</Button>
                </div>
              </Card>
            ) : !list.data ? (
              <div className="rounded-card border border-line bg-surface divide-y divide-line animate-pulse" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3">
                    <div className="h-11 w-11 rounded-lg bg-raised" />
                    <div className="flex-1 space-y-1.5"><div className="h-4 w-1/2 rounded bg-raised" /><div className="h-3 w-1/3 rounded bg-raised" /></div>
                    <div className="h-4 w-16 rounded bg-raised" />
                  </div>
                ))}
              </div>
            ) : products.length === 0 ? (
              <Card className="p-10 sm:p-12 text-center max-w-md mx-auto">
                <div className="w-12 h-12 rounded-full bg-raised flex items-center justify-center mx-auto mb-3 text-faint">
                  <Search size={20} />
                </div>
                <div className="font-medium text-fg text-[15px]">
                  {hasActiveFilters ? t("emptyFilter") : t("emptyCategory")}
                </div>
                {hasActiveFilters && <p className="text-[13px] text-muted mt-1.5">{t("emptyFilterHint")}</p>}
                <div className="mt-5 flex items-center justify-center gap-3">
                  {hasActiveFilters && (
                    <Button type="button" size="sm" variant="secondary" onClick={handleResetFilters}>{t("resetFilters")}</Button>
                  )}
                  <Link href="/categories">
                    <Button type="button" size="sm" variant="ghost">{t("otherCategories")}</Button>
                  </Link>
                </div>
              </Card>
            ) : viewMode === "grid" ? (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 items-stretch">
                {products.map((p) => (
                  <ProductTile key={p.id} product={p} layout="grid" density="detailed" />
                ))}
              </div>
            ) : (
              <div className="rounded-card border border-line bg-surface divide-y divide-line overflow-hidden">
                {products.map((p) => (
                  <ProductRow key={p.id} product={p} context={p.category_id !== headline.id ? nameById.get(p.category_id) ?? null : null} />
                ))}
              </div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 pt-4 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-[13px] text-muted">{t("paginationSummary", { from: pageFrom, to: pageTo, total })}</div>
              <Pagination page={validPage} totalPages={totalPages} onChange={setPageAndScroll} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
