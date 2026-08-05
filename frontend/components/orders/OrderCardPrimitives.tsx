"use client";

/* Shared order display blocks for buyer OrderCard and seller SellerOrderCard. */

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { api, vnd } from "@/lib/api";
import { cn } from "@/lib/cn";
import { orderStatus } from "@/lib/order-status";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { Dispute, Order, Resource } from "@/lib/types";
import { evidenceFieldLabel, evidenceTypeLabel } from "@/lib/dispute-evidence";
import { Card, Disclosure, Monogram, Tag } from "@/components/ui";
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

export function OrderDispute({ orderId, initialDispute }: { orderId: number; initialDispute?: Dispute | null }) {
  const t = useTranslations("orders");
  const td = useTranslations("status.dispute");
  const locale = useLocale();
  const [dispute, setDispute] = useState<Dispute | null>(initialDispute ?? null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(!!initialDispute);

  const toggle = async () => {
    setOpen((v) => !v);
    if (!loaded) {
      try { setDispute(await api.orderDispute(orderId)); } catch { /* ignore */ }
      setLoaded(true);
    }
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
  const st = orderStatus(o.status, locale);
  return (
    <Card className="px-4 py-3">
      <div className="flex items-start gap-3 min-w-0">
        <Monogram text={o.product_title ?? "??"} className="h-8 w-8 text-[12px] text-faint" />
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
          <p className="font-mono text-[13px] tabular text-muted">{vnd(o.total_amount, locale)}</p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-good">
            <Check size={11} /> {viewerRole === "seller" ? t("refundedToBuyer") : t("refundedToWallet")}
          </p>
        </div>
      </div>
      {o.has_dispute && <OrderDispute orderId={o.id} />}
    </Card>
  );
}
