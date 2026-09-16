"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { ProductDetail, PublicReviewList } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Card, Pagination, Spinner, Tag } from "@/components/ui";
import { Star, Verified } from "@/components/Icons";
import { SectionHead } from "./sections";
import { SellerReplyBlock } from "@/features/reviews";

export default function ReviewsCard({ product }: { product: ProductDetail }) {
  const t = useTranslations("products");
  return (
    <Card id="reviews" className="overflow-hidden scroll-mt-24">
      <SectionHead
        title={t("reviews")}
        aside={product.rating_count > 0
          ? <span className="text-[12px] text-faint">{t("reviewsCountShort", { count: product.rating_count })}</span>
          : undefined}
      />
      <div className="p-5">
        <ReviewsBody productId={product.id} sellerName={product.seller_name} />
      </div>
    </Card>
  );
}

const REVIEWS_PER_PAGE = 5;

function ReviewsBody({ productId, sellerName }: { productId: number; sellerName: string | null }) {
  const t = useTranslations("products");
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [rating, setRating] = useState<number | null>(null);
  const [data, setData] = useState<PublicReviewList | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.productReviews(productId, { page, perPage: REVIEWS_PER_PAGE, rating })
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [productId, page, rating]);

  const pickRating = (star: number | null) => { setRating(star); setPage(1); };

  if (!data && loading) return <div className="py-4"><Spinner /></div>;

  const allVisible = data ? Object.values(data.summary.counts).reduce((a, b) => a + b, 0) : 0;
  if (!data || allVisible === 0) {
    return (
      <div className="py-10 text-center">
        <span className="inline-grid place-items-center h-11 w-11 rounded-full bg-raised border border-line text-faint mb-3">
          <Star size={18} />
        </span>
        <p className="text-[13px] text-muted">{t("reviewsEmpty")}</p>
      </div>
    );
  }

  const avg = data.summary.average ?? 0;
  const dist = ([5, 4, 3, 2, 1] as const).map((star) => ({ star, count: data.summary.counts[String(star) as "5"] ?? 0 }));
  const totalPages = Math.max(1, Math.ceil(data.total / REVIEWS_PER_PAGE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-10 py-1">
        <div className="text-center shrink-0">
          <div className="font-serif text-[42px] leading-none font-semibold">{avg.toFixed(1)}</div>
          <div className="flex justify-center gap-0.5 mt-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star key={s} size={14} className={s <= Math.round(avg) ? "text-warn fill-warn" : "text-line-2"} />
            ))}
          </div>
          <div className="text-[12px] text-faint mt-1.5 whitespace-nowrap">{t("reviewsCount", { count: allVisible })}</div>
        </div>
        <div className="flex-1 space-y-0.5 max-w-xs" role="group" aria-label={t("reviewsFilterAria")}>
          {dist.map(({ star, count }) => {
            const pct = Math.round((count / allVisible) * 100);
            const active = rating === star;
            return (
              <button
                key={star}
                type="button"
                onClick={() => pickRating(active ? null : star)}
                disabled={count === 0 && !active}
                aria-pressed={active}
                title={t("reviewsFilterStar", { star })}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-[11.5px] transition-colors",
                  active ? "bg-warn-soft text-fg" : "hover:bg-raised",
                  count === 0 && !active && "cursor-default opacity-60",
                )}
              >
                <span className={cn("w-3 tabular-nums", active ? "font-semibold text-fg" : "text-faint")}>{star}</span>
                <Star size={10} className="text-warn fill-warn shrink-0" />
                <span className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden">
                  <span className="block h-full rounded-full bg-warn transition-all" style={{ width: `${pct}%` }} />
                </span>
                <span className={cn("w-6 text-right tabular-nums", active ? "text-fg" : "text-faint")}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {rating != null && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span>{t("reviewsFilteredBy", { star: rating, count: data.total })}</span>
          <button type="button" onClick={() => pickRating(null)} className="text-iris hover:underline">{t("reviewsFilterClear")}</button>
        </div>
      )}

      <div className={cn("space-y-0 divide-y divide-line transition-opacity", loading && "opacity-60")} aria-busy={loading}>
        {data.items.length === 0 && <p className="py-6 text-center text-[12.5px] text-muted">{t("reviewsNoneForStar", { star: rating ?? 0 })}</p>}
        {data.items.map((r) => (
          <div key={r.id} className="py-4 first:pt-0">
            <div className="flex items-start gap-3">
              <span className="grid place-items-center h-9 w-9 shrink-0 rounded-full bg-iris-soft text-iris text-[12px] font-semibold border border-iris/15">
                {r.reviewer_label.replace(/\*/g, "").charAt(0).toUpperCase() || "U"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium">{r.reviewer_label}</span>
                    <Tag tone="good"><Verified size={10} /> {t("purchased")}</Tag>
                    {r.variant_name && <span className="text-[11.5px] text-faint truncate max-w-[200px]">· {r.variant_name}</span>}
                    {r.is_auto && <span className="text-[11px] text-faint">· {t("reviewAuto")}</span>}
                  </div>
                  <span className="text-[11px] text-faint">{formatDate(r.created_at, locale)}</span>
                </div>
                <div className="flex gap-0.5 mt-1.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} size={11} className={s <= r.rating ? "text-warn fill-warn" : "text-line-2"} />
                  ))}
                </div>
                {r.comment && <p className="text-[13px] text-muted leading-relaxed mt-2">{r.comment}</p>}
                {r.seller_reply && <SellerReplyBlock body={r.seller_reply} repliedAt={r.seller_replied_at} sellerName={sellerName} />}
              </div>
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-line pt-4 text-[12px] text-muted">
          <span>{t("reviewsPage", { from: (page - 1) * REVIEWS_PER_PAGE + 1, to: Math.min(page * REVIEWS_PER_PAGE, data.total), total: data.total })}</span>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
