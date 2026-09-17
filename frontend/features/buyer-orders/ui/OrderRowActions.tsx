"use client";

import { memo, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { Order } from "@/lib/types";
import { Button } from "@/components/ui";
import { AlertTriangle, Check, Copy, Download, Eye, ShieldCheck, Star } from "@/components/Icons";
import { deliveredDataFileName } from "../model";

export interface OrderActionHandlers {
  onOpen: (order: Order, options?: { tab?: "review" }) => void;
  onConfirm: (order: Order) => void;
  onDispute: (order: Order) => void;
}

/** What the buyer may do with this row, derived once from the API capabilities
 *  (falling back to status when an old payload has none). */
export function rowActions(order: Order, disputed: boolean) {
  const caps = order.capabilities;
  return {
    hasData: Boolean(order.delivered_data),
    canConfirm: caps ? caps.can_confirm : order.status === "delivered" && !disputed,
    canDispute: caps ? caps.can_dispute : order.status === "delivered" && !disputed,
    canReview: caps ? caps.can_review && !order.has_review : ["delivered", "completed"].includes(order.status) && !order.has_review,
  };
}

function copyText(text: string) {
  return navigator.clipboard?.writeText(text).catch(() => {});
}

export function downloadDeliveredData(order: Order) {
  if (!order.delivered_data) return;
  const blob = new Blob([order.delivered_data], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = deliveredDataFileName(order);
  a.click();
  URL.revokeObjectURL(url);
}

/** Copy button that owns its "copied" flash so a click re-renders one cell, not the list. */
export const CopyIconButton = memo(function CopyIconButton({
  text, title, className, size = 14,
}: { text: string; title: string; className?: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(() => {
    void copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [text]);
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
        className,
      )}
    >
      {copied ? <Check size={size} className="text-good" /> : <Copy size={size} />}
    </button>
  );
});

/** Trailing action cluster for the desktop table: primary action first, then
 *  data shortcuts, then the detail eye. Layout is a column so the row height
 *  stays predictable regardless of how many actions apply. */
export const DesktopRowActions = memo(function DesktopRowActions({
  order, disputed, confirming, handlers,
}: { order: Order; disputed: boolean; confirming: boolean; handlers: OrderActionHandlers }) {
  const t = useTranslations("orders");
  const tb = useTranslations("buyerOrders");
  const a = rowActions(order, disputed);
  return (
    <div className="flex flex-col items-stretch gap-1">
      {a.canConfirm && (
        <Button size="sm" disabled={confirming} onClick={() => handlers.onConfirm(order)} className="h-7 w-full justify-center gap-1 overflow-hidden text-[11px]">
          <ShieldCheck size={12} className="shrink-0" /> <span className="truncate">{confirming ? t("confirming") : t("confirmReceived")}</span>
        </Button>
      )}
      {disputed && (
        <Button size="sm" variant="secondary" onClick={() => handlers.onOpen(order)} className="h-7 w-full justify-center gap-1 overflow-hidden text-[11px] text-bad">
          <AlertTriangle size={12} className="shrink-0" /> <span className="truncate">{tb("viewDispute")}</span>
        </Button>
      )}
      {a.canReview && (
        <Button size="sm" variant="secondary" onClick={() => handlers.onOpen(order, { tab: "review" })} className="h-7 w-full justify-center gap-1 overflow-hidden text-[11px]">
          <Star size={12} className="shrink-0" /> <span className="truncate">{t("review")}</span>
        </Button>
      )}
      <div className="flex items-center justify-end gap-0.5">
        {a.hasData && (
          <>
            <button
              type="button"
              title={t("downloadTxtHint")}
              aria-label={t("downloadTxtHint")}
              onClick={() => downloadDeliveredData(order)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            >
              <Download size={13} />
            </button>
            <CopyIconButton text={order.delivered_data ?? ""} title={t("copyAllData")} className="h-7 w-7" size={13} />
          </>
        )}
        {a.canDispute && (
          <button
            type="button"
            title={t("openDispute")}
            aria-label={t("openDispute")}
            onClick={() => handlers.onDispute(order)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-bad-soft hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            <AlertTriangle size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={() => handlers.onOpen(order)}
          className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 text-[11px] text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          <Eye size={13} /> {tb("detail")}
        </button>
      </div>
    </div>
  );
});
