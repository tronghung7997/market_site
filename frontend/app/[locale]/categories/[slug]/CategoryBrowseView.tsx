"use client";

/** Catalog explorer pane: one category, or the whole catalog ("Tất cả",
 *  `categoryId` null). A toolbar for search (products or shop names) / sort /
 *  filters, a shop strip, and a paginated grid of offers. Filter changes update
 *  the URL with `history.replaceState` and refetch through `/api` while the
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
import { Button, Card } from "@/components/ui";
import { SelectMenu } from "@/components/ui/SelectMenu";
import { AlertCircle, Bolt, Check, ChevronDown, ChevronRight, Grid, ListFilter, Rows, Search, Star, X } from "@/components/Icons";
import { ProductRow } from "@/components/products/ProductRow";
import { browseKind, browseQueryToListOpts, browsePage, BROWSE_SORTS, DEFAULT_BROWSE_SORT, DELIVERY_KINDS, OfferFeed, OfferGridSkeleton, RATING_FILTERS, useInfiniteOffers } from "@/features/catalog/client";
import { ShopStrip } from "@/features/catalog/ui/ShopStrip";
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
  /** null = the whole catalog. */
  categoryId: number | null;
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
  const isAll = categoryId == null;
  const category = isAll ? null : flatCats.find((c) => c.id === categoryId) ?? null;
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
  // One shop's offers (`?shop=`); the name comes from the strip that set it.
  const [shop, setShop] = useState(searchParams?.get("shop") || "");
  const [shopName, setShopName] = useState<string | null>(null);
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
    setShop(searchParams?.get("shop") || "");
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
    price: priceRange, minVnd, maxVnd, rating, shop: shop || undefined, page: String(page),
  };
  const listOpts = browseQueryToListOpts(browseQuery, isAll ? null : activeCat?.id ?? categoryId);
  const seed = initial.listOpts && initial.result ? { opts: initial.listOpts, data: initial.result } : null;
  // Pages after the first load as the buyer scrolls (OfferFeed); `?page=N`
  // only says where the list starts, for shared links and crawlers.
  const list = useInfiniteOffers(listOpts, seed);
  const products = list.items;
  const refreshing = list.isPlaceholderData;
  // An old `?page=N` past the end (the list shrank): start from the top.
  useEffect(() => {
    if (page > 1 && list.data && !list.isPlaceholderData && products.length === 0 && list.total > 0) {
      setPage(1);
      syncToUrl({ page: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, list.data, list.isPlaceholderData, products.length, list.total]);

  const rate = fxRate && fxRate > 0 ? fxRate : 25000;
  const tier1Vnd = currency === "USD" ? rate : 25000;
  const tier2Vnd = currency === "USD" ? rate * 2 : 50000;

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
    setShop("");
    setShopName(null);
    syncToUrl({ q: null, stock: null, instant: null, kind: null, price: null, min: null, max: null, min_vnd: null, max_vnd: null, rating: null, sort: null, shop: null, page: null });
  };

  /** Picking a shop replaces the search that found it: show all its offers. */
  const applyShop = (ref: string | null, name: string | null) => {
    setShop(ref ?? "");
    setShopName(name);
    setPage(1);
    if (ref) setQ("");
    syncToUrl(ref ? { shop: ref, q: null, page: "1" } : { shop: null, page: "1" });
    if (ref) paneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const ratingActive = (RATING_FILTERS as readonly string[]).includes(rating);
  const activeFilterCount =
    (q.trim() ? 1 : 0) + (inStockOnly ? 1 : 0) + (kind ? 1 : 0) + (priceRange !== "all" ? 1 : 0) + (ratingActive ? 1 : 0) + (shop ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  const chip = (active: boolean, tone: "good" | "iris" = "iris") =>
    `inline-flex items-center gap-1.5 h-11 sm:h-8 px-3 rounded-lg text-[12.5px] font-medium border transition-colors cursor-pointer shrink-0 ${
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
  if (!isAll && !category) {
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

  const scopeName = (activeCat ?? category)?.name ?? t("allProducts");
  const scopeId = (activeCat ?? category)?.id ?? null;
  const activeShopName = shop ? shopName ?? products[0]?.seller_name ?? shop : null;

  // Breadcrumb, name, size and the rail live in the /categories layout
  // (CatalogShell), which stays mounted across categories: this is the pane.
  return (
        <div ref={paneRef} className="min-w-0 scroll-mt-28">
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
                  placeholder={isAll ? t("searchOffersAll") : t("searchOffersIn", { name: scopeName })}
                  aria-label={isAll ? t("searchOffersAll") : t("searchOffersIn", { name: scopeName })}
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
                <SelectMenu
                  value={sort}
                  options={BROWSE_SORTS.map((key) => ({ value: key, label: t(`sortOption.${key}`) }))}
                  onChange={(next) => {
                    setSort(next);
                    setPage(1);
                    syncToUrl({ sort: next, page: "1" });
                  }}
                  label={tc("sort")}
                  prefix={tc("sort")}
                  align="end"
                  className="flex-1 bg-base md:w-60 md:flex-none"
                />

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
              <SelectMenu
                value={kind}
                options={[{ value: "", label: t("deliveryKindAll") }, ...DELIVERY_KINDS.map((k) => ({ value: k as string, label: t(`deliveryKind.${k}`) }))]}
                onChange={(next) => {
                  setKind(next);
                  setPage(1);
                  syncToUrl({ kind: next || null, instant: null, page: "1" });
                }}
                label={t("deliveryKindLabel")}
                icon={<Bolt size={13} className={kind ? "fill-iris-hi text-iris-hi" : undefined} />}
                active={!!kind}
                className="h-11 shrink-0 gap-1.5 pl-3 pr-2 text-[12.5px] sm:h-8"
              />

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

              {/* One switch, not 3★/4★ steps: almost every rated offer is 4★+, so the
                  steps returned the same list. It keeps offers buyers rated 4★ or
                  more (unrated ones drop out); older ?rating=3 links still apply. */}
              <button
                type="button"
                aria-pressed={ratingActive}
                title={t("wellRatedHint")}
                onClick={() => {
                  const next = ratingActive ? "" : "4";
                  setRating(next);
                  setPage(1);
                  syncToUrl({ rating: next || null, page: "1" });
                }}
                className={chip(ratingActive)}
              >
                <Star size={13} className={ratingActive ? "fill-iris-hi text-iris-hi" : "text-warn fill-warn"} />
                <span>{t("wellRated")}</span>
              </button>

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

          {!shop && (
            <ShopStrip
              query={debouncedQ.trim()}
              topShops={isAll && list.firstPage === 1 ? initial.topShops ?? [] : []}
              onPick={(ref, name) => applyShop(ref, name)}
            />
          )}

          {/* Result line */}
          <div className="mt-4 mb-3 flex items-center justify-between gap-3 text-[12.5px] text-muted" aria-live="polite">
            <span className="inline-flex items-center gap-2 flex-wrap">
              {activeShopName && (
                <span className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1 rounded-md border border-iris/30 bg-iris-soft text-[12.5px] font-medium text-iris-hi">
                  {t("shopFilter", { name: activeShopName })}
                  <button
                    type="button"
                    onClick={() => applyShop(null, null)}
                    aria-label={t("clearShopFilter")}
                    className="h-5 w-5 grid place-items-center rounded hover:bg-iris hover:text-white cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
              {list.data ? t("showingCount", { shown: products.length, total: list.total }) : t("loading")}
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
              <OfferGridSkeleton />
            ) : products.length === 0 ? (
              <EmptyResults
                search={q.trim()}
                categoryName={scopeName}
                categoryId={scopeId}
                flatCats={flatCats}
                filterLabels={[
                  inStockOnly ? t("inStockOnly") : null,
                  kind ? t(`deliveryKind.${kind}`) : null,
                  priceRange === "custom"
                    ? t("priceCustom")
                    : priceRange !== "all" ? pricePresets.find((p) => p.key === priceRange)?.label ?? null : null,
                  ratingActive ? t("wellRated") : null,
                  activeShopName ? t("shopFilter", { name: activeShopName }) : null,
                ].filter((label): label is string => Boolean(label))}
                onReset={handleResetFilters}
              />
            ) : (
              <OfferFeed
                feed={list}
                view={viewMode}
                hideShop={Boolean(shop)}
                renderRow={(p) => <ProductRow product={p} context={p.category_id !== scopeId ? nameById.get(p.category_id) ?? null : null} />}
              />
            )}
          </div>

          {category && <CategoryGuide name={category.name} guide={content?.guide ?? null} faq={content?.faq ?? []} />}
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
  categoryId: number | null;
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
  const here = categoryId != null ? topOf(categoryId) : null;
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
