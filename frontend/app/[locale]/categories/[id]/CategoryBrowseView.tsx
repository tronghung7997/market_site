"use client";

import { Link, useRouter, usePathname } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { flattenCategories } from "@/lib/categories";
import { useMoney } from "@/lib/money";
import { Button, Card, Tag } from "@/components/ui";
import { Bolt, Check, ChevronLeft, ChevronRight, Grid, Rows, Search, ShieldCheck, Star, X } from "@/components/Icons";
import { categoryCoverId, ProductCover } from "@/features/product-covers";
import ProductTile from "@/components/ProductTile";
import type { CategoryPageCatalog } from "@/features/catalog";
import { useDebounce } from "@/lib/hooks/useDebounce";

const ITEMS_PER_PAGE = 24;

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const { formatBrowseMoney, currency, fxRate } = useMoney();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const productsListRef = useRef<HTMLDivElement>(null);
  // Blocks the URL→state sync from overwriting q while user is typing.
  const isTypingRef = useRef(false);

  const cats = initial.categories;
  const products = initial.products;
  const error = initial.error ? t("loadError") : null;

  // URL state synchronization
  const paramQ = searchParams?.get("q") || "";
  const paramSort = searchParams?.get("sort") || "newest";
  const paramStock = searchParams?.get("stock") === "1";
  const paramInstant = searchParams?.get("instant") === "1";
  const paramPrice = searchParams?.get("price") || "all";
  const paramMin = searchParams?.get("min") || "";
  const paramMax = searchParams?.get("max") || "";
  const rawView = searchParams?.get("view");
  const paramView: "grid" | "list" = rawView === "list" ? "list" : "grid";
  const rawSub = Number(searchParams?.get("sub"));
  const paramSub = Number.isFinite(rawSub) && rawSub > 0 ? rawSub : null;
  const rawPage = Number(searchParams?.get("page") || "1");
  const paramPage = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;

  const [q, setQ] = useState(paramQ);
  const [sort, setSort] = useState<string>(paramSort);
  const [inStockOnly, setInStockOnly] = useState(paramStock);
  const [instantOnly, setInstantOnly] = useState(paramInstant);
  const [priceRange, setPriceRange] = useState<string>(paramPrice);
  const [customMin, setCustomMin] = useState(paramMin);
  const [customMax, setCustomMax] = useState(paramMax);
  const [viewMode, setViewMode] = useState<"grid" | "list">(paramView);
  const [subFilter, setSubFilter] = useState<number | null>(paramSub);
  const [currentPage, setCurrentPage] = useState<number>(paramPage);

  // Sync FROM URL (browser back/forward, external navigation, non-q filter changes).
  // q is skipped while the user is typing to prevent character truncation.
  useEffect(() => {
    const nextView = searchParams?.get("view");
    const nextPage = Number(searchParams?.get("page") || "1");
    const nextSub = Number(searchParams?.get("sub"));

    if (!isTypingRef.current) {
      setQ(searchParams?.get("q") || "");
    }
    setSort(searchParams?.get("sort") || "newest");
    setInStockOnly(searchParams?.get("stock") === "1");
    setInstantOnly(searchParams?.get("instant") === "1");
    setPriceRange(searchParams?.get("price") || "all");
    setCustomMin(searchParams?.get("min") || "");
    setCustomMax(searchParams?.get("max") || "");
    setViewMode(nextView === "list" ? "list" : "grid");
    setSubFilter(Number.isFinite(nextSub) && nextSub > 0 ? nextSub : null);
    setCurrentPage(Number.isFinite(nextPage) && nextPage > 0 ? Math.floor(nextPage) : 1);
  }, [searchParams]);

  const flatCats = useMemo(() => flattenCategories(cats), [cats]);
  const category = flatCats.find((c) => c.id === categoryId) ?? null;
  const parent = category?.parent_id != null ? flatCats.find((c) => c.id === category.parent_id) ?? null : null;
  const siblings = parent?.children ?? [];
  const children = category?.children ?? [];

  // Update URL search parameters when filters change
  const syncToUrl = (updates: Record<string, string | null>) => {
    startTransition(() => {
      const params = new URLSearchParams(searchParams?.toString() || "");
      Object.entries(updates).forEach(([key, val]) => {
        if (val === null || val === "" || (key === "page" && val === "1") || (key === "price" && val === "all") || (key === "view" && val === "grid") || (key === "sort" && val === "newest")) {
          params.delete(key);
        } else {
          params.set(key, val);
        }
      });
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  // Debounced q — URL updates only after user STOPS typing for 250ms.
  const debouncedQ = useDebounce(q, 250);

  useEffect(() => {
    const urlQuery = searchParams?.get("q") || "";
    const normalized = debouncedQ.trim();
    if (normalized === urlQuery) {
      isTypingRef.current = false;
      return;
    }
    syncToUrl({ q: normalized || null, page: "1" });
    setCurrentPage(1);
    // searchParams intentionally excluded — guard reads it synchronously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const rate = fxRate && fxRate > 0 ? fxRate : 25000;
  const tier1Vnd = currency === "USD" ? rate : 25000;
  const tier2Vnd = currency === "USD" ? rate * 2 : 50000;

  const totalPages = Math.max(1, Math.ceil(initial.total / initial.perPage));
  const validPage = Math.min(currentPage, totalPages);
  const pagedItems = products;
  const pageNumbers = Array.from(
    new Set([
      1,
      totalPages,
      ...Array.from({ length: 5 }, (_, index) => validPage - 2 + index),
    ]),
  ).filter((pageNumber) => pageNumber >= 1 && pageNumber <= totalPages).sort((a, b) => a - b);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    syncToUrl({ page: newPage > 1 ? String(newPage) : null });
    productsListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleResetFilters = () => {
    setQ("");
    setInStockOnly(false);
    setInstantOnly(false);
    setPriceRange("all");
    setCustomMin("");
    setCustomMax("");
    setSubFilter(null);
    setSort("newest");
    setCurrentPage(1);
    syncToUrl({
      q: null,
      stock: null,
      instant: null,
      price: null,
      min: null,
      max: null,
      min_vnd: null,
      max_vnd: null,
      sub: null,
      sort: null,
      page: null,
    });
  };

  const hasActiveFilters = Boolean(
    q.trim() || inStockOnly || instantOnly || priceRange !== "all" || subFilter !== null || customMin.trim() || customMax.trim()
  );

  if (error || !category) {
    return (
      <div className="w-full mx-auto max-w-[1240px] px-6 py-16">
        <Card className="p-8 text-sm max-w-md mx-auto text-center">
          <p className="text-bad font-medium">{error ?? t("notFound")}</p>
          <Link href="/categories" className="inline-block mt-4 text-iris-hi hover:underline text-[13px]">
            {t("backToAll")}
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto max-w-[1240px] px-4 sm:px-6 py-5 sm:py-7">
      {/* Breadcrumb Navigation */}
      <nav aria-label={tc("breadcrumb")} className="flex items-center gap-1.5 text-[12.5px] text-muted mb-4 flex-wrap">
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
        <span className="text-fg font-medium truncate">{category.name}</span>
      </nav>

      {/* Category Hero Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-line">
        <div className="flex items-center gap-3.5 min-w-0">
          <ProductCover
            coverId={categoryCoverId(category)}
            title={category.name}
            className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl shrink-0 shadow-sm"
          />
          <div className="min-w-0">
            <h1 className="font-serif text-[24px] sm:text-[28px] leading-tight font-semibold text-fg truncate">
              {category.name}
            </h1>
            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[12.5px] text-muted mt-1">
              <span>{t("sellingCount", { count: initial.total })}</span>
              <span className="text-faint">·</span>
              <span className="text-good font-medium inline-flex items-center gap-1">
                <ShieldCheck size={13} /> {t("escrowProtected")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Sibling Categories Bar (If current category is a child) */}
      {parent && siblings.length > 0 && (
        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none text-[12.5px]">
          <span className="text-faint text-[12px] font-medium shrink-0">
            {t("siblingsTitle")}
          </span>
          <Link
            href={`/categories/${parent.id}`}
            className="px-3 py-1 rounded-full bg-surface border border-line text-muted hover:text-fg hover:border-line-2 shrink-0 transition-colors"
          >
            ← {parent.name}
          </Link>
          {siblings.map((sib) => {
            const isCurrent = sib.id === categoryId;
            return (
              <Link
                key={sib.id}
                href={`/categories/${sib.id}`}
                className={`px-3.5 py-1 rounded-full shrink-0 font-medium transition-all ${
                  isCurrent
                    ? "bg-iris text-white shadow-sm"
                    : "bg-surface text-muted border border-line hover:text-fg hover:border-line-2"
                }`}
              >
                {sib.name}
              </Link>
            );
          })}
        </div>
      )}

      {/* Subcategory Pills Bar (If current category has children) */}
      {!parent && children.length > 0 && (
        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none">
          <button
            type="button"
            onClick={() => {
              setSubFilter(null);
              syncToUrl({ sub: null, page: "1" });
              setCurrentPage(1);
            }}
            className={`h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-all shrink-0 cursor-pointer ${
              subFilter === null
                ? "bg-iris text-white shadow-sm"
                : "bg-surface text-muted border border-line hover:text-fg hover:border-line-2"
            }`}
          >
            {t("allCategories")}
          </button>
          {children.map((c) => {
            const isSelected = subFilter === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  const nextSub = isSelected ? null : c.id;
                  setSubFilter(nextSub);
                  syncToUrl({ sub: nextSub ? String(nextSub) : null, page: "1" });
                  setCurrentPage(1);
                }}
                className={`h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
                  isSelected
                    ? "bg-iris text-white shadow-sm"
                    : "bg-surface text-muted border border-line hover:text-fg hover:border-line-2"
                }`}
              >
                <span>{c.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Command & Filter Toolbar */}
      <div ref={productsListRef} className="mt-5 space-y-3 scroll-mt-24">
        {/* Row 1: Search, View Mode, Sort */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
          {/* Internal Search Bar */}
          <div className="relative flex-1 max-w-md">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={searchInputRef}
              type="text"
              value={q}
              onChange={(e) => { isTypingRef.current = true; setQ(e.target.value); }}
              placeholder={t("searchInCurrent", { name: category.name })}
              aria-label={t("searchInCurrent", { name: category.name })}
              className="h-10 w-full rounded-xl bg-surface border border-line pl-10 pr-9 text-sm text-fg placeholder:text-faint transition-all focus:border-iris focus:ring-1 focus:ring-iris/30 focus:outline-none"
            />
            {q && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  searchInputRef.current?.focus();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-fg p-0.5 cursor-pointer"
                aria-label={t("clearAllFilters")}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5 ml-auto w-full md:w-auto justify-between md:justify-end">
            {/* View Mode Switcher: Grid vs List */}
            <div className="flex items-center rounded-lg border border-line bg-surface p-0.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setViewMode("grid");
                  syncToUrl({ view: "grid" });
                }}
                className={`h-8 w-8 rounded-md grid place-items-center transition-colors cursor-pointer ${
                  viewMode === "grid" ? "bg-raised text-fg shadow-sm font-semibold" : "text-faint hover:text-fg"
                }`}
                title={t("viewGrid")}
                aria-label={t("viewGrid")}
                aria-pressed={viewMode === "grid"}
              >
                <Grid size={15} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("list");
                  syncToUrl({ view: "list" });
                }}
                className={`h-8 w-8 rounded-md grid place-items-center transition-colors cursor-pointer ${
                  viewMode === "list" ? "bg-raised text-fg shadow-sm font-semibold" : "text-faint hover:text-fg"
                }`}
                title={t("viewList")}
                aria-label={t("viewList")}
                aria-pressed={viewMode === "list"}
              >
                <Rows size={15} />
              </button>
            </div>

            {/* Sort Dropdown */}
            <select
              value={sort}
              onChange={(e) => {
                const nextSort = e.target.value;
                setSort(nextSort);
                syncToUrl({ sort: nextSort, page: "1" });
                setCurrentPage(1);
              }}
              aria-label={tc("sort")}
              className="h-10 rounded-xl bg-surface border border-line px-3 text-[13px] text-fg font-medium focus:border-iris focus:outline-none cursor-pointer"
            >
              <option value="newest">{t("sortNewest")}</option>
              <option value="bestseller">{t("sortBestseller")}</option>
              <option value="rating">{t("sortRating")}</option>
              <option value="price_asc">{t("sortPriceAsc")}</option>
              <option value="price_desc">{t("sortPriceDesc")}</option>
            </select>
          </div>
        </div>

        {/* Row 2: Faceted Filter Chips */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none flex-wrap">
          {/* Toggle In Stock */}
          <button
            type="button"
            aria-pressed={inStockOnly}
            onClick={() => {
              const next = !inStockOnly;
              setInStockOnly(next);
              syncToUrl({ stock: next ? "1" : null, page: "1" });
              setCurrentPage(1);
            }}
            className={`h-8 px-3 rounded-lg text-[12.5px] font-medium border transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              inStockOnly
                ? "border-good/50 bg-good-soft text-good shadow-sm"
                : "border-line bg-surface text-muted hover:text-fg hover:border-line-2"
            }`}
          >
            {inStockOnly && <Check size={13} className="text-good stroke-[2.5]" />}
            <span>{t("inStockOnly")}</span>
          </button>

          {/* Toggle Instant Delivery */}
          <button
              type="button"
              aria-pressed={instantOnly}
              onClick={() => {
                const next = !instantOnly;
                setInstantOnly(next);
                syncToUrl({ instant: next ? "1" : null, page: "1" });
                setCurrentPage(1);
              }}
              className={`h-8 px-3 rounded-lg text-[12.5px] font-medium border transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                instantOnly
                  ? "border-iris/50 bg-iris-soft text-iris-hi shadow-sm"
                  : "border-line bg-surface text-muted hover:text-fg hover:border-line-2"
              }`}
            >
              <Bolt size={13} className={instantOnly ? "text-iris-hi fill-iris-hi" : "text-faint"} />
              <span>{t("instantOnly")}</span>
          </button>

          {/* Price Range Preset Chips */}
          <div className="flex items-center gap-1 bg-surface border border-line p-0.5 rounded-lg shrink-0">
            {[
              { key: "all", label: t("priceAll") },
              { key: "under1", label: `< ${formatBrowseMoney(tier1Vnd, { locale })}` },
              { key: "1to2", label: `${formatBrowseMoney(tier1Vnd, { locale })} – ${formatBrowseMoney(tier2Vnd, { locale })}` },
              { key: "above2", label: `> ${formatBrowseMoney(tier2Vnd, { locale })}` },
            ].map((p) => {
              const isSelected = priceRange === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    setPriceRange(p.key);
                    setCustomMin("");
                    setCustomMax("");
                    syncToUrl({ price: p.key === "all" ? null : p.key, min: null, max: null, min_vnd: null, max_vnd: null, page: "1" });
                    setCurrentPage(1);
                  }}
                  className={`h-7 px-2.5 rounded text-[12px] font-medium transition-colors cursor-pointer ${
                    isSelected ? "bg-raised text-fg shadow-sm font-semibold" : "text-muted hover:text-fg"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Custom Price Range Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customMin || customMax) {
                setPriceRange("custom");
                syncToUrl({
                  price: "custom",
                  min: customMin.trim() || null,
                  max: customMax.trim() || null,
                  min_vnd: customMin.trim() ? String(Math.round(Number(customMin) * (currency === "USD" ? rate : 1))) : null,
                  max_vnd: customMax.trim() ? String(Math.round(Number(customMax) * (currency === "USD" ? rate : 1))) : null,
                  page: "1",
                });
                setCurrentPage(1);
              }
            }}
            className="flex items-center gap-1.5 bg-surface border border-line px-2 py-0.5 rounded-lg shrink-0 text-[12px]"
          >
            <input
              type="number"
              min="0"
              step={currency === "USD" ? "0.1" : "1000"}
              placeholder={locale === "vi" ? "Từ" : "Min"}
              value={customMin}
              onChange={(e) => setCustomMin(e.target.value)}
              className="w-16 sm:w-20 h-7 px-2 rounded bg-raised/50 border border-line text-fg font-mono text-[12px] placeholder:text-faint focus:outline-none focus:border-iris"
              aria-label={t("priceMin")}
            />
            <span className="text-faint">–</span>
            <input
              type="number"
              min="0"
              step={currency === "USD" ? "0.1" : "1000"}
              placeholder={locale === "vi" ? "Đến" : "Max"}
              value={customMax}
              onChange={(e) => setCustomMax(e.target.value)}
              className="w-16 sm:w-20 h-7 px-2 rounded bg-raised/50 border border-line text-fg font-mono text-[12px] placeholder:text-faint focus:outline-none focus:border-iris"
              aria-label={t("priceMax")}
            />
            <span className="text-[11px] text-faint font-mono font-medium">
              {currency === "USD" ? "$" : "₫"}
            </span>
            <button
              type="submit"
              className="h-7 px-2.5 rounded bg-raised hover:bg-raised-2 border border-line font-medium text-[11px] text-fg hover:text-iris-hi transition-colors cursor-pointer"
            >
              {t("priceApply")}
            </button>
          </form>

          {/* Reset All Filters Button */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="h-8 px-2.5 rounded-lg text-[12px] font-medium text-bad hover:bg-bad-soft border border-transparent hover:border-bad/20 transition-all cursor-pointer inline-flex items-center gap-1 ml-auto"
            >
              <X size={13} />
              <span>{t("clearAllFilters")}</span>
            </button>
          )}
        </div>
      </div>

      {/* Result Count Indicator */}
      <div className="mt-4 mb-3 flex items-center justify-between text-[12.5px] text-muted">
        <span>
          {t("showingCount", {
            shown: products.length,
            total: initial.total,
          })}
        </span>
        {totalPages > 1 && (
          <span className="font-mono text-faint">
            {t("pageOf", { current: validPage, total: totalPages })}
          </span>
        )}
      </div>

      {/* Product List / Grid */}
      <div aria-busy={isPending} className={isPending ? "opacity-60 transition-opacity" : "transition-opacity"}>
      {products.length === 0 ? (
        <Card className="p-12 text-center mt-4 max-w-md mx-auto">
          <div className="w-12 h-12 rounded-full bg-raised flex items-center justify-center mx-auto mb-3 text-faint">
            <Search size={20} />
          </div>
          <div className="font-medium text-fg text-[15px]">
            {hasActiveFilters ? t("emptyFilter") : t("emptyCategory")}
          </div>
          <p className="text-[13px] text-muted mt-1.5">
            {t("emptyFilterHint")}
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            {hasActiveFilters && (
              <Button type="button" size="sm" variant="secondary" onClick={handleResetFilters}>
                {t("resetFilters")}
              </Button>
            )}
            <Link href="/categories">
              <Button type="button" size="sm" variant="ghost">
                {t("otherCategories")}
              </Button>
            </Link>
          </div>
        </Card>
      ) : viewMode === "grid" ? (
        <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 items-stretch">
          {pagedItems.map((p) => (
            <ProductTile key={p.id} product={p} layout="grid" density="detailed" />
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {pagedItems.map((p) => (
            <ProductTile key={p.id} product={p} layout="list" />
          ))}
        </div>
      )}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="mt-8 pt-5 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-[13px] text-muted">
            {t("paginationSummary", {
              from: (validPage - 1) * ITEMS_PER_PAGE + 1,
              to: (validPage - 1) * initial.perPage + products.length,
              total: initial.total,
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={validPage <= 1}
              onClick={() => handlePageChange(validPage - 1)}
              className="cursor-pointer"
            >
              <ChevronLeft size={13} /> {t("prevPage")}
            </Button>
            {pageNumbers.map((pNum, index) => {
              const isCurrent = pNum === validPage;
              return (
                <span key={pNum} className="contents">
                  {index > 0 && pNum - pageNumbers[index - 1] > 1 && (
                    <span className="w-6 text-center text-faint" aria-hidden="true">…</span>
                  )}
                  <button
                    type="button"
                    onClick={() => handlePageChange(pNum)}
                    aria-current={isCurrent ? "page" : undefined}
                    className={`h-8 w-8 rounded-lg text-[13px] font-medium transition-all cursor-pointer ${
                      isCurrent
                        ? "bg-iris text-white shadow-sm font-semibold"
                        : "bg-surface text-muted border border-line hover:text-fg hover:border-line-2"
                    }`}
                  >
                    {pNum}
                  </button>
                </span>
              );
            })}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={validPage >= totalPages}
              onClick={() => handlePageChange(validPage + 1)}
              className="cursor-pointer"
            >
              {t("nextPage")} <ChevronRight size={13} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
