"use client";

/* Card cho một đơn "cần xử lý" (pending/processing/disputed) trên trang
 * /seller/orders. Lắp lại đúng bộ primitive (timeline/dispute/dashboard) mà
 * buyer's OrderCard dùng — cùng một component, khác bộ action ở dưới vì
 * seller làm được việc khác buyer (chấp nhận/giao hàng/phản hồi khiếu nại
 * thay vì xác nhận/mở khiếu nại/đánh giá). */

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api, vnd } from "@/lib/api";
import { orderStatus } from "@/lib/order-status";
import type { Dispute, Order } from "@/lib/types";
import ServiceDashboard from "@/components/ServiceDashboard";
import { StatusTimeline, OrderResources, OrderDispute } from "@/components/orders/OrderCardPrimitives";
import { Button, Card, Disclosure, Field, Monogram, Tag, Textarea } from "@/components/ui";
import { Check } from "@/components/Icons";
import OrderChatButton from "@/components/chat/OrderChatButton";

/** Gợi ý hành động — khác `orderStatus().hint` (viết cho buyer, "Người bán
 *  đang chuẩn bị đơn của bạn" vô nghĩa khi seller đọc chính đơn của mình). */
export default function SellerOrderCard({
  order: o, dispute, onAccept, onDeliver, onDisputeResponded, acting,
}: {
  order: Order;
  /** Prefetch sẵn ở trang cha để phân nhóm "chưa phản hồi"/"đã phản hồi" —
   *  truyền thẳng vào OrderDispute, khỏi gọi lại API. */
  dispute?: Dispute | null;
  onAccept: (orderId: number) => void;
  onDeliver: (orderId: number, data: string) => void;
  onDisputeResponded: () => void;
  acting: boolean;
}) {
  const t = useTranslations("seller");
  const locale = useLocale();
  const st = orderStatus(o.status, locale);
  const elapsedLabel = (iso: string) => {
    const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
    if (hours < 1) return t("orderJustNow");
    if (hours < 24) return t("orderHoursAgo", { count: hours });
    return t("orderDaysAgo", { count: Math.floor(hours / 24) });
  };
  const sellerHint = o.status === "pending"
    ? t("orderHintPending")
    : o.status === "processing" ? t("orderHintProcessing") : null;
  const [delivering, setDelivering] = useState(false);
  const [deliverData, setDeliverData] = useState("");
  const [responding, setResponding] = useState(false);
  const [sellerNote, setSellerNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);

  const submitResponse = async () => {
    if (!dispute || !sellerNote.trim()) return;
    setSubmitting(true);
    try {
      await api.sellerRespondDispute(dispute.id, sellerNote.trim());
      setResponding(false); setSellerNote("");
      onDisputeResponded();
    } catch { /* ignore — form ở lại để seller thử lại */ }
    finally { setSubmitting(false); }
  };

  const hasContent = o.status !== "pending";

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-raised/50 border-b border-line">
        <span className="font-mono text-[13px] font-semibold">#{o.id}</span>
        <span className="text-[11.5px] text-faint">{elapsedLabel(o.created_at)}</span>
        <div className="ml-auto flex items-center gap-2.5">
          <Tag tone={st.tone}>{st.label}</Tag>
          <span className="font-mono text-[14px] font-semibold tabular">{vnd(o.total_amount, locale)}</span>
        </div>
      </div>

      <div className="px-4 pb-4 pt-3">
        <div className="flex items-center gap-3 min-w-0">
          <Monogram text={o.product_title ?? "??"} />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-[14px] truncate">{o.product_title ?? t("orderNumber", { id: o.id })}</div>
            <div className="text-[12px] text-muted truncate">
              {o.variant_name ? `${o.variant_name} · ` : ""}{t("quantity", { count: o.quantity })}
              {o.buyer_email && <> · {o.buyer_email}</>}
            </div>
          </div>
        </div>

        {sellerHint && <p className="text-[12px] text-muted mt-2.5">{sellerHint}</p>}

        {!['cancelled', 'refunded'].includes(o.status) && <div className="mt-3"><OrderChatButton orderId={o.id} perspective="seller" /></div>}

        {o.status === "disputed" && <OrderDispute orderId={o.id} initialDispute={dispute} />}

        <div className="mt-3 rounded-lg bg-raised/60 border border-line/70">
          <StatusTimeline status={o.status} />
        </div>

        <div className="flex gap-2 mt-3.5">
          {o.status === "pending" && (
            <Button size="sm" disabled={acting} onClick={() => onAccept(o.id)}>
              <Check size={13} /> {t("acceptOrder")}
            </Button>
          )}
          {o.status === "processing" && !delivering && (
            <Button size="sm" disabled={acting} onClick={() => setDelivering(true)}>
              {t("deliverOrder")}
            </Button>
          )}
          {o.status === "disputed" && !dispute?.seller_note && !responding && (
            <Button size="sm" variant="secondary" onClick={() => setResponding(true)}>
              {t("respondToDispute")}
            </Button>
          )}
        </div>

        {delivering && o.status === "processing" && (
          <div className="mt-3.5 pt-3.5 border-t border-line space-y-3">
            <Field label={t("deliveryData")} hint={t("deliveryDataHint")}>
              <Textarea rows={4} value={deliverData} onChange={(e) => setDeliverData(e.target.value)}
                placeholder={t("deliveryDataPlaceholder")} />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" disabled={acting || !deliverData.trim()} onClick={() => onDeliver(o.id, deliverData.trim())}>
                {acting ? t("delivering") : t("confirmDelivery")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setDelivering(false); setDeliverData(""); }}>{t("cancel")}</Button>
            </div>
          </div>
        )}

        {responding && o.status === "disputed" && (
          <div className="mt-3.5 pt-3.5 border-t border-line space-y-3">
            <Field label={t("disputeResponse")} hint={t("disputeResponseHint")}>
              <Textarea rows={3} value={sellerNote} onChange={(e) => setSellerNote(e.target.value)}
                placeholder={t("disputeResponsePlaceholder")} />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" disabled={submitting || !sellerNote.trim()} onClick={submitResponse}>
                {submitting ? t("sending") : t("sendResponse")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setResponding(false); setSellerNote(""); }}>{t("cancel")}</Button>
            </div>
          </div>
        )}

        {hasContent && (
          <Disclosure label={t("viewDashboard")} labelOpen={t("hideDashboard")} open={dashboardOpen} onToggle={() => setDashboardOpen((v) => !v)}>
            <ServiceDashboard orderId={o.id} viewerRole="seller" />
          </Disclosure>
        )}
        {hasContent && <OrderResources orderId={o.id} />}
      </div>
    </Card>
  );
}
