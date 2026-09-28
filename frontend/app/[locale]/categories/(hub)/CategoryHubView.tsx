"use client";

/** Catalog explorer, "all" view — the product pane beside the rail (header
 *  and rail live in the /categories layout): every branch's best sellers as
 *  one table of offers. Categories are the navigation; products are the
 *  content — nothing is listed twice. A search (`?q=`, typed in the layout's
 *  field) asks the backend (accent-insensitive, every product, not just the 8
 *  per shelf the page was rendered with) and groups hits by branch. */

import { Link, useRouter, usePathname } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { flattenCategories } from "@/lib/categories";
import { matchesAllWords } from "@/lib/text-fold";
import { useMoney } from "@/lib/money";
import type { Category } from "@/lib/types";
import { categoryPath } from "@/lib/routes";
import { cn } from "@/lib/cn";
import { Button, Card } from "@/components/ui";
import { ArrowRight, ChevronRight, Search } from "@/components/Icons";
import { categoryCoverId, ProductCover } from "@/features/product-covers";
import { ProductRow } from "@/components/products/ProductRow";
import { CATEGORY_HUB_SEARCH_ID } from "@/features/catalog/client";
import type { CategoryHubCatalog } from "@/features/catalog";

/** Search hits fetched for the hub; more than this links to /search. */
const HUB_SEARCH_LIMIT = 60;

export function CategoryHubView({ initial }: { initial: CategoryHubCatalog }) {
  const t = useTranslations("categories");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { formatBrowseMoney } = useMoney();

  const cats = initial.categories;
  const shelvesById = initial.shelves;
  const error = initial.error ? t("loadError") : null;

  const flatCats = useMemo(() => flattenCategories(cats), [cats]);
  const nameById = useMemo(() => new Map(flatCats.map((c) => [c.id, c.name])), [flatCats]);
  const topCats = useMemo(
    () => (cats.length > 0 ? cats : flatCats.filter((c) => c.parent_id == null)),
    [cats, flatCats],
  );
  // Already debounced and trimmed by the layout's search field.
  const searchTerm = (searchParams?.get("q") || "").trim();
  const searching = searchTerm.length > 0;
  const search = useQuery({
    queryKey: queryKeys.categoryProducts({ scope: "all", search: searchTerm, perPage: HUB_SEARCH_LIMIT }),
    queryFn: ({ signal }) => api.products({ search: searchTerm, sort: "relevance", perPage: HUB_SEARCH_LIMIT, signal }),
    enabled: searching,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const hits = searching ? search.data?.items ?? [] : [];
  const matchCount = searching ? search.data?.total ?? 0 : 0;
  const searchPending = searching && !search.data;
  // The previous term's hits stay on screen (dimmed) while the new ones load;
  // the summary must not pair them with the new term.
  const searchStale = searching && search.isPlaceholderData;

  const topIdOf = useMemo(() => {
    const byId = new Map(flatCats.map((c) => [c.id, c]));
    return (id: number): number | null => {
      let node = byId.get(id);
      while (node && node.parent_id != null) node = byId.get(node.parent_id);
      return node?.id ?? null;
    };
  }, [flatCats]);

  const groups = useMemo(() => {
    return topCats
      .map((c) => {
        const shelf = shelvesById[c.id];
        const items = shelf?.items ?? [];
        const total = shelf?.total ?? items.length;
        const children = c.children ?? [];
        const matching = searching ? hits.filter((p) => topIdOf(p.category_id) === c.id) : items;
        return { c, children, items, total, matching, fromPrice: shelf?.price_from ?? null };
      })
      // Keep the admin's order (Admin › Danh mục, sort_order) — the API already
      // returns the tree that way; the rail on the left uses the same order.
      .filter((g) => g.matching.length > 0);
  }, [topCats, shelvesById, searching, hits, topIdOf]);

  // Category names match accent-insensitively too ("dich vu" → "Dịch vụ …"),
  // shown with their size so an empty branch reads as empty, not as missing.
  const matchedCats = useMemo(
    () => (searching ? flatCats.filter((c) => matchesAllWords(c.name, searchTerm)) : []),
    [flatCats, searching, searchTerm],
  );
  const searchEverywhereHref = `/search?q=${encodeURIComponent(searchTerm)}`;

  const clearSearch = () => {
    router.replace(pathname, { scroll: false });
    document.getElementById(CATEGORY_HUB_SEARCH_ID)?.focus();
  };

  if (error) return <Card className="p-6 text-bad text-sm">{error}</Card>;

  return (
    <div>
            {searching && (
              <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
                <span className="text-muted" aria-live="polite">
                  {searchPending || searchStale ? t("searching") : t("searchSummary", { count: matchCount, q: searchTerm })}
                </span>
                {matchedCats.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-faint">{t("matchedCategories")}</span>
                    {matchedCats.map((cat) => (
                      <Link
                        key={cat.id}
                        href={categoryPath(cat)}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-iris-soft border border-iris/25 text-iris-hi font-medium text-[12.5px] hover:bg-iris hover:border-iris hover:text-white transition-colors"
                      >
                        {cat.name}
                        <span className="font-mono tabular text-[11px] opacity-80">{initial.categoryTotals[cat.id] ?? 0}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {searchPending || (searchStale && groups.length === 0) ? (
              <div className="rounded-card border border-line bg-surface divide-y divide-line animate-pulse" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3">
                    <div className="h-11 w-11 rounded-lg bg-raised" />
                    <div className="flex-1 space-y-1.5"><div className="h-4 w-1/2 rounded bg-raised" /><div className="h-3 w-1/3 rounded bg-raised" /></div>
                    <div className="h-4 w-16 rounded bg-raised" />
                  </div>
                ))}
              </div>
            ) : groups.length === 0 ? (
              <Card className="p-10 text-center text-sm max-w-md mx-auto">
                <div className="w-12 h-12 rounded-full bg-raised flex items-center justify-center mx-auto mb-3 text-faint">
                  <Search size={20} />
                </div>
                <div className="font-medium text-fg text-[15px]">
                  {searching ? t("noProductMatch", { q: searchTerm }) : t("noProductsYet")}
                </div>
                <p className="text-[13px] text-muted mt-1.5">
                  {!searching ? t("noProductsYetHint") : matchedCats.length > 0 ? t("matchedCategoriesEmptyHint") : t("searchSuggestion")}
                </p>
                {searching && (
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                    <Button type="button" variant="secondary" size="sm" onClick={clearSearch}>
                      {t("clearSearch")}
                    </Button>
                    <Link href={searchEverywhereHref}>
                      <Button type="button" variant="ghost" size="sm">{t("searchEverywhere")}</Button>
                    </Link>
                  </div>
                )}
              </Card>
            ) : (
              <div className={cn("space-y-8 sm:space-y-10 transition-opacity", searchStale && "opacity-60")} aria-busy={searchStale || undefined}>
                {groups.map(({ c, children, total, matching, fromPrice }) => {
                  const shownCount = searching ? matching.length : total;
                  const remaining = searching ? 0 : total - matching.length;
                  return (
                    <section key={c.id} aria-labelledby={`group-${c.id}`}>
                      <div className="flex items-end justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <ProductCover coverId={categoryCoverId(c)} image={c.image} title={c.name} className="h-9 w-9 rounded-lg" />
                          <div className="min-w-0">
                            <Link href={categoryPath(c)} className="group inline-flex items-center gap-1 max-w-full">
                              <h2 id={`group-${c.id}`} className="font-serif text-[20px] leading-tight font-semibold text-fg group-hover:text-iris-hi transition-colors min-w-0 truncate">
                                {c.name}
                              </h2>
                              <ChevronRight size={15} className="text-faint group-hover:text-iris-hi group-hover:translate-x-0.5 transition-all shrink-0" />
                            </Link>
                            <div className="text-[12.5px] text-muted flex items-center gap-1.5 flex-wrap">
                              <span className="whitespace-nowrap">
                                {searching ? t("matchCount", { count: shownCount }) : t("productCount", { count: total })}
                              </span>
                              {fromPrice != null && fromPrice > 0 && (
                                <span className="whitespace-nowrap">
                                  <span className="text-faint mr-1.5" aria-hidden="true">·</span>
                                  <span className="font-mono tabular text-fg/80">
                                    {t("priceFrom", { price: formatBrowseMoney(fromPrice, { locale }) })}
                                  </span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {children.length > 0 && (
                          <div className="hidden sm:flex items-center gap-1 text-[12.5px] shrink-0">
                            {children.map((sub, i) => (
                              <span key={sub.id} className="inline-flex items-center">
                                {i > 0 && <span className="text-faint mx-1" aria-hidden="true">·</span>}
                                <Link href={categoryPath(sub)} className="text-muted hover:text-iris-hi transition-colors">
                                  {sub.name}
                                </Link>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="rounded-card border border-line bg-surface divide-y divide-line overflow-hidden">
                        {matching.map((p) => (
                          <ProductRow
                            key={p.id}
                            product={p}
                            context={p.category_id !== c.id ? nameById.get(p.category_id) ?? null : null}
                          />
                        ))}
                        {remaining > 0 && (
                          <Link
                            href={categoryPath(c)}
                            className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 text-[13px] font-medium text-iris-hi bg-raised/40 hover:bg-iris-soft transition-colors"
                          >
                            <span>{t("moreInCategory", { count: remaining, name: c.name })}</span>
                            <ArrowRight size={14} />
                          </Link>
                        )}
                      </div>
                    </section>
                  );
                })}
                {searching && matchCount > hits.length && (
                  <Link
                    href={searchEverywhereHref}
                    className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 text-[13px] font-medium text-iris-hi hover:bg-iris-soft transition-colors"
                  >
                    <span>{t("searchEverywhereCount", { q: searchTerm, count: matchCount })}</span>
                    <ArrowRight size={14} />
                  </Link>
                )}
              </div>
            )}
    </div>
  );
}
