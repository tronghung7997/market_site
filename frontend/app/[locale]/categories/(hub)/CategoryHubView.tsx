"use client";

/** Catalog explorer, "all" view: the category tree on the left, every
 *  branch's best sellers as one table of offers on the right. Categories are
 *  the navigation; products are the content — nothing is listed twice. */

import { Link, useRouter, usePathname } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { flattenCategories, subtreeIds } from "@/lib/categories";
import { useMoney } from "@/lib/money";
import type { Category, Product } from "@/lib/types";
import { categoryPath } from "@/lib/routes";
import { Button, Card } from "@/components/ui";
import { ArrowRight, ChevronRight, Search, ShieldCheck, X } from "@/components/Icons";
import { categoryCoverId, ProductCover } from "@/features/product-covers";
import { ProductRow } from "@/components/products/ProductRow";
import { CategoryRail } from "@/features/catalog/client";
import type { CategoryHubCatalog } from "@/features/catalog";
import { useDebounce } from "@/lib/hooks/useDebounce";

export function CategoryHubView({ initial }: { initial: CategoryHubCatalog }) {
  const t = useTranslations("categories");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const { formatBrowseMoney } = useMoney();
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Tracks whether the user is actively typing — blocks URL→q sync from
  // overwriting the input mid-keystroke (which caused characters to be cut).
  const isTypingRef = useRef(false);

  const cats = initial.categories;
  const shelvesById = initial.shelves;
  const error = initial.error ? t("loadError") : null;

  const initialQ = searchParams?.get("q") || "";
  const [q, setQ] = useState(initialQ);
  const debouncedQ = useDebounce(q, 250);

  useEffect(() => {
    if (isTypingRef.current) return;
    setQ(searchParams?.get("q") || "");
  }, [searchParams]);

  useEffect(() => {
    const currentQ = searchParams?.get("q") || "";
    const normalized = debouncedQ.trim();
    if (normalized === currentQ) {
      isTypingRef.current = false;
      return;
    }
    startTransition(() => {
      const params = new URLSearchParams(searchParams?.toString() || "");
      if (normalized) params.set("q", normalized);
      else params.delete("q");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
    isTypingRef.current = false;
    // searchParams intentionally excluded — guard above reads it synchronously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, pathname, router]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const flatCats = useMemo(() => flattenCategories(cats), [cats]);
  const nameById = useMemo(() => new Map(flatCats.map((c) => [c.id, c.name])), [flatCats]);
  const topCats = useMemo(
    () => (cats.length > 0 ? cats : flatCats.filter((c) => c.parent_id == null)),
    [cats, flatCats],
  );
  const totals = useMemo(
    () => Object.fromEntries(Object.values(shelvesById).map((s) => [s.category_id, { total: s.total, price_from: s.price_from }])),
    [shelvesById],
  );

  const queryLower = q.trim().toLowerCase();
  const productMatches = (p: Product) =>
    p.title.toLowerCase().includes(queryLower) ||
    Boolean(p.highlight_text && p.highlight_text.toLowerCase().includes(queryLower));

  const groups = useMemo(() => {
    return topCats
      .map((c) => {
        const shelf = shelvesById[c.id];
        const items = shelf?.items ?? [];
        const total = shelf?.total ?? items.length;
        const children = c.children ?? [];
        let matching = items;
        if (queryLower && !c.name.toLowerCase().includes(queryLower)) {
          const matchingSubIds = new Set(
            children.filter((s) => s.name.toLowerCase().includes(queryLower)).flatMap((s) => subtreeIds(s)),
          );
          matching = items.filter((p) => matchingSubIds.has(p.category_id) || productMatches(p));
        }
        return { c, children, items, total, matching, fromPrice: shelf?.price_from ?? null };
      })
      // Keep the admin's order (Admin › Danh mục, sort_order) — the API already
      // returns the tree that way; the rail on the left uses the same order.
      .filter((g) => g.matching.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topCats, shelvesById, queryLower]);

  const matchCount = groups.reduce((n, g) => n + g.matching.length, 0);
  const directSubMatches = useMemo(() => {
    if (!queryLower) return [];
    return flatCats.filter((c) => c.parent_id != null && c.name.toLowerCase().includes(queryLower));
  }, [flatCats, queryLower]);

  const clearSearch = () => {
    setQ("");
    searchInputRef.current?.focus();
  };

  return (
    <div className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 py-6 sm:py-8">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-6">
        <div className="min-w-0">
          <h1 className="font-serif text-[28px] sm:text-[32px] leading-tight tracking-tight font-semibold text-fg">
            {t("title")}
          </h1>
          <p className="text-[13.5px] text-muted mt-1">
            {t("hubSummary", { cats: topCats.length, products: initial.total })}
            <span className="text-faint mx-1.5" aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1 text-good font-medium">
              <ShieldCheck size={13} /> {t("escrowProtected")}
            </span>
          </p>
        </div>
        <div className="relative w-full sm:w-[300px] shrink-0">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            ref={searchInputRef}
            type="search"
            value={q}
            onChange={(e) => { isTypingRef.current = true; setQ(e.target.value); }}
            placeholder={t("searchAll")}
            aria-label={t("searchAll")}
            className="h-10 w-full rounded-lg bg-surface border border-line pl-10 pr-9 text-sm text-fg placeholder:text-faint transition-colors focus:border-iris focus:ring-1 focus:ring-iris/30 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {q ? (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 grid place-items-center rounded-md text-faint hover:text-fg hover:bg-raised cursor-pointer"
              aria-label={t("clearSearch")}
            >
              <X size={14} />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[11px] font-mono text-faint bg-raised border border-line">
              /
            </kbd>
          )}
        </div>
      </div>

      {error && <Card className="p-6 text-bad text-sm mt-6">{error}</Card>}

      {!error && (
        <div className="mt-6 sm:mt-8 lg:grid lg:grid-cols-[224px_minmax(0,1fr)] lg:gap-10">
          <aside className="lg:sticky lg:top-24 lg:self-start mb-5 lg:mb-0">
            <CategoryRail cats={cats} totals={totals} activeId={null} allTotal={initial.total} />
          </aside>

          <div className="min-w-0">
            {queryLower && (
              <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
                <span className="text-muted">{t("searchSummary", { count: matchCount, q })}</span>
                {directSubMatches.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-faint">{t("directMatchShort")}</span>
                    {directSubMatches.map((sub) => (
                      <Link
                        key={sub.id}
                        href={categoryPath(sub)}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-iris-soft border border-iris/25 text-iris-hi font-medium text-[12.5px] hover:bg-iris hover:border-iris hover:text-white transition-colors"
                      >
                        {sub.name}
                        <ArrowRight size={12} />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {groups.length === 0 ? (
              <Card className="p-10 text-center text-sm max-w-md mx-auto">
                <div className="w-12 h-12 rounded-full bg-raised flex items-center justify-center mx-auto mb-3 text-faint">
                  <Search size={20} />
                </div>
                <div className="font-medium text-fg text-[15px]">
                  {queryLower ? t("noMatch", { q }) : t("noProductsYet")}
                </div>
                <p className="text-[13px] text-muted mt-1.5">
                  {queryLower ? t("searchSuggestion") : t("noProductsYetHint")}
                </p>
                {queryLower && (
                  <div className="mt-4">
                    <Button type="button" variant="secondary" size="sm" onClick={clearSearch}>
                      {t("clearSearch")}
                    </Button>
                  </div>
                )}
              </Card>
            ) : (
              <div className="space-y-8 sm:space-y-10">
                {groups.map(({ c, children, total, matching, fromPrice }) => {
                  const shownCount = queryLower ? matching.length : total;
                  const remaining = queryLower ? 0 : total - matching.length;
                  return (
                    <section key={c.id} aria-labelledby={`group-${c.id}`}>
                      <div className="flex items-end justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <ProductCover coverId={categoryCoverId(c)} title={c.name} className="h-9 w-9 rounded-lg" />
                          <div className="min-w-0">
                            <Link href={categoryPath(c)} className="group inline-flex items-center gap-1 max-w-full">
                              <h2 id={`group-${c.id}`} className="font-serif text-[20px] leading-tight font-semibold text-fg group-hover:text-iris-hi transition-colors truncate">
                                {c.name}
                              </h2>
                              <ChevronRight size={15} className="text-faint group-hover:text-iris-hi group-hover:translate-x-0.5 transition-all shrink-0" />
                            </Link>
                            <div className="text-[12.5px] text-muted flex items-center gap-1.5 flex-wrap">
                              <span className="whitespace-nowrap">
                                {queryLower ? t("matchCount", { count: shownCount }) : t("productCount", { count: total })}
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
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
