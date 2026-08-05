"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Textarea } from "@/components/ui";
import { Star } from "@/components/Icons";

export default function ReviewForm({ orderId, onDone, onCancel }: {
  orderId: number;
  onDone: (ok: boolean, message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.submitReview(orderId, rating, comment || undefined);
      onDone(true, t("reviewSuccess"));
    } catch (e: unknown) {
      onDone(false, e instanceof Error ? e.message : te("UNKNOWN"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 p-3.5 rounded-lg border border-line bg-raised">
      <div className="flex gap-1 mb-2">
        {[1, 2, 3, 4, 5].map((s) => (
          <button key={s} onClick={() => setRating(s)} className="p-0.5" aria-label={t("starAria", { n: s })}>
            <Star size={18} className={s <= rating ? "text-warn fill-warn" : "text-line-2"} />
          </button>
        ))}
      </div>
      <Textarea rows={3} placeholder={t("reviewCommentPh")} value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="flex gap-2 mt-2">
        <Button size="sm" onClick={submit} disabled={submitting}>
          {submitting ? t("submitting") : t("submitReview")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{tc("cancel")}</Button>
      </div>
    </div>
  );
}
