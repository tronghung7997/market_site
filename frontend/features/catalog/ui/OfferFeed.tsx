"use client";

/** The offer grid (or list) that keeps loading as the buyer scrolls: the next
 *  page is fetched about a screen before the end, placeholder cards hold its
 *  place, and the new cards fade in a few at a time (never the ones already
 *  on screen). A button stays as the fallback (keyboard, or after an error),
 *  `autoPages` caps how far a page section grows before it hands over to
 *  `moreHref`, and a list opened on `?page=N` can load the pages before it. */

import type { ReactNode } from "react";
import { useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion, useReducedMotion } from "motion/react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useNearEnd } from "@/lib/hooks/useNearEnd";
import type { Product } from "@/lib/types";
import { Button, buttonClass } from "@/components/ui";
import { ArrowRight } from "@/components/Icons";
import type { useInfiniteOffers } from "../data/useInfiniteOffers";
import { OfferCard } from "./OfferCard";

type Feed = ReturnType<typeof useInfiniteOffers>;

export function OfferFeed({ feed, view = "grid", renderRow, hideShop = false, autoPages, moreHref, columns = "catalog", prefetchMargin = 1200 }: {
  feed: Feed;
  view?: "grid" | "list";
  /** List mode row (the catalog's ProductRow). */
  renderRow?: (product: Product) => ReactNode;
  hideShop?: boolean;
  /** Stop auto-loading after this many pages and offer `moreHref` instead. */
  autoPages?: number;
  moreHref?: string;
  /** Grid columns: the catalog pane (rail beside it) or a full-width section. */
  columns?: "catalog" | "wide";
  /** How far below the viewport (px) the next page starts loading. */
  prefetchMargin?: number;
}) {
  const t = useTranslations("categories.feed");
  const locale = useLocale();
  const reduceMotion = useReducedMotion();
  const loadedPages = feed.data?.pages.length ?? 0;
  const capped = autoPages != null && loadedPages >= autoPages;
  const canAuto = Boolean(feed.hasNextPage) && !capped && !feed.isFetchingNextPage && !feed.isFetchNextPageError;
  const sentinel = useNearEnd<HTMLDivElement>(() => { if (canAuto) void feed.fetchNextPage(); }, canAuto, feed.items.length, prefetchMargin);

  // Cards present at first paint (or when a new list arrives after a filter
  // change) appear as they are; only rows added by scrolling animate in.
  const base = useRef<{ first: number | undefined; count: number } | null>(null);
  const firstId = feed.items[0]?.id;
  if (!base.current || base.current.first !== firstId) base.current = { first: firstId, count: feed.items.length };
  const settledCount = base.current.count;

  const grid = columns === "wide" ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-3";
  const appear = (index: number, child: ReactNode, key: number) => {
    const fresh = index >= settledCount && !reduceMotion;
    return (
      <motion.div
        key={key}
        className="min-w-0"
        initial={fresh ? { opacity: 0, y: 12 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1], delay: fresh ? Math.min(index - settledCount, 8) * 0.045 : 0 }}
      >
        {child}
      </motion.div>
    );
  };

  return (
    <div>
      {feed.firstPage > 1 && feed.hasPreviousPage && (
        <div className="mb-4 flex justify-center">
          <Button variant="secondary" size="sm" loading={feed.isFetchingPreviousPage} onClick={() => void feed.fetchPreviousPage()}>
            {t("previous")}
          </Button>
        </div>
      )}

      {view === "grid" ? (
        <div className={cn("grid grid-cols-1 items-stretch gap-4 [&>*>*]:h-full", grid)}>
          {feed.items.map((p, i) => appear(i, <OfferCard product={p} hideShop={hideShop} />, p.id))}
          {feed.isFetchingNextPage && Array.from({ length: 3 }).map((_, i) => <CardPlaceholder key={`ph-${i}`} />)}
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface divide-y divide-line">
          {feed.items.map((p, i) => appear(i, renderRow?.(p), p.id))}
          {feed.isFetchingNextPage && <div className="h-16 animate-pulse bg-raised/50 motion-reduce:animate-none" aria-hidden="true" />}
        </div>
      )}

      <div ref={sentinel} aria-hidden="true" className="h-px" />

      <div className="mt-6 flex flex-col items-center gap-2 text-center" aria-live="polite">
        {feed.isFetchNextPageError ? (
          <>
            <p className="text-[13px] text-bad">{t("loadFailed")}</p>
            <Button variant="secondary" size="sm" onClick={() => void feed.fetchNextPage()}>{t("retry")}</Button>
          </>
        ) : feed.hasNextPage && capped && moreHref ? (
          <Link href={moreHref} className={cn(buttonClass({ variant: "secondary" }), "gap-1.5")}>
            {t("seeAll", { count: feed.total.toLocaleString(locale) })} <ArrowRight size={15} aria-hidden="true" />
          </Link>
        ) : feed.hasNextPage ? (
          // Fallback for keyboards and slow connections; scrolling does the same.
          <Button variant="ghost" size="sm" loading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
            {feed.isFetchingNextPage ? t("loading") : t("more", { shown: feed.items.length.toLocaleString(locale), total: feed.total.toLocaleString(locale) })}
          </Button>
        ) : feed.total > feed.perPage ? (
          <p className="text-[12.5px] text-muted">{t("end", { count: feed.total.toLocaleString(locale) })}</p>
        ) : null}
      </div>
    </div>
  );
}

function CardPlaceholder() {
  return (
    <div className="flex min-h-[220px] flex-col gap-3 rounded-card border border-line bg-surface p-5 animate-pulse motion-reduce:animate-none" aria-hidden="true">
      <div className="flex gap-3">
        <div className="h-11 w-11 shrink-0 rounded-xl bg-raised" />
        <div className="flex-1 space-y-2 pt-0.5"><div className="h-4 w-11/12 rounded bg-raised" /><div className="h-4 w-2/3 rounded bg-raised" /></div>
      </div>
      <div className="mt-auto flex items-end justify-between"><div className="h-5 w-24 rounded bg-raised" /><div className="h-6 w-20 rounded bg-raised" /></div>
    </div>
  );
}
