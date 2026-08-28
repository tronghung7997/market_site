"use client";

/* Shared order display blocks for buyer OrderCard and seller SellerOrderCard. */

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { orderStatus } from "@/lib/order-status";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { Dispute, Order, Resource } from "@/lib/types";
import { evidenceFieldLabel, evidenceTypeLabel } from "@/lib/dispute-evidence";
import { Button, Card, Disclosure, Monogram, Tag, Textarea } from "@/components/ui";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { Check } from "@/components/Icons";

const TIMELINE_KEYS = ["pending", "processing", "delivered", "completed"] as const;

function stepIndex(status: string): number {
  return TIMELINE_KEYS.findIndex((s) => s === status);
}

export function StatusTimeline({ status }: { status: string }) {
  const t = useTranslations("status.timeline");
  const isBad = ["disputed", "refunded", "cancelled"].includes(status);
  const current = status === "completed" ? 3 : status === "delivered" ? 2 : stepIndex(status);

  if (isBad) return null;

  return (
    <div className="flex items-center mt-4 mb-1 gap-0 px-1">
      {TIMELINE_KEYS.map((key, i) => {
        const done = current >= i;
        return (
          <div key={key} className={cn("flex items-center", i > 0 && "flex-1")}>
            {i > 0 && <div className={cn("h-[2px] flex-1 rounded-full transition-colors", done ? "bg-iris" : "bg-line")} />}
            <div className="flex flex-col items-center gap-1.5">
              <div className={cn(
                "w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold shrink-0 transition-colors",
                done ? "bg-iris text-white shadow-[0_0_0_3px_var(--color-iris-soft)]" : "bg-surface border-2 border-line text-faint",
              )}>
                {done ? "✓" : i + 1}
              </div>
              <span className={cn("text-[10.5px] whitespace-nowrap", done ? "text-fg font-medium" : "text-faint")}>{t(key)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function OrderResources({ orderId }: { orderId: number }) {
  const t = useTranslations("orders");
  const tr = useTranslations("status.resource");
  const [resources, setResources] = useState<Resource[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const toggle = async () => {
    setOpen((v) => !v);
    if (!loaded) {
      try { setResources(await api.orderResources(orderId)); } catch { /* ignore */ }
      setLoaded(true);
    }
  };

  const fmtExpiry = (iso: string | null) => {
    if (!iso) return tr("permanent");
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return tr("expiredAgo");
    return tr("daysLeft", { count: Math.ceil(ms / 86400000) });
  };
  const tone = (s: string) => s === "assigned" ? "good" : s === "expired" ? "warn" : s === "error" ? "bad" : "neutral";
  const label = (s: string) => {
    if (s === "assigned" || s === "expired" || s === "error" || s === "available") return tr(s);
    return s;
  };

  return (
    <Disclosure label={t("showResources")} labelOpen={t("hideResources")} open={open} onToggle={toggle}>
      <div className="mt-2.5 space-y-1.5">
        {loaded && resources.length === 0 && <p className="text-[12px] text-faint">{t("noResources")}</p>}
        {resources.map((r) => (
          <div key={r.id} className="flex items-center gap-3 text-[12.5px] px-3 py-2 rounded-lg bg-raised border border-line">
            <span className="font-mono text-faint">#{r.id}</span>
            <Tag tone={tone(r.status)}>{label(r.status)}</Tag>
            <span className="ml-auto text-muted">{fmtExpiry(r.expires_at)}</span>
          </div>
        ))}
      </div>
    </Disclosure>
  );
}

export const DISPUTE_STATUS_INFO: Record<string, { label: string; tone: "good" | "bad" | "warn" | "iris" | "neutral" }> = {
  open: { label: "Waiting for admin review", tone: "warn" },
  resolved_refund: { label: "Full refund issued", tone: "bad" },
  resolved_reject: { label: "Rejected — order stands", tone: "neutral" },
  resolved_partial_refund: { label: "Partial refund issued", tone: "bad" },
  resolved_replace: { label: "Replaced with a new item", tone: "iris" },
  resolved_extend_warranty: { label: "Warranty extended", tone: "iris" },
};

export function OrderDispute({ orderId, initialDispute, viewerRole = "buyer", refreshKey = 0 }: { orderId: number; initialDispute?: Dispute | null; viewerRole?: "buyer" | "seller"; refreshKey?: number }) {
  const t = useTranslations("orders");
  const td = useTranslations("status.dispute");
  const locale = useLocale();
  const [dispute, setDispute] = useState<Dispute | null>(initialDispute ?? null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(!!initialDispute);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (initialDispute !== undefined) {
      setDispute(initialDispute);
      setLoaded(true);
    }
  }, [initialDispute]);

  useEffect(() => {
    if (refreshKey > 0) {
      void refresh();
    }
  }, [refreshKey]);

  const toggle = async () => {
    setOpen((v) => !v);
    if (!loaded) {
      try { setDispute(await api.orderDispute(orderId)); } catch { /* ignore */ }
      setLoaded(true);
    }
  };

  const refresh = async () => {
    const next = viewerRole === "seller" ? await api.sellerDispute(orderId) : await api.orderDispute(orderId);
    setDispute(next);
    setLoaded(true);
  };

  const sendMessage = async () => {
    if (!message.trim() || viewerRole !== "buyer") return;
    setSubmitting(true);
    try {
      await api.buyerDisputeMessage(orderId, message.trim());
      setMessage("");
      await refresh();
    } finally { setSubmitting(false); }
  };

  const acceptResolution = async () => {
    setSubmitting(true);
    try { await api.acceptDisputeResolution(orderId); await refresh(); }
    finally { setSubmitting(false); }
  };

  const toneMap = DISPUTE_STATUS_INFO;
  const info = dispute
    ? {
        label: td.has(dispute.status) ? td(dispute.status as "open") : (toneMap[dispute.status]?.label ?? dispute.status),
        tone: toneMap[dispute.status]?.tone ?? ("neutral" as const),
      }
    : null;

  return (
    <Disclosure label={t("showDispute")} labelOpen={t("hideDispute")} open={open} onToggle={toggle}>
      <div className="mt-2.5 space-y-2 text-[12.5px]">
        {loaded && !dispute && <p className="text-faint">{t("disputeLoadFail")}</p>}
        {dispute && info && (
          <>
            <Tag tone={info.tone}>{info.label}</Tag>

            {dispute.timeline && dispute.timeline.length > 0 ? (
              <div className="mt-3 space-y-0">
                {dispute.timeline.map((event, index) => (
                  <div key={event.id} className="relative flex gap-3 pb-4 last:pb-1">
                    {index < dispute.timeline!.length - 1 && <span className="absolute left-[5px] top-3 h-full w-px bg-line" />}
                    <span className={cn(
                      "relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full ring-4 ring-surface",
                      event.actor_role === "buyer" ? "bg-iris" : event.actor_role === "seller" ? "bg-warn" : "bg-good",
                    )} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[11px] font-semibold text-fg">{t(`disputeEvents.${event.event_type}`)}</span>
                        <span className="text-[10.5px] text-faint">{formatDateTime(event.created_at, locale)}</span>
                      </div>
                      {event.body && <p className="mt-0.5 text-muted">{event.body}</p>}
                      {event.resource_ids.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {event.resource_ids.map((id, resourceIndex) => (
                            <span key={`${event.id}-${id}`} className="rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[10.5px] text-fg">
                              #{id}{event.replacement_resource_ids?.[resourceIndex] ? ` → #${event.replacement_resource_ids[resourceIndex]}` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                      {!!event.refund_amount && <p className="mt-1 font-mono text-[11px] font-semibold text-good">{t("refundAmountMinor", { amount: event.refund_amount })}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
            <div className="mt-1 space-y-3">
              <div className="border-l-2 border-iris/40 pl-3">
                <p className="text-[11px] font-semibold text-iris-hi mb-0.5">
                  {t("buyer")} <span className="font-normal text-faint">· {formatDateTime(dispute.created_at, locale)}</span>
                </p>
                <p>{dispute.reason}</p>
                {dispute.evidence && Object.keys(dispute.evidence).length > 0 && (
                  <div className="mt-1.5 space-y-0.5 text-[11.5px]">
                    <p className="text-faint">{t("evidence", { type: evidenceTypeLabel(dispute.evidence_type) })}</p>
                    {Object.entries(dispute.evidence).map(([key, value]) => (
                      <p key={key} className="text-muted">
                        <span className="text-faint">{evidenceFieldLabel(dispute.evidence_type, key)}: </span>
                        {value}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {dispute.seller_note && (
                <div className="border-l-2 border-line-2 pl-3">
                  <p className="text-[11px] font-semibold text-muted mb-0.5">{t("seller")}</p>
                  <p>{dispute.seller_note}</p>
                </div>
              )}

              {(dispute.admin_note || dispute.resolved_at) && (
                <div className="border-l-2 border-good/50 pl-3">
                  <p className="text-[11px] font-semibold text-good mb-0.5">
                    {t("admin")}
                    {dispute.resolved_at && (
                      <span className="font-normal text-faint"> · {formatDateTime(dispute.resolved_at, locale)}</span>
                    )}
                  </p>
                  <p>{dispute.admin_note ?? info.label}</p>
                </div>
              )}
            </div>
            )}

            {viewerRole === "buyer" && dispute.status === "open" && (
              <div className="mt-3 space-y-2 border-t border-line pt-3">
                <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("disputeMessagePlaceholder")} />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={submitting || !message.trim()} onClick={sendMessage}>{t("sendDisputeMessage")}</Button>
                  {!!dispute.resource_actions?.length && <Button size="sm" disabled={submitting} onClick={acceptResolution}>{t("acceptDisputeResolution")}</Button>}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Disclosure>
  );
}

export function TerminalOrderRow({ order: o, viewerRole = "buyer" }: { order: Order; viewerRole?: "buyer" | "seller" }) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { formatOrderHistoryMoney } = useMoney();
  const st = orderStatus(o.status, locale);
  const amountText = formatOrderHistoryMoney(
    o.total_amount,
    o.display_fx_rate_snapshot,
    { locale },
  ).text;
  return (
    <Card className="px-4 py-3">
      <div className="flex items-start gap-3 min-w-0">
        <ProductCover coverId={parseCoverId(o)} title={o.product_title ?? "??"} className="h-8 w-8 shrink-0 text-[12px] text-faint" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[13px] font-medium truncate">{o.product_title ?? tc("orderNumber", { id: o.id })}</span>
            <Tag tone={st.tone}>{st.label}</Tag>
          </div>
          <p className="text-[11.5px] text-faint mt-0.5">
            {tc("orderNumber", { id: o.id })} · {formatDate(o.created_at, locale)}
            {viewerRole === "seller" && o.buyer_email && <> · {o.buyer_email}</>}
          </p>
          {o.cancel_reason && (
            <p className="text-[11.5px] text-muted mt-0.5 leading-relaxed">{o.cancel_reason}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono text-[13px] tabular text-muted">{amountText}</p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-good">
            <Check size={11} /> {viewerRole === "seller" ? t("refundedToBuyer") : t("refundedToWallet")}
          </p>
        </div>
      </div>
      {o.has_dispute && <OrderDispute orderId={o.id} />}
    </Card>
  );
}
