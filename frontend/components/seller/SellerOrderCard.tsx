"use client";

/* Card cho một đơn "cần xử lý" (pending/processing/disputed) trên trang
 * /seller/orders. Lắp lại đúng bộ primitive (timeline/dispute/dashboard) mà
 * buyer's OrderCard dùng — cùng một component, khác bộ action ở dưới vì
 * seller làm được việc khác buyer (chấp nhận/giao hàng/phản hồi khiếu nại
 * thay vì xác nhận/mở khiếu nại/đánh giá). */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { displayOrderStatus } from "@/lib/order-status";
import type { Dispute, Order, SellerDisputeResource } from "@/lib/types";
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
  const { formatOrderHistoryMoney } = useMoney();
  const st = displayOrderStatus(o, locale);
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
          <span className="font-mono text-[14px] font-semibold tabular">
            {formatOrderHistoryMoney(o.total_amount, o.display_fx_rate_snapshot, { locale }).text}
          </span>
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

        {!['cancelled', 'refunded'].includes(o.status) && <div className="mt-3"><OrderChatButton orderId={o.id} /></div>}

        {o.status === "disputed" && <OrderDispute orderId={o.id} initialDispute={dispute} viewerRole="seller" />}
        {o.status === "disputed" && dispute && (
          <SellerDisputeActions dispute={dispute} onChanged={onDisputeResponded} />
        )}

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
          {o.status === "disputed" && !responding && (
            <Button size="sm" variant="secondary" onClick={() => setResponding(true)}>
              {dispute?.seller_note ? t("addAnotherReply") : t("respondToDispute")}
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

function SellerDisputeActions({ dispute, onChanged }: { dispute: Dispute; onChanged: () => void }) {
  const t = useTranslations("seller");
  const [resources, setResources] = useState<SellerDisputeResource[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => setResources((await api.sellerDisputeResources(dispute.id, { per_page: 100 })).items);
  useEffect(() => { void load(); }, [dispute.id]);

  const toggle = (id: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const resolve = async (action: "replace" | "refund") => {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      await api.sellerResolveDisputeResources(dispute.id, [...selected], action, note.trim() || undefined);
      setSelected(new Set());
      setNote("");
      await load();
      onChanged();
    } finally { setSubmitting(false); }
  };

  const unresolved = resources.filter((resource) => !resource.action);
  if (resources.length === 0) return null;

  return (
    <div className="mt-3.5 space-y-2.5 rounded-xl border border-warn/25 bg-warn-soft/20 p-3.5">
      <div>
        <p className="text-[12.5px] font-semibold text-fg">{t("claimedAccountsTitle", { count: unresolved.length })}</p>
        <p className="text-[11.5px] text-muted">{t("claimedAccountsHint")}</p>
      </div>
      <div className="max-h-52 space-y-1 overflow-y-auto">
        {resources.map((resource) => (
          <label key={resource.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-[11.5px]">
            <input type="checkbox" checked={selected.has(resource.id)} disabled={!!resource.action} onChange={() => toggle(resource.id)} className="h-4 w-4 accent-iris" />
            <span className="font-mono text-iris">#{resource.id}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-fg">{resource.data}</span>
            <span className={resource.action ? "text-good" : "text-warn"}>{resource.action ? t("claimResolved") : t("claimPending")}</span>
          </label>
        ))}
      </div>
      <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("resourceActionNote")} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={submitting || selected.size === 0} onClick={() => resolve("replace")}>{t("replaceSelected", { count: selected.size })}</Button>
        <Button size="sm" variant="danger" disabled={submitting || selected.size === 0} onClick={() => resolve("refund")}>{t("refundSelected", { count: selected.size })}</Button>
      </div>
    </div>
  );
}
