"use client";

/** Card Đánh giá — tự fetch review theo productId, tự lo loading/empty/list.
 *  Card mang id="reviews" + scroll-mt để link "N đánh giá" ở khối định danh
 *  cuộn thẳng xuống đây. */

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { ProductDetail, Review } from "@/lib/types";
import { Card, Spinner, Tag } from "@/components/ui";
import { Star, Verified } from "@/components/Icons";
import { SectionHead } from "./sections";

export default function ReviewsCard({ product }: { product: ProductDetail }) {
  return (
    <Card id="reviews" className="overflow-hidden scroll-mt-24">
      <SectionHead
        title="Đánh giá"
        aside={product.rating_count > 0
          ? <span className="text-[12px] text-faint">{product.rating_count} lượt</span>
          : undefined}
      />
      <div className="p-5">
        <ReviewsBody productId={product.id} />
      </div>
    </Card>
  );
}

function ReviewsBody({ productId }: { productId: number }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.productReviews(productId).then(setReviews).catch(() => {}).finally(() => setLoading(false));
  }, [productId]);

  if (loading) return <div className="py-4"><Spinner /></div>;

  if (reviews.length === 0) {
    return (
      <div className="py-10 text-center">
        <span className="inline-grid place-items-center h-11 w-11 rounded-full bg-raised border border-line text-faint mb-3">
          <Star size={18} />
        </span>
        <p className="text-[13px] text-muted">Chưa có đánh giá nào — hãy là người mua đầu tiên chia sẻ trải nghiệm.</p>
      </div>
    );
  }

  const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  const dist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
  }));

  return (
    <div className="space-y-6">
      {/* Rating summary */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-10 py-1">
        <div className="text-center shrink-0">
          <div className="font-serif text-[42px] leading-none font-semibold">{avg.toFixed(1)}</div>
          <div className="flex justify-center gap-0.5 mt-2">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star key={s} size={14} className={s <= Math.round(avg) ? "text-warn fill-warn" : "text-line-2"} />
            ))}
          </div>
          <div className="text-[12px] text-faint mt-1.5 whitespace-nowrap">{reviews.length} đánh giá</div>
        </div>
        <div className="flex-1 space-y-1.5 max-w-xs">
          {dist.map(({ star, count }) => {
            const pct = Math.round((count / reviews.length) * 100);
            return (
              <div key={star} className="flex items-center gap-2 text-[11.5px]">
                <span className="w-3 text-faint tabular-nums">{star}</span>
                <div className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden">
                  <div className="h-full rounded-full bg-warn transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-5 text-right text-faint tabular-nums">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Individual reviews */}
      <div className="space-y-0 divide-y divide-line">
        {reviews.map((r) => (
          <div key={r.id} className="py-4 first:pt-0">
            <div className="flex items-start gap-3">
              <span className="grid place-items-center h-9 w-9 shrink-0 rounded-full bg-iris-soft text-iris text-[12px] font-semibold border border-iris/15">
                U{r.buyer_id}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">Người mua #{r.buyer_id}</span>
                    <Tag tone="good"><Verified size={10} /> Đã mua hàng</Tag>
                  </div>
                  <span className="text-[11px] text-faint">{formatDate(r.created_at)}</span>
                </div>
                <div className="flex gap-0.5 mt-1.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star key={s} size={11} className={s <= r.rating ? "text-warn fill-warn" : "text-line-2"} />
                  ))}
                </div>
                {r.comment && <p className="text-[13px] text-muted leading-relaxed mt-2">{r.comment}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
