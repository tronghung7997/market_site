"use client";

import { Link, useRouter, usePathname } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { flattenCategories, subtreeIds } from "@/lib/categories";
import { useMoney } from "@/lib/money";
import { effectiveMinPrice } from "@/lib/pricing-display";
import type { Category, Product } from "@/lib/types";
import { Button, Card, Tag } from "@/components/ui";
import { ArrowRight, ChevronRight, Search, ShieldCheck, X } from "@/components/Icons";
import { categoryCoverId, ProductCover } from "@/features/product-covers";
import ProductTile from "@/components/ProductTile";
import type { CategoryHubCatalog } from "@/features/catalog";

export function CategoryHubView({ initial }: { initial: CategoryHubCatalog }) {
  const t = useTranslations("categories");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const { formatBrowseMoney } = useMoney();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const cats = initial.categories;
  const products = initial.products;
  const error = initial.error ? t("loadError") : null;

  // Initialize query from URL search params if present
  const initialQ = searchParams?.get("q") || "";
  const [q, setQ] = useState(initialQ);
  const [selectedTopCat, setSelectedTopCat] = useState<number | null>(null);

  const flatCats = useMemo(() => flattenCategories(cats), [cats]);
  const topCats = useMemo(
    () => (cats.length > 0 ? cats : flatCats.filter((c) => c.parent_id == null)),
    [cats, flatCats],
  );

  // Sync search query to URL with debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(() => {
        const params = new URLSearchParams(searchParams?.toString() || "");
        if (q.trim()) {
          params.set("q", q.trim());
        } else {
          params.delete("q");
        }
        const qs = params.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, pathname, router, searchParams]);

  // Keyboard shortcut '/' to focus search input
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

  const productsOf = (c: Category): Product[] => {
    const ids = new Set(subtreeIds(c));
    return products.filter((p) => ids.has(p.category_id));
  };

  const queryLower = q.trim().toLowerCase();

  const matchingProductsOf = (cat: Category): Product[] => {
    const all = productsOf(cat);
    if (!queryLower) return all;
    if (cat.name.toLowerCase().includes(queryLower)) return all;
    const matchingSubIds = new Set(
      (cat.children ?? [])
        .filter((s) => s.name.toLowerCase().includes(queryLower))
        .flatMap((s) => subtreeIds(s))
    );
    return all.filter((p) => {
      if (matchingSubIds.has(p.category_id)) return true;
      return p.title.toLowerCase().includes(queryLower) || (p.highlight_text && p.highlight_text.toLowerCase().includes(queryLower));
    });
  };

  const totalMatchCount = useMemo(() => {
    if (!queryLower) return products.length;
    return topCats.reduce((sum, cat) => sum + matchingProductsOf(cat).length, 0);
  }, [topCats, queryLower, products]);

  // Find subcategories that directly match query
  const directSubMatches = useMemo(() => {
    if (!queryLower) return [];
    return flatCats.filter((c) => c.parent_id != null && c.name.toLowerCase().includes(queryLower));
  }, [flatCats, queryLower]);

  const matchesCategory = (c: Category, shelfItems: Product[]) => {
    if (!queryLower) return true;
    if (c.name.toLowerCase().includes(queryLower)) return true;
    if ((c.children ?? []).some((s) => s.name.toLowerCase().includes(queryLower))) return true;
    return shelfItems.some((p) => p.title.toLowerCase().includes(queryLower) || (p.highlight_text && p.highlight_text.toLowerCase().includes(queryLower)));
  };

  const shelves = useMemo(() => {
    return topCats
      .map((c) => {
        const allItems = productsOf(c);
        return { c, items: allItems };
      })
      .filter(({ c, items }) => {
        if (selectedTopCat !== null && c.id !== selectedTopCat) return false;
        return items.length > 0 && matchesCategory(c, items);
      })
      .sort((a, b) => b.items.length - a.items.length);
  }, [topCats, selectedTopCat, queryLower]);

  const empty = topCats.filter((c) => productsOf(c).length === 0);

  return (
    <div className="w-full mx-auto max-w-[1240px] px-4 sm:px-6 py-6 sm:py-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-line">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-medium text-iris-hi uppercase tracking-wider mb-1.5">
            <ShieldCheck size={14} />
            <span>{t("escrowProtected")}</span>
          </div>
          <h1 className="font-serif text-[28px] sm:text-[32px] leading-tight tracking-tight font-semibold text-fg">
            {t("title")}
          </h1>
          <p className="text-[13.5px] text-muted mt-1 max-w-[540px]">
            {t("subtitle", { cats: topCats.length, products: products.length })}
          </p>
        </div>

        {/* Search Input with Shortcut and Clear Button */}
        <div className="w-full md:w-[320px]">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={searchInputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("searchAll")}
              aria-label={t("searchAll")}
              className="h-10 w-full rounded-xl bg-surface border border-line pl-10 pr-9 text-sm text-fg placeholder:text-faint transition-all focus:border-iris focus:ring-1 focus:ring-iris/30 focus:outline-none"
            />
            {q ? (
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
            ) : (
              <kbd className="hidden sm:inline-flex absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[11px] font-mono text-faint bg-raised border border-line">
                /
              </kbd>
            )}
          </div>
        </div>
      </div>

      {/* Direct Subcategory Match Alert Banner */}
      {directSubMatches.length > 0 && (
        <div className="mt-4 p-3.5 rounded-xl bg-iris/8 border border-iris/25 flex flex-wrap items-center gap-2 sm:gap-3 text-[13px]">
          <span className="font-medium text-iris-hi shrink-0">
            {t("directMatch", { name: directSubMatches[0].name })}
          </span>
          <span className="text-muted text-[12px] hidden sm:inline">·</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {directSubMatches.map((sub) => (
              <Link
                key={sub.id}
                href={`/categories/${sub.id}`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface border border-iris/30 text-iris-hi font-medium text-[12.5px] hover:bg-iris hover:text-white transition-all shadow-sm"
              >
                <span>{sub.name}</span>
                <ArrowRight size={12} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quick Jump Category Pills Bar */}
      <div className="mt-5 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          type="button"
          onClick={() => setSelectedTopCat(null)}
          className={`h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-all shrink-0 cursor-pointer ${
            selectedTopCat === null
              ? "bg-iris text-white shadow-sm"
              : "bg-surface text-muted border border-line hover:text-fg hover:border-line-2"
          }`}
        >
          {t("allCategories")} ({totalMatchCount})
        </button>
        {topCats.map((cat) => {
          const matchCount = matchingProductsOf(cat).length;
          const totalCount = productsOf(cat).length;
          const isSelected = selectedTopCat === cat.id;
          const displayCount = queryLower ? matchCount : totalCount;

          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                if (isSelected) {
                  setSelectedTopCat(null);
                } else {
                  // If category has 0 matches for search, clear search to show its products
                  if (queryLower && matchCount === 0) {
                    setQ("");
                  }
                  setSelectedTopCat(cat.id);
                }
              }}
              className={`h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1.5 ${
                isSelected
                  ? "bg-iris text-white shadow-sm"
                  : queryLower && matchCount === 0
                  ? "bg-surface text-faint border border-line/60 hover:text-fg hover:border-line"
                  : "bg-surface text-muted border border-line hover:text-fg hover:border-line-2"
              }`}
            >
              <span>{cat.name}</span>
              <span className={`text-[11px] ${isSelected ? "text-white/80" : matchCount === 0 && queryLower ? "text-faint/60" : "text-faint"}`}>
                {displayCount}
              </span>
            </button>
          );
        })}
      </div>

      {error && <Card className="p-6 text-bad text-sm mt-6">{error}</Card>}

      {/* Empty State when no shelves match search */}
      {!error && shelves.length === 0 && (
        <Card className="p-10 text-center text-sm mt-6 max-w-md mx-auto">
          <div className="w-12 h-12 rounded-full bg-raised flex items-center justify-center mx-auto mb-3 text-faint">
            <Search size={20} />
          </div>
          <div className="font-medium text-fg text-[15px]">{t("noMatch", { q })}</div>
          <p className="text-[13px] text-muted mt-1.5">
            Thử tìm kiếm với từ khóa khác hoặc xóa bộ lọc danh mục.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setQ("");
                setSelectedTopCat(null);
              }}
            >
              {t("resetFilters")}
            </Button>
          </div>
        </Card>
      )}

      {/* Shelves List */}
      <div className="space-y-6 mt-6">
        {shelves.map(({ c, items }) => {
          const children = c.children ?? [];
          const minPrices = items.map((p) => effectiveMinPrice(p)).filter((v) => v > 0);
          const fromPrice = minPrices.length ? Math.min(...minPrices) : 0;

          // When query active, show items matching query first
          const matchingItems = queryLower
            ? items.filter((p) => p.title.toLowerCase().includes(queryLower))
            : [];
          const displayItems = queryLower && matchingItems.length > 0
            ? [...matchingItems, ...items.filter((p) => !matchingItems.includes(p))].slice(0, 8)
            : items.slice(0, 8);

          const remainingCount = Math.max(0, items.length - displayItems.length);

          return (
            <Card key={c.id} className="overflow-hidden shadow-card">
              {/* Shelf Top Header */}
              <div className="p-4 sm:p-5 border-b border-line bg-raised/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3.5 min-w-0">
                  <ProductCover
                    coverId={categoryCoverId(c)}
                    title={c.name}
                    className="h-11 w-11 rounded-xl shrink-0 shadow-sm"
                  />
                  <div className="min-w-0">
                    <Link
                      href={`/categories/${c.id}`}
                      className="group inline-flex items-center gap-1.5"
                    >
                      <h2 className="font-serif text-[19px] sm:text-[21px] leading-tight font-semibold text-fg group-hover:text-iris-hi transition-colors truncate">
                        {c.name}
                      </h2>
                      <ChevronRight size={15} className="text-faint group-hover:text-iris-hi group-hover:translate-x-0.5 transition-all shrink-0" />
                    </Link>
                    <div className="flex items-center gap-2 text-[12.5px] text-muted mt-0.5">
                      <span>{t("productCount", { count: items.length })}</span>
                      {fromPrice > 0 && (
                        <>
                          <span className="text-faint">·</span>
                          <span className="font-mono text-iris-hi font-medium">
                            {t("priceFrom", { price: formatBrowseMoney(fromPrice, { locale }) })}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Subcategories Tags */}
                {children.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {children.map((sub) => {
                      const subItemsCount = productsOf(sub).length;
                      return (
                        <Link key={sub.id} href={`/categories/${sub.id}`}>
                          <Tag
                            tone="neutral"
                            className="hover:border-iris/40 hover:text-iris-hi transition-colors cursor-pointer py-1 px-2.5 rounded-lg text-[12px]"
                          >
                            <span>{sub.name}</span>
                            <span className="text-faint ml-1">({subItemsCount})</span>
                          </Tag>
                        </Link>
                      );
                    })}
                  </div>
                )}

                <Link
                  href={`/categories/${c.id}`}
                  className="hidden sm:inline-flex items-center gap-1.5 text-[13px] font-medium text-iris-hi hover:underline shrink-0"
                >
                  {t("enterCategory")} <ArrowRight size={13} />
                </Link>
              </div>

              {/* Shelf Product Preview Grid (4 Columns) */}
              <div className="p-4 sm:p-5">
                <div className="grid gap-3.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 items-stretch">
                  {displayItems.map((p) => (
                    <ProductTile key={p.id} product={p} layout="grid" />
                  ))}
                </div>

                {/* Shelf Footer Strip */}
                <div className="mt-4 pt-3.5 border-t border-line/60 flex items-center justify-between text-[12.5px]">
                  <span className="text-muted">
                    {remainingCount > 0
                      ? `Còn ${remainingCount} sản phẩm khác trong danh mục này.`
                      : `Toàn bộ ${items.length} sản phẩm đang sẵn sàng.`}
                  </span>
                  <Link
                    href={`/categories/${c.id}`}
                    className="font-medium text-iris-hi hover:underline inline-flex items-center gap-1"
                  >
                    {t("viewFullShelf", { count: items.length, name: c.name })}
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {!error && empty.length > 0 && (
        <p className="mt-8 text-[12.5px] text-faint text-center">
          {t("comingSoon", { names: empty.map((c) => c.name).join(" · ") })}
        </p>
      )}
    </div>
  );
}
