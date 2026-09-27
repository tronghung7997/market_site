"use client";

/** Public reviews across every product of one shop, with a star filter and
 *  pages. Same visibility as a product page's reviews. */

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ActivityBar, Button, Card, Pagination, Skeleton, Tag } from "@/components/ui";
import { Star } from "@/components/Icons";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/utils";
import { useShopReviews, SHOP_REVIEW_PAGE_SIZE } from "../useReviews";
import { ReviewStars } from "./ReviewStars";
import { SellerReplyBlock } from "./SellerReplyBlock";

const STAR_FILTERS = [5, 4, 3, 2, 1] as const;

export function ShopReviews({ sellerKey, sellerName }: { sellerKey: string; sellerName: string }) {
  const t = useTranslations("reviews");
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [rating, setRating] = useState<number | null>(null);
  const query = useShopReviews(sellerKey, page, rating);
  const data = query.data;
  const counts = data?.summary.counts;
  const allCount = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : 0;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / (data.per_page || SHOP_REVIEW_PAGE_SIZE))) : 1;

  const pick = (next: number | null) => {
    setRating(next);
    setPage(1);
  };

  return (
    <section aria-labelledby="shop-reviews-title" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 id="shop-reviews-title" className="font-serif text-[18px] tracking-tight">{t("shopTitle")}</h2>
          {data?.summary.average != null && allCount > 0 && (
            <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted">
              <Star size={12} className="text-warn fill-warn" />
              {t("shopSummary", { average: data.summary.average.toFixed(1), count: allCount })}
            </p>
          )}
        </div>
        {allCount > 0 && (
          <div role="group" aria-label={t("shopFilterLabel")} className="flex flex-wrap gap-1.5">
            <FilterButton on={rating === null} onClick={() => pick(null)}>{t("shopFilterAll")} <span className="font-mono text-[11px] opacity-75">{allCount}</span></FilterButton>
            {STAR_FILTERS.map((stars) => (
              <FilterButton key={stars} on={rating === stars} onClick={() => pick(rating === stars ? null : stars)}>
                {stars}★ <span className="font-mono text-[11px] opacity-75">{counts?.[String(stars) as "5"] ?? 0}</span>
              </FilterButton>
            ))}
          </div>
        )}
      </div>

      <Card className="relative overflow-hidden">
        <ActivityBar active={query.isFetching && !!data} label={t("shopTitle")} />
        {query.isError && !data ? (
          <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
            <p className="text-[13px] text-bad">{t("loadFailed")}</p>
            <Button size="sm" variant="secondary" onClick={() => query.refetch()}>{t("shopRetry")}</Button>
          </div>
        ) : !data ? (
          <ul className="divide-y divide-line" aria-hidden>
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="space-y-2 px-5 py-4"><Skeleton className="h-3 w-40" /><Skeleton className="h-3 w-3/4" /></li>
            ))}
          </ul>
        ) : data.items.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-muted">
            {rating ? t("shopEmptyStar", { stars: rating }) : t("shopEmpty")}
          </p>
        ) : (
          <ul className={cn("divide-y divide-line transition-opacity", query.isFetching && "opacity-70")}>
            {data.items.map((review) => (
              <li key={review.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
                  <span className="font-medium text-fg">{review.reviewer_label}</span>
                  <Tag tone="good">{t("shopPurchased")}</Tag>
                  <ReviewStars rating={review.rating} size={12} />
                  <time dateTime={review.created_at} className="ml-auto text-[12px] text-faint">{formatDate(review.created_at, locale)}</time>
                </div>
                <p className="mt-1 text-[12px] text-muted">
                  {review.product_path ? (
                    <Link href={review.product_path} className="hover:text-fg underline decoration-line-2 underline-offset-2">
                      {t("shopAbout", { product: review.product_title })}
                    </Link>
                  ) : t("shopAbout", { product: review.product_title })}
                  {review.variant_name ? ` · ${review.variant_name}` : ""}
                </p>
                {review.comment
                  ? <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-fg">{review.comment}</p>
                  : <p className="mt-2 text-[12.5px] italic text-faint">{t("noComment")}</p>}
                {review.seller_reply && (
                  <SellerReplyBlock body={review.seller_reply} repliedAt={review.seller_replied_at} sellerName={sellerName} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {data && totalPages > 1 && (
        <div className="mt-3 flex justify-end">
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </section>
  );
}

function FilterButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors",
        on ? "border-iris bg-iris-soft text-iris-hi" : "border-line bg-surface text-muted hover:text-fg hover:border-line-2",
      )}
    >
      {children}
    </button>
  );
}
