"use client";

/** The part of the catalog explorer that does not change between category
 *  pages: header (breadcrumb, name, size, "from" price) and the category rail.
 *  It lives in the /categories layout, so moving to another category keeps it
 *  on screen and only the product pane (the page) is swapped — the page's
 *  `loading.tsx` fills that pane alone. The active node comes from the URL. */

import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { flattenCategories } from "@/lib/categories";
import { categoryPath, matchCategoryParam } from "@/lib/routes";
import { useMoney } from "@/lib/money";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { cn } from "@/lib/cn";
import type { Category } from "@/lib/types";
import { ChevronRight, Search, ShieldCheck, X } from "@/components/Icons";
import { categoryCoverId, ProductCover } from "@/features/product-covers";
import { CategoryRail, type CategoryRailTotals } from "./CategoryRail";

export type CatalogShellData = {
  categories: Category[];
  shelfTotals: CategoryRailTotals;
  categoryTotals: Record<number, number>;
  total: number;
};

/** Id of the hub search field, so the hub page can focus it after clearing. */
export const CATEGORY_HUB_SEARCH_ID = "category-hub-search";

export function CatalogShell({ data, children }: { data: CatalogShellData; children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const flatCats = useMemo(() => flattenCategories(data.categories), [data.categories]);

  const slug = pathname.startsWith("/categories/") ? decodeURIComponent(pathname.slice("/categories/".length).split("/")[0]) : null;
  const isHub = pathname === "/categories";
  const category = slug ? matchCategoryParam(slug, flatCats) : null;
  // Unknown slug (the 404 page) or anything else under /categories: no chrome.
  if (!isHub && !category) return <>{children}</>;

  // Legacy `?sub=` links narrow a parent page to one child.
  const subCat = category ? matchCategoryParam(searchParams?.get("sub"), category.children ?? []) : null;
  const headline = subCat ?? category;

  return (
    <div className={cn("w-full mx-auto max-w-[1200px] px-4 sm:px-6", isHub ? "py-6 sm:py-8" : "py-5 sm:py-7")}>
      {headline && category ? (
        <CategoryHeader data={data} flatCats={flatCats} category={category} subCat={subCat} headline={headline} />
      ) : (
        <HubHeader data={data} />
      )}
      <div className={cn("lg:grid lg:grid-cols-[224px_minmax(0,1fr)] lg:gap-10", isHub ? "mt-6 sm:mt-8" : "mt-5 sm:mt-6")}>
        <aside className="lg:sticky lg:top-24 lg:self-start mb-5 lg:mb-0">
          <CategoryRail
            cats={data.categories}
            totals={data.shelfTotals}
            subTotals={data.categoryTotals}
            activeId={headline?.id ?? null}
            allTotal={data.total}
          />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

function HubHeader({ data }: { data: CatalogShellData }) {
  const t = useTranslations("categories");
  const topCount = data.categories.filter((c) => c.parent_id == null).length;
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-6">
      <div className="min-w-0">
        <h1 className="font-serif text-[28px] sm:text-[32px] leading-tight tracking-tight font-semibold text-fg">
          {t("title")}
        </h1>
        <p className="text-[13.5px] text-muted mt-1">
          {t("hubSummary", { cats: topCount, products: data.total })}
          <span className="text-faint mx-1.5" aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1 text-good font-medium">
            <ShieldCheck size={13} /> {t("escrowProtected")}
          </span>
        </p>
      </div>
      <HubSearch />
    </div>
  );
}

/** The hub's search field. The query lives in `?q=` (debounced); the hub page
 *  reads it from there, so field and results never hold two versions. */
function HubSearch() {
  const t = useTranslations("categories");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  // Blocks the URL→field sync from overwriting the field mid-keystroke.
  const isTypingRef = useRef(false);
  const [q, setQ] = useState(searchParams?.get("q") || "");
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
    // searchParams intentionally excluded — the guard above reads it synchronously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, pathname, router]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="relative w-full sm:w-[300px] shrink-0">
      <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
      <input
        ref={inputRef}
        id={CATEGORY_HUB_SEARCH_ID}
        type="search"
        value={q}
        onChange={(e) => { isTypingRef.current = true; setQ(e.target.value); }}
        placeholder={t("searchAll")}
        aria-label={t("searchAll")}
        className="h-10 w-full rounded-lg bg-surface border border-line pl-10 pr-9 sm:pr-11 text-sm text-fg placeholder:text-placeholder text-ellipsis transition-colors focus:border-iris focus:ring-1 focus:ring-iris/30 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {q ? (
        <button
          type="button"
          onClick={() => { isTypingRef.current = true; setQ(""); inputRef.current?.focus(); }}
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
  );
}

function CategoryHeader({
  data,
  flatCats,
  category,
  subCat,
  headline,
}: {
  data: CatalogShellData;
  flatCats: Category[];
  category: Category;
  subCat: Category | null;
  headline: Category;
}) {
  const t = useTranslations("categories");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const parent = category.parent_id != null ? flatCats.find((c) => c.id === category.parent_id) ?? null : null;
  // The header describes the category, so the page's filters never change it.
  const total = data.categoryTotals[headline.id] ?? data.shelfTotals[headline.id]?.total ?? null;
  const priceFrom = data.shelfTotals[headline.id]?.price_from ?? null;

  return (
    <>
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
        <span className="text-fg font-medium min-w-0 truncate" aria-current="page">{headline.name}</span>
      </nav>

      <div className="flex items-start gap-3.5 min-w-0">
        <ProductCover coverId={categoryCoverId(headline)} image={headline.image} title={headline.name} className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl shrink-0 shadow-sm" />
        <div className="min-w-0">
          <h1 className="font-serif text-[24px] sm:text-[28px] leading-tight font-semibold text-fg">
            {headline.name}
          </h1>
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[12.5px] text-muted mt-1">
            {total != null && <span>{t("sellingCount", { count: total })}</span>}
            {priceFrom != null && (
              <>
                <span className="text-faint" aria-hidden="true">·</span>
                <span>{t("priceFromLabel", { price: formatBrowseMoney(priceFrom, { locale }) })}</span>
              </>
            )}
            <span className="text-faint" aria-hidden="true">·</span>
            <span className="text-good font-medium inline-flex items-center gap-1">
              <ShieldCheck size={13} /> {t("escrowProtected")}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
