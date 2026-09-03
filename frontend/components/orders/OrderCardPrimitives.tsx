"use client";

/* Shared order display blocks for buyer OrderCard and seller SellerOrderCard. */

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { orderStatus } from "@/lib/order-status";
import { formatDate } from "@/lib/utils";
import type { Dispute, Order, Resource } from "@/lib/types";
import { isDisputeReadyToAccept, resourceLabelMap } from "@/lib/dispute-case";
import { Button, Card, Disclosure, Monogram, Tag, Textarea } from "@/components/ui";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { Check } from "@/components/Icons";
import { DisputeCaseView } from "./DisputeCaseView";

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

export function OrderDispute({
  orderId,
  initialDispute,
  viewerRole = "buyer",
  refreshKey = 0,
  layout = "disclosure",
  resourceLabels: resourceLabelsProp,
  onResourceClick,
  onDisputeChanged,
}: {
  orderId: number;
  initialDispute?: Dispute | null;
  viewerRole?: "buyer" | "seller";
  refreshKey?: number;
  layout?: "disclosure" | "panel";
  resourceLabels?: Record<number, string>;
  onResourceClick?: (resourceId: number) => void;
  onDisputeChanged?: (outcome: "withdrawn") => void;
}) {
  const t = useTranslations("orders");
  const td = useTranslations("status.dispute");
  const apiErrorMessage = useApiErrorMessage();
  const { formatBrowseMoney } = useMoney();
  const [dispute, setDispute] = useState<Dispute | null>(initialDispute ?? null);
  const [open, setOpen] = useState(layout === "panel");
  const [loaded, setLoaded] = useState(!!initialDispute);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [fetchedLabels, setFetchedLabels] = useState<Record<number, string>>({});

  useEffect(() => {
    if (initialDispute !== undefined) {
      setDispute(initialDispute);
      setLoaded(true);
    }
  }, [initialDispute]);

  useEffect(() => {
    if (refreshKey > 0 || layout === "panel") {
      void refresh();
    }
  }, [refreshKey, layout]);

  useEffect(() => {
    if (!dispute || resourceLabelsProp) return;
    let active = true;
    const load = viewerRole === "seller"
      ? api.sellerDisputeResources(dispute.id).then((rows) => resourceLabelMap(rows))
      : api.orderResources(orderId).then((rows) => resourceLabelMap(rows));
    load.then((labels) => { if (active) setFetchedLabels(labels); }).catch(() => { /* keep #id chips */ });
    return () => { active = false; };
  }, [dispute?.id, orderId, resourceLabelsProp, viewerRole]);

  const toggle = async () => {
    setOpen((v) => !v);
    if (!loaded) {
      try { setDispute(await api.orderDispute(orderId)); } catch { /* ignore */ }
      setLoaded(true);
    }
  };

  const refresh = async () => {
    try {
      const next = viewerRole === "seller" ? await api.sellerDispute(orderId) : await api.orderDispute(orderId);
      setDispute(next);
    } catch {
      if (!initialDispute) setDispute(null);
    } finally {
      setLoaded(true);
    }
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
    if (!window.confirm(t("acceptDisputeResolutionConfirm"))) return;
    setSubmitting(true);
    try { await api.acceptDisputeResolution(orderId); await refresh(); }
    finally { setSubmitting(false); }
  };

  const withdrawDispute = async () => {
    if (!window.confirm(t("withdrawDisputeConfirm"))) return;
    setActionError("");
    setSubmitting(true);
    try {
      await api.withdrawDispute(orderId);
      await refresh();
      onDisputeChanged?.("withdrawn");
    }
    catch (error) { setActionError(apiErrorMessage(error)); }
    finally { setSubmitting(false); }
  };

  const canAcceptResolution = !!dispute && isDisputeReadyToAccept(dispute);
  const toneMap = DISPUTE_STATUS_INFO;
  const info = dispute
    ? {
        label: canAcceptResolution
          ? td("awaiting_buyer_acceptance")
          : td.has(dispute.status) ? td(dispute.status as "open") : (toneMap[dispute.status]?.label ?? dispute.status),
        tone: canAcceptResolution ? ("iris" as const) : toneMap[dispute.status]?.tone ?? ("neutral" as const),
      }
    : null;
  const labels = resourceLabelsProp ?? fetchedLabels;

  const body = (
    <div className={cn(layout === "disclosure" && "mt-2.5", "space-y-2 text-[12.5px]")}>
      {loaded && !dispute && <p className="text-faint">{t("disputeLoadFail")}</p>}
      {dispute && info && (
        <>
          <DisputeCaseView
            dispute={dispute}
            statusLabel={info.label}
            statusTone={info.tone}
            resourceLabels={labels}
            formatRefund={formatBrowseMoney}
            onResourceClick={onResourceClick}
          />

          {viewerRole === "buyer" && dispute.status === "open" && (
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              {canAcceptResolution && (
                <p className="text-[12px] text-muted">{t("disputeReadyToAcceptHint")}</p>
              )}
              <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("disputeMessagePlaceholder")} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={submitting || !message.trim()} onClick={sendMessage}>{t("sendDisputeMessage")}</Button>
                {canAcceptResolution && <Button size="sm" disabled={submitting} onClick={acceptResolution}>{t("acceptDisputeResolution")}</Button>}
                {(dispute.resource_actions?.length ?? 0) === 0 && (
                  <Button size="sm" variant="ghost" disabled={submitting} onClick={withdrawDispute}>{t("withdrawDispute")}</Button>
                )}
              </div>
              {actionError && <p className="text-[12px] text-bad" role="alert">{actionError}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );

  if (layout === "panel") return body;

  return (
    <Disclosure label={t("showDispute")} labelOpen={t("hideDispute")} open={open} onToggle={toggle}>
      {body}
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
