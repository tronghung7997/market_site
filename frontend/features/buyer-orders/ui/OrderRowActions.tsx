"use client";

import { memo, useCallback, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { copyFromBff, downloadFromBff } from "@/lib/download";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { Order } from "@/lib/types";
import { Button } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { AlertTriangle, Check, Copy, Download, Eye, ShieldCheck, Star, Wallet } from "@/components/Icons";
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
    // Lists carry no delivered text; the API says whether there is any.
    hasData: order.has_delivery ?? Boolean(order.delivered_data),
    canConfirm: caps ? caps.can_confirm : order.status === "delivered" && !disputed,
    canDispute: caps ? caps.can_dispute : order.status === "delivered" && !disputed,
    canReview: caps ? caps.can_review && !order.has_review : ["delivered", "completed"].includes(order.status) && !order.has_review,
    // Money came back: the wallet rows for this order.
    refundHref: order.status === "refunded" || order.status === "cancelled"
      ? `/transactions?q=${encodeURIComponent(order.order_code)}`
      : null,
  };
}

function copyText(text: string) {
  return navigator.clipboard?.writeText(text).catch(() => {});
}

/** Download / copy every delivered line of a row's order. The goods are
 *  fetched on click from the streamed delivery file, never from the list, and
 *  a failure is announced next to the buttons. */
export const DeliveryShortcuts = memo(function DeliveryShortcuts({
  order, compact = false,
}: { order: Order; compact?: boolean }) {
  const t = useTranslations("orders");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const [busy, setBusy] = useState<"download" | "copy" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const run = async (kind: "download" | "copy") => {
    setBusy(kind);
    setError("");
    const url = api.orderDeliveryUrl(order.order_code);
    try {
      if (kind === "download") {
        const fileName = deliveredDataFileName(order);
        await downloadFromBff(url, { fileName, fallbackName: fileName, locale });
      } else {
        await copyFromBff(url, { locale });
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }
    } catch (cause) {
      setError(apiErrorMessage(cause, t("linesLoadFailed")));
    } finally {
      setBusy(null);
    }
  };
  const iconSize = compact ? 13 : 14;
  return (
    <>
      {compact ? (
        <button
          type="button"
          title={t("downloadTxtHint")}
          aria-label={t("downloadTxtHint")}
          aria-busy={busy === "download"}
          disabled={busy !== null}
          onClick={() => void run("download")}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris disabled:cursor-wait disabled:opacity-60"
        >
          <Download size={iconSize} />
        </button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          aria-busy={busy === "download"}
          disabled={busy !== null}
          onClick={() => void run("download")}
          className="min-h-[38px] gap-1.5"
          title={t("downloadTxtHint")}
        >
          <Download size={iconSize} /> {busy === "download" ? t("preparingLines") : t("downloadTxt")}
        </Button>
      )}
      <button
        type="button"
        title={t("copyAllData")}
        aria-label={t("copyAllData")}
        aria-busy={busy === "copy"}
        disabled={busy !== null}
        onClick={() => void run("copy")}
        className={cn(
          "inline-flex items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris disabled:cursor-wait disabled:opacity-60",
          compact ? "h-7 w-7" : "min-h-[38px] w-[38px] border border-line bg-surface",
        )}
      >
        {copied ? <Check size={iconSize} className="text-good" /> : <Copy size={iconSize} />}
      </button>
      {error && <span role="alert" className="basis-full text-right text-[11px] text-bad">{error}</span>}
    </>
  );
});

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
      {a.refundHref && (
        <Link href={a.refundHref}>
          <Button size="sm" variant="secondary" className="h-7 w-full justify-center gap-1 overflow-hidden text-[11px]">
            <Wallet size={12} className="shrink-0" /> <span className="truncate">{tb("viewRefund")}</span>
          </Button>
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-end gap-0.5">
        {a.hasData && <DeliveryShortcuts order={order} compact />}
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
