"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/utils";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { AdminReview } from "@/lib/types";
import { Button, Card, Input, Pagination, Spinner, Tag } from "@/components/ui";
import { ConfirmDialog } from "@/features/seller-inventory/ui/ConfirmDialog";
import { Eye, EyeOff, MessageSquare } from "@/components/Icons";
import { ReviewStars } from "./ReviewStars";
import { REVIEW_PAGE_SIZE, useAdminReviews, useSetReviewVisibility } from "../useReviews";

/** Admin moderation for one product's reviews: hide a review from the
 *  storefront (and the rating) or bring it back. Nothing is deleted. */
export function AdminReviewsPanel({ productId }: { productId: number }) {
  const t = useTranslations("reviews");
  const [filter, setFilter] = useState<"all" | "visible" | "hidden">("all");
  const [page, setPage] = useState(1);
  const query = useAdminReviews({ productId, hidden: filter === "all" ? undefined : filter === "hidden", page });
  const data = query.data;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / REVIEW_PAGE_SIZE));

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <div className="text-[13.5px] font-bold text-fg">{t("adminTitle", { count: data?.total ?? 0 })}</div>
          <div className="text-[11.5px] text-muted">{t("adminHint")}</div>
        </div>
        <div className="flex gap-1 rounded-lg bg-raised p-0.5 text-[12px]">
          {(["all", "visible", "hidden"] as const).map((key) => (
            <button key={key} type="button" onClick={() => { setFilter(key); setPage(1); }} className={cn("rounded-md px-2.5 py-1 font-medium transition-colors", filter === key ? "bg-surface text-fg shadow-xs" : "text-muted hover:text-fg")}>
              {t(`filter.${key}`)}
            </button>
          ))}
        </div>
      </div>
      {query.isPending ? (
        <div className="flex justify-center p-10"><Spinner /></div>
      ) : !data ? (
        <p className="p-5 text-[13px] text-bad">{t("loadFailed")}</p>
      ) : data.items.length === 0 ? (
        <p className="px-4 py-10 text-center text-[12.5px] text-muted">{t("adminEmpty")}</p>
      ) : (
        <div className="divide-y divide-line">
          {data.items.map((review) => <AdminReviewRow key={review.id} review={review} productId={productId} />)}
        </div>
      )}
      {totalPages > 1 && (
        <div className="flex justify-end border-t border-line px-4 py-2.5">
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </Card>
  );
}

function AdminReviewRow({ review, productId }: { review: AdminReview; productId: number }) {
  const t = useTranslations("reviews");
  const tc = useTranslations("common");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const setVisibility = useSetReviewVisibility(productId);
  const [confirmHide, setConfirmHide] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const apply = async (hidden: boolean) => {
    setError(null);
    try {
      await setVisibility.mutateAsync({ reviewId: review.id, hidden, reason: hidden ? reason.trim() || undefined : undefined });
      setConfirmHide(false);
      setReason("");
    } catch (e) {
      setError(apiErrorMessage(e, t("moderateFailed")));
    }
  };

  return (
    <div className={cn("space-y-2 px-4 py-3.5", review.is_hidden && "bg-raised/40")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <ReviewStars rating={review.rating} />
        <span className="font-medium text-fg">{review.buyer_email ?? t("buyer", { id: review.buyer_id })}</span>
        {review.variant_name && <span className="text-faint">· {review.variant_name}</span>}
        <span className="text-faint">· {formatDate(review.created_at, locale)}</span>
        <span className="font-mono text-[11px] text-faint">#{review.order_id}</span>
        {review.is_auto && <Tag tone="neutral">{t("auto")}</Tag>}
        {review.is_hidden ? <Tag tone="warn"><EyeOff size={10} /> {t("hidden")}</Tag> : <Tag tone="good"><Eye size={10} /> {t("visible")}</Tag>}
        <span className="ml-auto flex items-center gap-1.5">
          {review.is_hidden ? (
            <Button size="sm" variant="secondary" onClick={() => void apply(false)} disabled={setVisibility.isPending} className="h-7 px-2.5 text-[11.5px]"><Eye size={12} /> {t("unhide")}</Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setConfirmHide(true)} disabled={setVisibility.isPending} className="h-7 px-2.5 text-[11.5px]"><EyeOff size={12} /> {t("hide")}</Button>
          )}
        </span>
      </div>
      {review.comment ? <p className="whitespace-pre-line text-[13px] leading-relaxed text-fg">{review.comment}</p> : <p className="text-[12.5px] italic text-faint">{t("noComment")}</p>}
      {review.seller_reply && (
        <p className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-muted"><MessageSquare size={11} className="mr-1 inline text-iris" />{t("sellerReplied")}: {review.seller_reply}</p>
      )}
      {review.is_hidden && (
        <p className="text-[11.5px] text-warn">
          {t("hiddenMeta", { date: review.hidden_at ? formatDate(review.hidden_at, locale) : "—" })}{review.hidden_reason ? ` — ${review.hidden_reason}` : ""}
        </p>
      )}
      {error && <p role="alert" className="text-[12px] text-bad">{error}</p>}

      <ConfirmDialog
        open={confirmHide}
        title={t("hideConfirmTitle")}
        description={t("hideConfirmBody")}
        confirmLabel={t("hide")}
        cancelLabel={tc("cancel")}
        tone="danger"
        pending={setVisibility.isPending}
        onConfirm={() => void apply(true)}
        onCancel={() => { setConfirmHide(false); setReason(""); }}
      >
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("hideReasonPlaceholder")} maxLength={500} className="text-[12.5px]" />
      </ConfirmDialog>
    </div>
  );
}
