"use client";

/** Section "Toàn bộ sản phẩm" — the storefront shelf.
 *
 *  One filter bar (search · sort · view) plus facet chips that map 1:1 onto
 *  the public /products query: category branch, instant delivery, in stock,
 *  price tier. Rows show what a buyer needs to decide without opening the
 *  product: every package with its price, stock bucket, delivery, seller and
 *  escrow. Presentation state lives here; the active category is shared with
 *  the Categories section so the page owns it. */

import { Link } from "@/i18n/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { useVariantTermFor, type VariantTerm } from "@/lib/variant-term";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { parseCoverId } from "@/lib/product-covers";
import type { Category, Product, Variant } from "@/lib/types";
import { productPath } from "@/lib/routes";
import { productStockState, variantStockState } from "@/lib/stock";
import { fulfillmentFromProduct, fulfillmentTagKey, fulfillmentTagValues, fulfillmentTone } from "@/lib/fulfillment";
import { Button, Card, Input, Select, Spinner, Tag } from "@/components/ui";
import { ProductCover } from "@/components/products/ProductCover";
import { Bolt, Grid, Rows, Search, Shield, Star, Verified, X } from "@/components/Icons";
import { SectionHead } from "./SectionHead";
import { CategoryPicker } from "./CategoryPicker";

const COLLAPSED_LIMIT = 8;
const PAGE_SIZE = 24;
const PACKAGE_PREVIEW = 3;

type SortKey = "bestseller" | "newest" | "rating" | "price_asc" | "price_desc";
type PriceTier = "all" | "under1" | "1to2" | "above2";

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round"
      className={cn("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function FacetChip({ active, onClick, children, tone = "fg" }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "fg" | "good";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors whitespace-nowrap",
        active
          ? tone === "good" ? "border-good/40 bg-good-soft text-good" : "border-fg bg-fg text-surface"
          : "border-line bg-surface text-muted hover:border-line-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/** Stock bucket for one row: worst-case is what stops a purchase, so
 *  "out" only when nothing sells instantly and nothing is on request. */
function StockBadge({ product, t }: { product: Product; t: ReturnType<typeof useTranslations> }) {
  const state = productStockState(product.variants);
  if (state === "in_stock") return <Tag tone="good"><span className="h-1.5 w-1.5 rounded-full bg-good" /> {t("inStockShort")}</Tag>;
  if (state === "low") return <Tag tone="warn"><span className="h-1.5 w-1.5 rounded-full bg-warn" /> {t("lowStock")}</Tag>;
  if (state === "out") return <Tag tone="bad"><span className="h-1.5 w-1.5 rounded-full bg-bad" /> {t("outOfStock")}</Tag>;
  return <Tag tone="iris"><span className="h-1.5 w-1.5 rounded-full bg-iris" /> {t("onRequest")}</Tag>;
}

function PackageChips({ variants, term, formatPrice, t, max = PACKAGE_PREVIEW }: {
  variants: Variant[];
  term: VariantTerm;
  formatPrice: (v: number) => string;
  t: ReturnType<typeof useTranslations>;
  max?: number;
}) {
  if (variants.length === 0) return <span className="text-[12px] text-faint">{t("configuredToOrder")}</span>;
  const shown = variants.slice(0, max);
  const rest = variants.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((v) => {
        const state = variantStockState(v);
        return (
          <span
            key={v.id}
            title={v.name}
            className={cn(
              "inline-flex h-6 max-w-[220px] items-center gap-1.5 rounded-md border px-2 text-[12px]",
              state === "out" ? "border-line bg-raised/60 text-faint line-through" : "border-line bg-raised/40 text-muted",
            )}
          >
            <span className="min-w-0 truncate">{v.name}</span>
            <span className={cn("font-mono font-semibold tabular", state === "out" ? "text-faint" : "text-iris-hi")}>
              {v.price > 0 ? formatPrice(v.price) : t("quote")}
            </span>
          </span>
        );
      })}
      {rest > 0 && (
        <span className="inline-flex h-6 items-center rounded-md border border-iris/20 bg-iris-soft px-2 text-[12px] font-medium text-iris-hi">
          {t("morePackages", { count: rest, ...term })}
        </span>
      )}
    </div>
  );
}

function RatingInline({ product, t }: { product: Product; t: ReturnType<typeof useTranslations> }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-faint">
      {product.rating_avg != null && product.rating_avg > 0 ? (
        <span className="inline-flex items-center gap-0.5 text-fg"><Star size={11} className="text-warn fill-warn" /> {product.rating_avg.toFixed(1)}<span className="text-faint">({product.rating_count})</span></span>
      ) : (
        <span>{t("noRatingYet")}</span>
      )}
      {product.sold_count > 0 && <span>· {t("sold", { count: product.sold_count })}</span>}
    </span>
  );
}

/** Seller identity on a row. `linked` is off inside card links — an <a>
 *  cannot nest another <a>. */
function SellerCell({ product, linked = true }: { product: Product; linked?: boolean }) {
  const name = product.seller_name || product.seller_handle;
  if (!name) return <span className="text-[12px] text-faint">—</span>;
  const inner = (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-iris/20 bg-iris-soft text-[10px] font-semibold text-iris-hi">{name.slice(0, 2).toUpperCase()}</span>
      <span className="min-w-0 truncate text-[12.5px] font-medium text-fg">{name}</span>
      <Verified size={11} className="shrink-0 text-iris" />
    </span>
  );
  return linked && product.seller_path
    ? <Link href={product.seller_path} className="hover:text-iris">{inner}</Link>
    : inner;
}

export function MarketSection({ products, initialTotal, cats, flatCats, active, setActive, catName, minPrice, loading, error, summary }: {
  products: Product[];
  initialTotal: number;
  /** Category tree for the picker. */
  cats: Category[];
  flatCats: Category[];
  active: number | null;
  setActive: (id: number | null) => void;
  catName: (id: number) => string;
  minPrice: (p: Product) => number;
  loading: boolean;
  error: string | null;
  /** Product count per category (subtree already folded in by the page). */
  summary?: { variants: number; categoryCount: (id: number) => number | null } | null;
}) {
  const t = useTranslations("home");
  const tp = useTranslations("products");
  const tc = useTranslations("categories");
  const termFor = useVariantTermFor();
  const locale = useLocale();
  const { formatBrowseMoney, currency, fxRate } = useMoney();
  const formatPrice = (v: number) => formatBrowseMoney(v, { locale });

  const [q, setQ] = useState("");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [instantOnly, setInstantOnly] = useState(false);
  const [priceTier, setPriceTier] = useState<PriceTier>("all");
  const [sort, setSort] = useState<SortKey>("bestseller");
  const [view, setView] = useState<"table" | "grid">("grid");
  const [showAll, setShowAll] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState(products);
  const [catalogTotal, setCatalogTotal] = useState(initialTotal);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const initialRender = useRef(true);
  // Results area: lock its height while a request is in flight so the page
  // never jumps, then release it with a transition once the new set is in.
  const resultsRef = useRef<HTMLDivElement>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const [resultsGen, setResultsGen] = useState(0);
  // Whether the *loaded* set is a filtered one — the collapsed preview must
  // not expand the moment a filter is toggled, only when its results land.
  const [resultsFiltered, setResultsFiltered] = useState(false);

  // Price tiers in VND, mirroring the category page (1 $ / 2 $ when browsing in USD).
  const rate = fxRate && fxRate > 0 ? fxRate : 25000;
  const tier1 = currency === "USD" ? rate : 25000;
  const tier2 = currency === "USD" ? rate * 2 : 50000;
  const priceBounds = useMemo(() => {
    if (priceTier === "under1") return { max: Math.round(tier1) };
    if (priceTier === "1to2") return { min: Math.round(tier1), max: Math.round(tier2) };
    if (priceTier === "above2") return { min: Math.round(tier2) };
    return {};
  }, [priceTier, tier1, tier2]);

  const isFiltering = active != null || q.trim() !== "" || inStockOnly || instantOnly || priceTier !== "all" || sort !== "bestseller";

  const queryOpts = (page: number, signal?: AbortSignal) => ({
    categoryId: active ?? undefined,
    search: q.trim() || undefined,
    inStock: inStockOnly,
    fulfillment: instantOnly ? ("instant" as const) : undefined,
    minPrice: priceBounds.min,
    maxPrice: priceBounds.max,
    sort,
    page,
    perPage: PAGE_SIZE,
    signal,
  });

  useEffect(() => {
    if (initialRender.current && !isFiltering) {
      initialRender.current = false;
      return;
    }
    initialRender.current = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (resultsRef.current) setLockedHeight(resultsRef.current.offsetHeight);
      setCatalogLoading(true);
      setCatalogError(false);
      api.products(queryOpts(1, controller.signal)).then((result) => {
        setCatalogProducts(result.items);
        setCatalogTotal(result.total);
        setCatalogPage(1);
        setResultsFiltered(isFiltering);
        setResultsGen((g) => g + 1);
      }).catch((requestError: unknown) => {
        if (!(requestError instanceof DOMException && requestError.name === "AbortError")) setCatalogError(true);
      }).finally(() => {
        if (controller.signal.aborted) return;
        setCatalogLoading(false);
        // A tick later, let min-height ease down to the new content height.
        window.setTimeout(() => setLockedHeight(null), 20);
      });
    }, q ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // queryOpts is derived from exactly these inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, q, inStockOnly, instantOnly, priceBounds.min, priceBounds.max, sort]);

  const loadMore = async () => {
    const nextPage = catalogPage + 1;
    setCatalogLoading(true);
    setCatalogError(false);
    try {
      const result = await api.products(queryOpts(nextPage));
      setCatalogProducts((current) => [...current, ...result.items]);
      setCatalogTotal(result.total);
      setCatalogPage(nextPage);
    } catch {
      setCatalogError(true);
    } finally {
      setCatalogLoading(false);
    }
  };

  const clearFilters = () => {
    setActive(null); setQ(""); setInStockOnly(false); setInstantOnly(false); setPriceTier("all"); setSort("bestseller");
  };

  const filtered = catalogProducts;
  const visible = (showAll || resultsFiltered) ? filtered : filtered.slice(0, COLLAPSED_LIMIT);
  const canExpand = !showAll && !resultsFiltered && filtered.length > COLLAPSED_LIMIT;
  const canLoadMore = filtered.length < catalogTotal;

  // Tier labels follow the browsing currency (the category page's messages hard-code "$").
  const priceTierLabel: Record<PriceTier, string> = {
    all: tc("priceAll"),
    under1: `< ${formatPrice(tier1)}`,
    "1to2": `${formatPrice(tier1)} – ${formatPrice(tier2)}`,
    above2: `> ${formatPrice(tier2)}`,
  };

  return (
    <section id="market" className="w-full mx-auto max-w-[1200px] px-6 py-5 lg:py-6 scroll-mt-20">
      <SectionHead
        title={t("allProducts")}
        sub={summary ? t("marketSummary", { products: initialTotal, packages: summary.variants }) : t("marketSubtitle")}
      />

      {/* Filter bar */}
      <Card className="mb-4 p-3 sm:p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input
              id="home-product-search"
              name="product-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("searchProducts")}
              aria-label={t("searchProducts")}
              className="pl-9 h-10"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label={t("clearSearch")} className="absolute right-2 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded text-faint hover:bg-raised hover:text-fg">
                <X size={13} />
              </button>
            )}
          </div>
          <CategoryPicker
            cats={cats}
            active={active}
            onChange={setActive}
            countFor={(id) => summary?.categoryCount(id) ?? null}
            total={initialTotal}
          />
          <Select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label={t("sortLabel")}
            className="h-10 w-auto min-w-[10rem]"
          >
            <option value="bestseller">{tc("sortBestseller")}</option>
            <option value="newest">{tc("sortNewest")}</option>
            <option value="rating">{tc("sortRating")}</option>
            <option value="price_asc">{tc("sortPriceAsc")}</option>
            <option value="price_desc">{tc("sortPriceDesc")}</option>
          </Select>
          <div className="hidden sm:flex items-center rounded-lg border border-line bg-surface p-0.5">
            {([["table", Rows, tc("viewList")], ["grid", Grid, tc("viewGrid")]] as const).map(([v, Icon, label]) => (
              <button key={v} type="button" onClick={() => setView(v)} aria-label={label} aria-pressed={view === v}
                className={cn("grid place-items-center h-8 w-8 rounded-md transition-colors", view === v ? "bg-raised text-fg" : "text-faint hover:text-muted")}>
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <FacetChip active={instantOnly} tone="good" onClick={() => setInstantOnly((v) => !v)}><Bolt size={12} /> {tc("instantOnly")}</FacetChip>
          <FacetChip active={inStockOnly} tone="good" onClick={() => setInStockOnly((v) => !v)}>{t("inStockOnly")}</FacetChip>
          <span className="mx-1 hidden h-5 w-px bg-line sm:block" />
          {(["all", "under1", "1to2", "above2"] as PriceTier[]).map((tier) => (
            <FacetChip key={tier} active={priceTier === tier} onClick={() => setPriceTier(tier)}>{priceTierLabel[tier]}</FacetChip>
          ))}
          <span className="ml-auto flex items-center gap-3 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-1.5 tabular">
              <span className={cn("h-3 w-3 rounded-full border-[1.5px] border-line border-t-iris animate-spin transition-opacity duration-150", catalogLoading ? "opacity-100" : "opacity-0")} aria-hidden />
              {t("showingCount", { shown: visible.length, total: catalogTotal })}
            </span>
            {isFiltering && (
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 font-medium text-iris hover:text-iris-hi">
                <X size={12} /> {tc("clearAllFilters")}
              </button>
            )}
          </span>
        </div>
      </Card>

      {(loading || (catalogLoading && filtered.length === 0)) && <Spinner label={t("loadingMarket")} />}
      {(error || catalogError) && !loading && <Card className="p-5 text-bad text-sm">{error || t("noProducts")}</Card>}
      {!loading && !catalogLoading && !error && !catalogError && filtered.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-[14px] font-medium">{t("noProducts")}</p>
          <p className="mt-1 text-[12.5px] text-muted">{tc("emptyFilterHint")}</p>
          {isFiltering && <Button size="sm" variant="secondary" className="mt-4" onClick={clearFilters}>{tc("clearAllFilters")}</Button>}
        </Card>
      )}

      {/* Results keep their place while a new set loads: the area holds its
          height and dims, then the new set fades in and the height eases. */}
      <div
        ref={resultsRef}
        aria-busy={catalogLoading}
        style={{ minHeight: lockedHeight ?? undefined }}
        className={cn("transition-[opacity,min-height] duration-300 ease-out", catalogLoading && "opacity-50")}
      >
      <div key={resultsGen} className="animate-fade-in">
      {/* Table — desktop; cards below md */}
      {!loading && visible.length > 0 && view === "table" && (
        <Card className="hidden md:block overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-faint border-b border-line bg-raised/40">
                  <th className="font-medium px-4 py-2.5 w-[30%]">{t("product")}</th>
                  <th className="font-medium px-3 py-2.5">{t("packagesAndPrices")}</th>
                  <th className="font-medium px-3 py-2.5 w-[170px]">{t("stockAndDelivery")}</th>
                  <th className="font-medium px-3 py-2.5 w-[150px] hidden lg:table-cell">{t("seller")}</th>
                  <th className="font-medium px-3 py-2.5 w-[96px] text-right">{t("fromPrice")}</th>
                  <th className="px-4 py-2.5 w-[88px]"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const variants = p.variants ?? [];
                  const fulfillment = fulfillmentFromProduct(p);
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0 hover:bg-raised/50 transition-colors align-top">
                      <td className="px-4 py-3">
                        <Link href={productPath(p)} className="flex items-start gap-3 min-w-0">
                          <ProductCover coverId={parseCoverId(p)} title={p.title} className="h-10 w-10 shrink-0" />
                          <span className="min-w-0">
                            <span className="block font-medium text-[13.5px] leading-snug line-clamp-2">{p.title}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-faint">
                              <span>{catName(p.category_id)}</span>
                              <span>·</span>
                              <RatingInline product={p} t={t} />
                              <span>·</span>
                              <span className="inline-flex items-center gap-1 whitespace-nowrap"><Shield size={11} /> {t("escrowDays", { count: p.escrow_days })}</span>
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <PackageChips variants={variants} term={termFor(p.service_type)} formatPrice={formatPrice} t={t} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start gap-1 [&>*]:whitespace-nowrap">
                          <Tag tone={fulfillmentTone(fulfillment.kind)}>{tp(fulfillmentTagKey(fulfillment), fulfillmentTagValues(fulfillment))}</Tag>
                          <StockBadge product={p} t={t} />
                        </div>
                      </td>
                      <td className="px-3 py-3 hidden lg:table-cell"><SellerCell product={p} /></td>
                      <td className="px-3 py-3 text-right">
                        <div className="text-[10px] uppercase tracking-wide text-faint">{t("onlyFrom")}</div>
                        <div className="font-mono text-[14px] font-semibold tabular text-iris-hi">{minPrice(p) > 0 ? formatPrice(minPrice(p)) : t("quote")}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={productPath(p)}><Button size="sm">{t("buy")}</Button></Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Cards — grid view, and always on small screens */}
      {!loading && visible.length > 0 && (
        <div className={cn("grid gap-2.5 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", view === "table" && "md:hidden")}>
          {visible.map((p) => {
            const variants = p.variants ?? [];
            const fulfillment = fulfillmentFromProduct(p);
            return (
              <Link key={p.id} href={productPath(p)} className="group">
                <Card className="p-0 h-full flex flex-col overflow-hidden transition-shadow duration-200 group-hover:shadow-card-lg">
                  <div className="p-3.5 sm:p-4">
                    <div className="flex items-start gap-3">
                      <ProductCover coverId={parseCoverId(p)} title={p.title} className="h-14 w-14 shrink-0 rounded-xl" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[14px] leading-snug line-clamp-2">{p.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-faint">
                          <span>{catName(p.category_id)}</span><span>·</span><RatingInline product={p} t={t} />
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <Tag tone={fulfillmentTone(fulfillment.kind)}>{tp(fulfillmentTagKey(fulfillment), fulfillmentTagValues(fulfillment))}</Tag>
                      <StockBadge product={p} t={t} />
                      <Tag tone="neutral"><Shield size={11} /> {t("escrowDays", { count: p.escrow_days })}</Tag>
                    </div>
                  </div>
                  <div className="px-3.5 sm:px-4 pb-3 flex-1">
                    <div className="border-t border-line pt-2.5">
                      {variants.length === 0 ? (
                        <p className="text-[12px] text-faint py-1">{t("configuredToOrder")}</p>
                      ) : variants.slice(0, PACKAGE_PREVIEW).map((v) => {
                        const state = variantStockState(v);
                        return (
                          <div key={v.id} className="flex items-center gap-2 py-1.5 text-[12.5px]">
                            <span className="shrink-0 w-4 text-center">{v.delivery_mode === "instant" ? <Bolt size={12} className="text-good" /> : <Shield size={12} className="text-faint" />}</span>
                            <span className={cn("truncate flex-1", state === "out" ? "text-faint line-through" : "text-muted")}>{v.name}</span>
                            <span className={cn("font-mono text-[12px] font-medium tabular shrink-0", state === "out" ? "text-faint" : "text-fg")}>{v.price > 0 ? formatPrice(v.price) : t("quote")}</span>
                          </div>
                        );
                      })}
                      {variants.length > PACKAGE_PREVIEW && (
                        <div className="text-[11.5px] text-faint pt-1">{t("morePackages", { count: variants.length - PACKAGE_PREVIEW, ...termFor(p.service_type) })}</div>
                      )}
                    </div>
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2 border-t border-line bg-raised/50 px-3.5 sm:px-4 py-2.5">
                    <div className="min-w-0"><SellerCell product={p} linked={false} /></div>
                    <div className="text-right shrink-0">
                      <div className="text-[9.5px] uppercase tracking-wide text-faint">{t("onlyFrom")}</div>
                      <div className="font-mono text-[15px] font-semibold tabular text-iris-hi leading-tight">{minPrice(p) > 0 ? formatPrice(minPrice(p)) : t("quote")}</div>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      </div>
      </div>

      {(canExpand || canLoadMore) && (
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={() => { if (canExpand) setShowAll(true); else void loadMore(); }}
            disabled={catalogLoading}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-iris hover:text-iris-hi transition-colors disabled:opacity-60"
          >
            {catalogLoading ? t("loadingMarket") : canExpand ? t("viewAllProducts", { count: catalogTotal }) : t("loadMore", { count: catalogTotal - filtered.length })}
            <ChevronIcon open={false} />
          </button>
        </div>
      )}
    </section>
  );
}
