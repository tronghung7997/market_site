"use client";

/** Catalog explorer, one category: same rail as the hub, plus a toolbar for
 *  search / sort / filters and a paginated list. Filter changes update the
 *  URL with `history.replaceState` and refetch through `/api` while the
 *  current list stays on screen — no route re-render, no blank frame. */

import { Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { flattenCategories } from "@/lib/categories";
import { categoryPath, matchCategoryParam } from "@/lib/routes";
import { useMoney } from "@/lib/money";
import { Button, Card, Pagination } from "@/components/ui";
import { AlertCircle, Bolt, Check, ChevronDown, ChevronRight, Grid, ListFilter, Rows, Search, Star, X } from "@/components/Icons";
import ProductTile from "@/components/ProductTile";
import { ProductRow } from "@/components/products/ProductRow";
import { browseKind, browseQueryToListOpts, browsePage, BROWSE_PER_PAGE, DEFAULT_BROWSE_SORT, DELIVERY_KINDS, RATING_FILTERS, useCategoryProducts } from "@/features/catalog/client";
import { MarkdownContent } from "@/components/MarkdownContent";
import type { CategoryBrowseQuery } from "@/features/catalog/client";
import type { CategoryPageCatalog } from "@/features/catalog";
import type { Category } from "@/lib/types";
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
  const children = category?.children ?? [];
  // `?sub=` narrows a parent page to one child; accepts a slug or a legacy id.
  const subFromParam = (raw: string | null | undefined) => matchCategoryParam(raw, children);

  // ---- URL state -------------------------------------------------------
  // Grid is the default; `?view=list` opts into rows.
  const readView = (): ViewMode => (searchParams?.get("view") === "list" ? "list" : "grid");
  const [q, setQ] = useState(searchParams?.get("q") || "");
  const readKind = () => browseKind({ kind: searchParams?.get("kind") ?? undefined, instant: searchParams?.get("instant") ?? undefined }) ?? "";
  const [sort, setSort] = useState<string>(searchParams?.get("sort") || DEFAULT_BROWSE_SORT);
  const [inStockOnly, setInStockOnly] = useState(searchParams?.get("stock") === "1");
  const [kind, setKind] = useState<string>(readKind);
  // Phones: the filter chips fold behind one "Lọc" button so products come first.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [priceRange, setPriceRange] = useState<string>(searchParams?.get("price") || "all");
  const [customMin, setCustomMin] = useState(searchParams?.get("min") || "");
  const [customMax, setCustomMax] = useState(searchParams?.get("max") || "");
  const [minVnd, setMinVnd] = useState(searchParams?.get("min_vnd") || "");
  const [maxVnd, setMaxVnd] = useState(searchParams?.get("max_vnd") || "");
  const [rating, setRating] = useState(searchParams?.get("rating") || "");
  const [viewMode, setViewMode] = useState<ViewMode>(readView);
  const [subSlug, setSubSlug] = useState<string | null>(subFromParam(searchParams?.get("sub"))?.slug ?? null);
  const [page, setPage] = useState<number>(browsePage(searchParams?.get("page") || undefined));
  const [customOpen, setCustomOpen] = useState((searchParams?.get("price") || "all") === "custom");

  // Back/forward and external navigation: mirror the URL into state.
  useEffect(() => {
    if (!isTypingRef.current) setQ(searchParams?.get("q") || "");
    setSort(searchParams?.get("sort") || DEFAULT_BROWSE_SORT);
    setInStockOnly(searchParams?.get("stock") === "1");
    setKind(readKind());
    setPriceRange(searchParams?.get("price") || "all");
    setCustomMin(searchParams?.get("min") || "");
    setCustomMax(searchParams?.get("max") || "");
    setMinVnd(searchParams?.get("min_vnd") || "");
    setMaxVnd(searchParams?.get("max_vnd") || "");
    setRating(searchParams?.get("rating") || "");
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
        (key === "view" && val === "grid") || (key === "sort" && val === DEFAULT_BROWSE_SORT);
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
    q, sort, stock: inStockOnly ? "1" : undefined, kind: kind || undefined,
    price: priceRange, minVnd, maxVnd, rating, page: String(page),
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
    setKind("");
    setPriceRange("all");
    setCustomMin("");
    setCustomMax("");
    setMinVnd("");
    setMaxVnd("");
    setRating("");
    setSort(DEFAULT_BROWSE_SORT);
    setPage(1);
    setCustomOpen(false);
    syncToUrl({ q: null, stock: null, instant: null, kind: null, price: null, min: null, max: null, min_vnd: null, max_vnd: null, rating: null, sort: null, page: null });
  };

  const ratingActive = (RATING_FILTERS as readonly string[]).includes(rating);
  const activeFilterCount =
    (q.trim() ? 1 : 0) + (inStockOnly ? 1 : 0) + (kind ? 1 : 0) + (priceRange !== "all" ? 1 : 0) + (ratingActive ? 1 : 0);
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

  // An unknown slug 404s in page.tsx, so no category here means the load failed.
  if (!category) {
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

  const content = initial.content;
  const description = !subCat ? content?.description ?? null : null;

  const pageFrom = (validPage - 1) * perPage + 1;
  const pageTo = (validPage - 1) * perPage + products.length;
  const headline = activeCat ?? category;

  // Breadcrumb, name, size and the rail live in the /categories layout
  // (CatalogShell), which stays mounted across categories: this is the pane.
  return (
        <div ref={paneRef} className="min-w-0 scroll-mt-24">
          {description && <p className="mb-4 max-w-[720px] text-[13.5px] leading-relaxed text-muted">{description}</p>}
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
                  className="h-10 w-full rounded-lg bg-base border border-line pl-10 pr-9 text-sm text-fg placeholder:text-placeholder transition-colors focus:border-iris focus:ring-1 focus:ring-iris/30 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
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

            <button
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="category-filters"
              onClick={() => setFiltersOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 border-t border-line px-3 h-11 text-[13px] font-medium text-fg md:hidden"
            >
              <span className="inline-flex items-center gap-1.5">
                <ListFilter size={14} /> {t("filtersLabel")}
                {activeFilterCount > 0 && <span className="rounded-md bg-iris-soft px-1.5 font-mono text-[11px] text-iris-hi">{activeFilterCount}</span>}
              </span>
              <ChevronRight size={14} className={`text-faint transition-transform ${filtersOpen ? "rotate-90" : ""}`} />
            </button>
            <div id="category-filters" className={`border-t border-line px-3 py-2.5 items-center gap-2 flex-wrap ${filtersOpen ? "flex" : "hidden"} md:flex`}>
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
              <label className={`${chip(!!kind)} pr-1.5`}>
                <Bolt size={13} className={kind ? "fill-iris-hi" : "text-faint"} />
                <span className="sr-only">{t("deliveryKindLabel")}</span>
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value);
                    setPage(1);
                    syncToUrl({ kind: e.target.value || null, instant: null, page: "1" });
                  }}
                  aria-label={t("deliveryKindLabel")}
                  className="h-full bg-transparent pr-1 font-medium focus:outline-none cursor-pointer"
                >
                  <option value="">{t("deliveryKindAll")}</option>
                  {DELIVERY_KINDS.map((k) => <option key={k} value={k}>{t(`deliveryKind.${k}`)}</option>)}
                </select>
              </label>

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

              <span className="hidden sm:block h-5 w-px bg-line mx-1" aria-hidden="true" />

              <div role="group" aria-label={t("ratingLabel")} className="flex items-center gap-1.5 flex-wrap">
                {RATING_FILTERS.map((stars) => (
                  <button
                    key={stars}
                    type="button"
                    aria-pressed={rating === stars}
                    onClick={() => {
                      const next = rating === stars ? "" : stars;
                      setRating(next);
                      setPage(1);
                      syncToUrl({ rating: next || null, page: "1" });
                    }}
                    className={chip(rating === stars)}
                  >
                    <Star size={13} className={rating === stars ? "fill-iris-hi" : "text-warn fill-warn"} />
                    <span>{t("ratingAtLeast", { stars })}</span>
                  </button>
                ))}
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
                    className="w-24 h-9 px-2.5 rounded-lg bg-base border border-line text-fg font-mono tabular text-[13px] placeholder:text-placeholder placeholder:font-sans focus:outline-none focus:border-iris"
                    aria-label={t("priceMin")}
                  />
                  <span className="text-faint">–</span>
                  <input
                    type="number" min="0" step={currency === "USD" ? "0.1" : "1000"} inputMode="decimal"
                    placeholder={t("priceMax")} value={customMax} onChange={(e) => setCustomMax(e.target.value)}
                    className="w-24 h-9 px-2.5 rounded-lg bg-base border border-line text-fg font-mono tabular text-[13px] placeholder:text-placeholder placeholder:font-sans focus:outline-none focus:border-iris"
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
              <EmptyResults
                search={q.trim()}
                categoryName={headline.name}
                categoryId={headline.id}
                flatCats={flatCats}
                filterLabels={[
                  inStockOnly ? t("inStockOnly") : null,
                  kind ? t(`deliveryKind.${kind}`) : null,
                  priceRange === "custom"
                    ? t("priceCustom")
                    : priceRange !== "all" ? pricePresets.find((p) => p.key === priceRange)?.label ?? null : null,
                  ratingActive ? t("ratingAtLeast", { stars: rating }) : null,
                ].filter((label): label is string => Boolean(label))}
                onReset={handleResetFilters}
              />
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

          <CategoryGuide name={category.name} guide={content?.guide ?? null} faq={content?.faq ?? []} />
        </div>
  );
}

/** No products on this page. Names only the filters that are actually on,
 *  and for a search looks across the whole marketplace: which other
 *  branches have hits (each a link carrying the query) and the global count. */
function EmptyResults({
  search,
  categoryName,
  categoryId,
  flatCats,
  filterLabels,
  onReset,
}: {
  search: string;
  categoryName: string;
  categoryId: number;
  flatCats: Category[];
  filterLabels: string[];
  onReset: () => void;
}) {
  const t = useTranslations("categories");
  const elsewhere = useQuery({
    queryKey: queryKeys.categoryProducts({ scope: "all", search, perPage: 50 }),
    queryFn: ({ signal }) => api.products({ search, sort: "relevance", perPage: 50, signal }),
    enabled: search.length > 0,
    staleTime: 30_000,
  });
  const byId = new Map(flatCats.map((c) => [c.id, c]));
  const topOf = (id: number): Category | null => {
    let node = byId.get(id) ?? null;
    while (node && node.parent_id != null) node = byId.get(node.parent_id) ?? null;
    return node;
  };
  const here = topOf(categoryId);
  const branchHits = new Map<number, { cat: Category; count: number }>();
  for (const p of elsewhere.data?.items ?? []) {
    const top = topOf(p.category_id);
    if (!top || top.id === here?.id) continue;
    const hit = branchHits.get(top.id) ?? { cat: top, count: 0 };
    hit.count += 1;
    branchHits.set(top.id, hit);
  }
  const branches = [...branchHits.values()].sort((a, b) => b.count - a.count).slice(0, 3);
  const globalTotal = elsewhere.data?.total ?? 0;
  const hasFilters = search.length > 0 || filterLabels.length > 0;

  return (
    <Card className="p-8 sm:p-10 text-center max-w-lg mx-auto">
      <div className="w-12 h-12 rounded-full bg-raised flex items-center justify-center mx-auto mb-3 text-faint">
        <Search size={20} />
      </div>
      <div className="font-medium text-fg text-[15px]">
        {!hasFilters
          ? t("emptyCategory")
          : search && filterLabels.length === 0
            ? t("emptySearch", { q: search, name: categoryName })
            : t("emptyFiltered")}
      </div>
      {filterLabels.length > 0 && (
        <p className="text-[13px] text-muted mt-1.5">{t("emptyFilteredHint", { filters: filterLabels.join(" · ") })}</p>
      )}
      {branches.length > 0 && (
        <div className="mt-4">
          <p className="text-[12.5px] text-faint">{t("emptyElsewhere", { q: search })}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {branches.map(({ cat, count }) => (
              <Link
                key={cat.id}
                href={`${categoryPath(cat)}?q=${encodeURIComponent(search)}`}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-iris/25 bg-iris-soft text-[12.5px] font-medium text-iris-hi hover:bg-iris hover:text-white transition-colors"
              >
                {cat.name}
                <span className="font-mono tabular text-[11px] opacity-80">{count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        {hasFilters && (
          <Button type="button" size="sm" variant="secondary" onClick={onReset}>{t("resetFilters")}</Button>
        )}
        {search && globalTotal > 0 ? (
          <Link href={`/search?q=${encodeURIComponent(search)}`}>
            <Button type="button" size="sm" variant="ghost">{t("searchEverywhereCount", { q: search, count: globalTotal })}</Button>
          </Link>
        ) : (
          <Link href="/categories">
            <Button type="button" size="sm" variant="ghost">{t("otherCategories")}</Button>
          </Link>
        )}
      </div>
    </Card>
  );
}

/** Admin-written guide (markdown, raw HTML disabled) and FAQ for the
 *  category. Hidden when the admin has not written either. */
function CategoryGuide({ name, guide, faq }: { name: string; guide: string | null; faq: { q: string; a: string }[] }) {
  const t = useTranslations("categories");
  if (!guide && faq.length === 0) return null;
  return (
    <section aria-label={t("guideTitle", { name })} className="mt-10 space-y-5">
      {guide && (
        <Card className="p-5 sm:p-6">
          <h2 className="font-serif text-[18px] font-semibold tracking-tight">{t("guideTitle", { name })}</h2>
          <div className="mt-3 text-[13.5px] max-w-[760px]">
            <MarkdownContent>{guide}</MarkdownContent>
          </div>
        </Card>
      )}
      {faq.length > 0 && (
        <Card className="overflow-hidden">
          <h2 className="px-5 py-4 border-b border-line font-serif text-[18px] font-semibold tracking-tight">{t("faqTitle", { name })}</h2>
          <ul className="divide-y divide-line">
            {faq.map((item) => (
              <li key={item.q}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3.5 text-[13.5px] font-medium hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris [&::-webkit-details-marker]:hidden">
                    <span>{item.q}</span>
                    <ChevronDown size={15} className="shrink-0 text-faint transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="px-5 pb-4 -mt-0.5 text-[13px] leading-relaxed text-muted whitespace-pre-line max-w-[760px]">{item.a}</p>
                </details>
              </li>
            ))}
          </ul>
          <Link href="/support#buying" className="block border-t border-line px-5 py-3 text-[12.5px] font-medium text-iris-hi hover:underline">
            {t("buyingHelp")}
          </Link>
        </Card>
      )}
    </section>
  );
}
