"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/utils";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { SellerReview } from "@/lib/types";
import { Button, Card, Pagination, Spinner, Tag, Textarea } from "@/components/ui";
import { EyeOff, MessageSquare, Trash } from "@/components/Icons";
import { ReviewStars } from "./ReviewStars";
import { REVIEW_PAGE_SIZE, useDeleteReviewReply, useReplyToReview, useSellerReviews } from "../useReviews";

/** Seller side of reviews for one product: read what buyers said and answer
 *  in public. One reply per review, editable; nothing else is moderated here. */
export function SellerReviewsPanel({ productId }: { productId: number }) {
  const t = useTranslations("reviews");
  const [unrepliedOnly, setUnrepliedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const query = useSellerReviews({ productId, unrepliedOnly, page });
  const data = query.data;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / REVIEW_PAGE_SIZE));

  if (query.isPending) return <Card className="flex items-center justify-center p-10"><Spinner /></Card>;
  if (!data) return <Card className="p-5 text-[13px] text-bad">{t("loadFailed")}</Card>;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <div className="text-[13.5px] font-bold text-fg">{t("sellerTitle", { count: data.total })}</div>
          <div className="text-[11.5px] text-muted">{data.unreplied > 0 ? t("unrepliedCount", { count: data.unreplied }) : t("allReplied")}</div>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted hover:text-fg">
          <input type="checkbox" checked={unrepliedOnly} onChange={(e) => { setUnrepliedOnly(e.target.checked); setPage(1); }} className="h-3.5 w-3.5 rounded border-line-2 text-iris" />
          {t("unrepliedOnly")}
        </label>
      </div>
      <p className="border-b border-line bg-raised/40 px-4 py-2 text-[11.5px] text-muted">{t("sellerHint")}</p>
      {data.items.length === 0 ? (
        <p className="px-4 py-10 text-center text-[12.5px] text-muted">{unrepliedOnly ? t("noUnreplied") : t("sellerEmpty")}</p>
      ) : (
        <div className="divide-y divide-line">
          {data.items.map((review) => <SellerReviewRow key={review.id} review={review} productId={productId} />)}
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

function SellerReviewRow({ review, productId }: { review: SellerReview; productId: number }) {
  const t = useTranslations("reviews");
  const tc = useTranslations("common");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const reply = useReplyToReview(productId);
  const remove = useDeleteReviewReply(productId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(review.seller_reply ?? "");
  const [error, setError] = useState<string | null>(null);
  const busy = reply.isPending || remove.isPending;

  const save = async () => {
    if (!draft.trim()) return;
    setError(null);
    try {
      await reply.mutateAsync({ reviewId: review.id, body: draft.trim() });
      setEditing(false);
    } catch (e) {
      setError(apiErrorMessage(e, t("replyFailed")));
    }
  };
  const del = async () => {
    setError(null);
    try {
      await remove.mutateAsync(review.id);
      setDraft("");
      setEditing(false);
    } catch (e) {
      setError(apiErrorMessage(e, t("replyFailed")));
    }
  };

  return (
    <div className={cn("space-y-2.5 px-4 py-3.5", review.is_hidden && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <ReviewStars rating={review.rating} />
        <span className="font-medium text-fg">{t("buyer", { id: review.buyer_id })}</span>
        {review.variant_name && <span className="text-faint">· {review.variant_name}</span>}
        <span className="text-faint">· {formatDate(review.created_at, locale)}</span>
        <span className="font-mono text-[11px] text-faint">#{review.order_id}</span>
        {review.is_auto && <Tag tone="neutral">{t("auto")}</Tag>}
        {review.is_hidden && <Tag tone="neutral"><EyeOff size={10} /> {t("hiddenByAdmin")}</Tag>}
        {!review.is_hidden && !review.seller_reply && <Tag tone="warn">{t("awaitingReply")}</Tag>}
      </div>
      {review.comment ? (
        <p className="whitespace-pre-line text-[13px] leading-relaxed text-fg">{review.comment}</p>
      ) : (
        <p className="text-[12.5px] italic text-faint">{t("noComment")}</p>
      )}

      {review.seller_reply && !editing ? (
        <div className="rounded-lg border border-iris/20 bg-iris-soft/30 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 text-[11.5px]">
            <span className="inline-flex items-center gap-1 font-semibold text-fg"><MessageSquare size={11} className="text-iris" /> {t("yourReply")}{review.seller_replied_at && <span className="font-normal text-faint"> · {formatDate(review.seller_replied_at, locale)}</span>}</span>
            <span className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => { setDraft(review.seller_reply ?? ""); setEditing(true); }} disabled={busy} className="h-7 px-2 text-[11.5px]">{tc("edit")}</Button>
              <Button size="sm" variant="ghost" onClick={() => void del()} disabled={busy} className="h-7 px-2 text-[11.5px] text-bad hover:text-bad" aria-label={t("deleteReply")}><Trash size={12} /></Button>
            </span>
          </div>
          <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-muted">{review.seller_reply}</p>
        </div>
      ) : editing || !review.seller_reply ? (
        editing ? (
          <div className="space-y-2">
            <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} placeholder={t("replyPlaceholder")} className="text-[12.5px]" autoFocus />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void save()} disabled={busy || !draft.trim()}>{reply.isPending ? tc("saving") : t("sendReply")}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(review.seller_reply ?? ""); }} disabled={busy}>{tc("cancel")}</Button>
              <span className="ml-auto text-[11px] text-faint">{t("publicNote")}</span>
            </div>
          </div>
        ) : (
          !review.is_hidden && (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)} className="h-8"><MessageSquare size={13} /> {t("replyAction")}</Button>
          )
        )
      ) : null}
      {error && <p role="alert" className="text-[12px] text-bad">{error}</p>}
    </div>
  );
}
