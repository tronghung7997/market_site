"use client";

/** Form đánh giá 1–5 sao mở inline trong card đơn đã hoàn tất. State (điểm,
 *  nhận xét, đang gửi) sống trọn trong đây — mount mới là form sạch, đúng
 *  hành vi cũ (mở form là reset 5 sao, nhận xét trống). */

import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Textarea } from "@/components/ui";
import { Star } from "@/components/Icons";

export default function ReviewForm({ orderId, onDone, onCancel }: {
  orderId: number;
  /** ok=true → cha đánh dấu đã đánh giá + đóng form; message để cha toast. */
  onDone: (ok: boolean, message: string) => void;
  onCancel: () => void;
}) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.submitReview(orderId, rating, comment || undefined);
      onDone(true, "Đánh giá thành công!");
    } catch (e: unknown) {
      onDone(false, e instanceof Error ? e.message : "Có lỗi xảy ra");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-3 p-3.5 rounded-lg border border-line bg-raised">
      <div className="flex gap-1 mb-2">
        {[1, 2, 3, 4, 5].map((s) => (
          <button key={s} onClick={() => setRating(s)} className="p-0.5" aria-label={`${s} sao`}>
            <Star size={18} className={s <= rating ? "text-warn fill-warn" : "text-line-2"} />
          </button>
        ))}
      </div>
      <Textarea rows={3} placeholder="Nhận xét (tuỳ chọn)…" value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="flex gap-2 mt-2">
        <Button size="sm" onClick={submit} disabled={submitting}>
          {submitting ? "Đang gửi…" : "Gửi đánh giá"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Huỷ</Button>
      </div>
    </div>
  );
}
