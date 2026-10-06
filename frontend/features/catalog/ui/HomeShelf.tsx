"use client";

/** The home page's offer shelf: best sellers across the market or one
 *  top-level branch (tabs with their counts), in the catalog's offer card.
 *  It keeps loading while the buyer scrolls, two pages at most, then hands
 *  over to the catalog ("See all N") where the full filters live. */

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { categoryPath } from "@/lib/routes";
import type { Category, PaginatedProducts } from "@/lib/types";
import { HOME_SHELF_PER_PAGE, homeShelfOpts } from "../data/browse-query";
import { useInfiniteOffers } from "../data/useInfiniteOffers";
import { OfferFeed } from "./OfferFeed";
import { OfferGridSkeleton } from "./OfferGridSkeleton";

const AUTO_PAGES = 2;

export function HomeShelf({ cats, countFor, total, seed }: {
  /** Top-level categories (tabs). */
  cats: Category[];
  countFor: (id: number) => number | null;
  /** Active offers in the whole market. */
  total: number;
  /** Server-rendered first page of the "All" tab. */
  seed: PaginatedProducts | null;
}) {
  const t = useTranslations("home");
  const locale = useLocale();
  const [tab, setTab] = useState<number | null>(null);
  const opts = homeShelfOpts(tab ?? undefined);
  const feed = useInfiniteOffers(opts, seed ? { opts: homeShelfOpts(), data: seed } : null);
  const tabs = cats.filter((c) => (countFor(c.id) ?? 1) > 0);
  const active = tab == null ? null : tabs.find((c) => c.id === tab) ?? null;

  return (
    <section id="market" aria-labelledby="home-shelf" className="w-full mx-auto max-w-[1200px] px-4 sm:px-6 pt-6 pb-6 lg:pb-8 scroll-mt-28">
      {/* Heading and group tabs share one row on desktop. */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h2 id="home-shelf" className="font-serif text-[22px] font-semibold leading-tight tracking-tight text-fg sm:text-[24px]">{t("shelfTitle")}</h2>
        <p className="mt-1 text-[13px] text-muted">{t("shelfSub")}</p>
      </div>

      <div role="tablist" aria-label={t("shelfTabs")} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[null, ...tabs.map((c) => c.id)].map((id) => {
          const cat = id == null ? null : tabs.find((c) => c.id === id)!;
          const selected = tab === id;
          const count = id == null ? total : countFor(id);
          return (
            <button
              key={id ?? "all"}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="home-shelf-panel"
              onClick={() => setTab(id)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors sm:h-9",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris cursor-pointer",
                selected ? "border-iris/40 bg-iris-soft text-iris-hi" : "border-line bg-surface text-muted hover:border-line-2 hover:text-fg",
              )}
            >
              {cat ? cat.name : t("all")}
              {count != null && <span className={cn("font-mono text-[11.5px] tabular", selected ? "text-iris-hi" : "text-faint")}>{count.toLocaleString(locale)}</span>}
            </button>
          );
        })}
      </div>
      </div>

      <div id="home-shelf-panel" role="tabpanel" aria-busy={feed.isFetching} className={cn("transition-opacity duration-150", feed.isPlaceholderData && "opacity-60")}>
        {feed.isError && !feed.data ? (
          <p className="rounded-card border border-line bg-surface p-6 text-center text-[13px] text-bad">{t("noProducts")}</p>
        ) : !feed.data ? (
          <OfferGridSkeleton count={HOME_SHELF_PER_PAGE} />
        ) : (
          <OfferFeed feed={feed} columns="wide" autoPages={AUTO_PAGES} prefetchMargin={400} moreHref={active ? categoryPath(active) : "/categories"} />
        )}
      </div>
    </section>
  );
}
