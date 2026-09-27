"use client";

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { copyFromBff, downloadFromBff } from "@/lib/download";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money";
import { queryKeys } from "@/lib/query-keys";
import { endpointMethodLabel } from "@/lib/gateway-endpoint";
import { lineLabel } from "@/lib/order-ref";
import { orderStatus } from "@/lib/order-status";
import { formatDate, formatDateTime } from "@/lib/utils";
import { fulfillmentFromStrategy } from "@/lib/fulfillment";
import type { Order } from "@/lib/types";
import { Button, Tag } from "@/components/ui";
import { InspectionPanel } from "./trust";
import { PurchaseSteps } from "./PurchaseSteps";
import { ArrowRight, Check, Clock, Copy, Download, Eye, EyeOff, Key, ShieldCheck, X } from "@/components/Icons";

const ORDER_POLL_MS = 3000;
const ORDER_POLL_TIMEOUT_MS = 15 * 60 * 1000;

const STOCK_PREVIEW_LINES = 5;

/** Stock lines just delivered: a short preview plus download/copy of all of
 *  them from the streamed delivery file (an order can hold thousands). */
function StockDelivery({ order }: { order: Order }) {
  const t = useTranslations("products");
  const to = useTranslations("orders");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const [busy, setBusy] = useState<"download" | "copy" | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const preview = useQuery({
    queryKey: [...queryKeys.orderLines(order.id), "preview"] as const,
    queryFn: () => api.orderResources(order.order_code, { limit: STOCK_PREVIEW_LINES }),
  });
  const count = order.delivery_count ?? preview.data?.total ?? 0;
  const run = async (kind: "download" | "copy") => {
    setBusy(kind);
    setError("");
    const url = api.orderDeliveryUrl(order.order_code);
    try {
      if (kind === "download") {
        const fileName = `${order.order_code}_${order.quantity}.txt`;
        await downloadFromBff(url, { fileName, fallbackName: fileName, locale });
      } else {
        await copyFromBff(url, { locale });
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }
    } catch (cause) {
      setError(apiErrorMessage(cause, to("linesLoadFailed")));
    } finally {
      setBusy(null);
    }
  };
  const rows = preview.data?.items ?? [];
  return (
    <section aria-label={t("orderLinesDelivered", { count: count.toLocaleString() })} className="animate-rise space-y-3">
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="border-b border-line bg-raised/50 px-3 py-2 text-[12.5px] font-semibold text-fg">
          {t("orderLinesDelivered", { count: count.toLocaleString() })}
        </div>
        {preview.isPending ? (
          <div className="space-y-2.5 px-3 py-3" aria-hidden>
            {[72, 58, 66].map((width) => (
              <div key={width} className="flex items-center gap-3">
                <div className="h-3 w-7 rounded bg-line/70 animate-shimmer" />
                <div className="h-3 rounded bg-line/70 animate-shimmer" style={{ width: `${width}%` }} />
              </div>
            ))}
          </div>
        ) : preview.isError || rows.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-muted">{t("orderPreviewUnavailable")}</p>
        ) : (
          <ol className="divide-y divide-line/70">
            {rows.map((row, index) => (
              <li key={row.id} className="flex items-center gap-3 px-3 py-1.5 font-mono text-[12px] leading-5">
                <span className="w-8 shrink-0 text-right text-[11px] text-faint tabular">{lineLabel(row.line_no ?? index + 1)}</span>
                {/* One clipped line each: a delivered line can be a 20 KB cookie. */}
                <span className="min-w-0 flex-1 truncate text-fg">{row.data.slice(0, 200)}</span>
                <LineCopy text={row.data} label={t("copyLine", { line: lineLabel(row.line_no ?? index + 1) })} />
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-[11.5px]">
          {rows.length > 0 && (
            <span className="text-muted">{t("orderLinesPreview", { shown: rows.length, total: count.toLocaleString() })}</span>
          )}
          <Link
            href={`/orders?order=${encodeURIComponent(order.order_code)}`}
            className="ml-auto inline-flex items-center gap-1 rounded font-medium text-iris hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            {t("orderOpenAllLines")} <ArrowRight size={12} />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" disabled={busy !== null} aria-busy={busy === "download"} onClick={() => void run("download")} className="gap-1.5 whitespace-nowrap">
          <Download size={13} /> {busy === "download" ? to("preparingLines") : to("downloadTxt")}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy !== null} aria-busy={busy === "copy"} onClick={() => void run("copy")} className="gap-1.5 whitespace-nowrap">
          {copied ? <Check size={13} className="text-good" /> : <Copy size={13} />}
          {busy === "copy" ? to("preparingLines") : copied ? to("copiedAll") : to("copyAll")}
        </Button>
      </div>
      {error && <p role="alert" className="text-[11.5px] text-bad">{error}</p>}
      {order.escrow_expires_at && order.status !== "delivered" && (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-5 text-muted">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-good" />
          <span>{t("orderEscrowNote", { date: formatDate(order.escrow_expires_at, locale) })}</span>
        </p>
      )}
    </section>
  );
}

/** Copy one delivered line in full (the row itself shows it clipped). */
function LineCopy({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className="grid h-6 w-6 shrink-0 place-items-center rounded text-faint hover:bg-raised hover:text-fg"
    >
      {copied ? <Check size={12} className="text-good" /> : <Copy size={12} />}
    </button>
  );
}

/** `gwk_live_YqHL••••••XjHjw`: enough to recognise the key, not to use it. */
function maskKey(key: string): string {
  return key.length > 18 ? `${key.slice(0, 13)}••••••${key.slice(-5)}` : "••••••••";
}

/** Endpoint names shown in the purchase card; the order's API console lists them all. */
const ENDPOINT_CHIPS = 6;

const iconButton =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris";

/** Copy a value from an icon button, with a short "copied" state. */
function CopyIcon({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        navigator.clipboard?.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className={iconButton}
    >
      {copied ? <Check size={14} className="text-good" /> : <Copy size={14} />}
    </button>
  );
}

/** API package just delivered: the key (masked until revealed), the call URL
 *  (key shown as a placeholder, copied in full), remaining requests and the
 *  callable endpoints; docs, try-it and call history live on the order. */
function ApiAccess({ order }: { order: Order }) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const locale = useLocale();
  const access = order.gateway_access!;
  const [revealed, setRevealed] = useState(false);
  const dashboard = useQuery({
    queryKey: ["order-dashboard", order.id] as const,
    queryFn: () => api.orderDashboard(order.id),
    staleTime: 30_000,
  });
  const balance = dashboard.data?.balance ?? null;
  const endpoints = dashboard.data?.api?.endpoints ?? [];
  const number = new Intl.NumberFormat(locale === "en" ? "en-US" : "vi-VN");
  const shownUrl = access.url.replace(access.key, "{API_KEY}");
  return (
    <section aria-label={t("apiAccessTitle")} className="animate-rise space-y-3">
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-line bg-raised/50 px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
            <Key size={14} className="text-iris" /> {t("apiAccessTitle")}
          </span>
          {balance && (
            <span className="font-mono text-[11.5px] text-muted tabular">
              {t("apiRequestsLeft", { left: number.format(balance.units_remaining), total: number.format(balance.units_total) })}
            </span>
          )}
        </div>
        <dl className="divide-y divide-line/70">
          <div className="px-3 py-2.5">
            <dt className="text-[11px] text-muted">{t("apiKeyLabel")}</dt>
            <dd className="mt-1 flex items-center gap-1">
              <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{revealed ? access.key : maskKey(access.key)}</code>
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                aria-pressed={revealed}
                aria-label={revealed ? tc("hide") : tc("show")}
                title={revealed ? tc("hide") : tc("show")}
                className={iconButton}
              >
                {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <CopyIcon value={access.key} label={t("apiCopyKey")} />
            </dd>
          </div>
          <div className="px-3 py-2.5">
            <dt className="text-[11px] text-muted">{t("apiCallUrlLabel")}</dt>
            <dd className="mt-1 flex items-start gap-1">
              <code className="min-w-0 flex-1 break-words pt-1.5 font-mono text-[12px] leading-5 text-fg">
                {/* Wrap at path segments, not in the middle of one. */}
                {shownUrl.split("/").map((part, index, parts) => (
                  <Fragment key={index}>{part}{index < parts.length - 1 && <>/<wbr /></>}</Fragment>
                ))}
              </code>
              <CopyIcon value={access.url} label={t("apiCopyUrl")} />
            </dd>
          </div>
          {endpoints.length > 0 && (
            <div className="px-3 py-2.5">
              <dt className="text-[11px] text-muted">{t("apiEndpointsLabel")}</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {endpoints.slice(0, ENDPOINT_CHIPS).map((endpoint) => (
                  <span key={endpoint.name} className="inline-flex items-center gap-1 rounded-md border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] text-fg">
                    <span className="text-faint">{endpointMethodLabel(endpoint.method)}</span> {endpoint.name}
                  </span>
                ))}
                {endpoints.length > ENDPOINT_CHIPS && (
                  <span className="rounded-md px-1.5 py-0.5 text-[11px] text-muted">
                    {t("apiMoreEndpoints", { count: endpoints.length - ENDPOINT_CHIPS })}
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
        <div className="flex justify-end border-t border-line px-3 py-2 text-[11.5px]">
          <Link
            href={`/orders?order=${encodeURIComponent(order.order_code)}`}
            className="inline-flex items-center gap-1 rounded font-medium text-iris hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          >
            {t("apiOpenConsole")} <ArrowRight size={12} />
          </Link>
        </div>
      </div>
      <p className="flex items-start gap-1.5 text-[11.5px] leading-5 text-muted">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-good" />
        <span>{t("apiKeySecretNote")}</span>
      </p>
    </section>
  );
}

const LABELLED_LINE = /^([^:|]{1,28}):\s+(.+)$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Short text deliveries (proxy credentials, manual hand-over): "Label: value"
 *  lines become labelled rows with their own copy, other lines numbered rows. */
function TextDelivery({ text }: { text: string }) {
  const t = useTranslations("products");
  const locale = useLocale();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // Expiry and similar fields arrive as ISO timestamps: show them as local time.
  const readable = (value: string) =>
    ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value)) ? formatDateTime(value, locale) : value;
  return (
    <section aria-label={t("orderHandoffInfo")} className="animate-rise">
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-line bg-raised/50 px-3 py-1.5">
          <span className="text-[12.5px] font-semibold text-fg">{t("orderHandoffInfo")}</span>
          <CopyIcon value={text} label={t("copyAllDelivered")} />
        </div>
        <dl className="divide-y divide-line/70">
          {lines.slice(0, 12).map((line, index) => {
            const labelled = LABELLED_LINE.exec(line);
            const value = labelled ? readable(labelled[2]) : line;
            return (
              <div key={index} className="flex items-center gap-3 px-3 py-1.5">
                <dt className="w-20 shrink-0 truncate text-[11px] text-muted">
                  {labelled ? labelled[1] : lineLabel(index + 1)}
                </dt>
                <dd className="min-w-0 flex-1 truncate font-mono text-[12px] leading-5 text-fg">{value}</dd>
                <CopyIcon value={value} label={t("copyThisLine")} />
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}

function useOrderPolling(initial: Order, enabled: boolean) {
  const queryClient = useQueryClient();
  const [order, setOrder] = useState(initial);

  useEffect(() => setOrder(initial), [initial]);

  const settled = order.status !== "pending";
  useEffect(() => {
    if (settled || !enabled) return;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > ORDER_POLL_TIMEOUT_MS) {
        clearInterval(timer);
        return;
      }
      try {
        const fresh = await api.getOrder(order.id);
        if (fresh.status !== "pending") {
          clearInterval(timer);
          if (fresh.status === "cancelled" || fresh.status === "refunded") {
            queryClient.invalidateQueries({ queryKey: queryKeys.wallet() });
          }
        }
        setOrder(fresh);
      } catch {
        /* retry next tick */
      }
    }, ORDER_POLL_MS);
    return () => clearInterval(timer);
  }, [order.id, settled, enabled, queryClient]);

  return order;
}

function useElapsed(since: string, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function ProvisionSteps({ elapsed, workingLabel, nextLabel }: { elapsed: string; workingLabel: string; nextLabel: string }) {
  const t = useTranslations("products");
  return (
    <div role="status" aria-live="polite" className="relative pl-7">
      <div className="absolute left-[8px] top-2.5 bottom-2.5 w-px bg-line" />
      <div className="relative pb-3">
        <span className="absolute -left-7 top-[1px] grid h-[17px] w-[17px] place-items-center rounded-full border border-good/30 bg-good-soft text-good">
          <Check size={10} />
        </span>
        <p className="text-[12.5px] text-muted">{t("orderPaid")}</p>
      </div>
      <div className="relative pb-3">
        <span className="absolute -left-7 top-[1px] h-[17px] w-[17px] rounded-full border-2 border-warn/25 border-t-warn bg-surface animate-spin-ring" />
        <p className="text-[12.5px] font-medium text-fg">
          {workingLabel}
          <span className="ml-1.5 font-mono text-[11px] font-normal text-faint tabular-nums">{elapsed}</span>
        </p>
      </div>
      <div className="relative">
        <span className="absolute -left-7 top-[1px] h-[17px] w-[17px] rounded-full border border-line-2 bg-surface" />
        <p className="text-[12.5px] text-faint">{nextLabel}</p>
      </div>
    </div>
  );
}

export default function OrderResult({ order: initial, onRebuy, fulfillment, deliveryMode, slaHours, inspectionSteps }: {
  order: Order; onRebuy: () => void; fulfillment?: string | null;
  /** From the variant the buyer picked; the create response does not carry them. */
  deliveryMode?: string | null; slaHours?: number | null;
  /** The product's "check before you confirm" list, shown while protection runs. */
  inspectionSteps?: string[] | null;
}) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { formatOrderHistoryMoney } = useMoney();
  // Every order carries product_id now, so "waiting on a provider" is:
  // adapter orders (no variant) or non-manual variants still pending.
  // A manual variant is the seller's job within their SLA — no spinner,
  // no 15-minute refund promise.
  const manual = (initial.delivery_mode ?? deliveryMode) === "manual";
  const viaProvider = !manual && (initial.variant_id == null || initial.product_id != null);
  const kind = fulfillmentFromStrategy(fulfillment).kind;
  const order = useOrderPolling(initial, viaProvider);
  const amountText = formatOrderHistoryMoney(
    order.total_amount,
    order.display_fx_rate_snapshot,
    { locale },
  ).text;
  const deliveryText = order.delivered_data;

  const pending = order.status === "pending";
  const failed = order.status === "cancelled" || order.status === "refunded";
  const working = pending && viaProvider;
  const elapsed = useElapsed(order.created_at, working);
  const st = orderStatus(order.status, locale);

  return (
    <div className="space-y-4">
      {!failed && <PurchaseSteps current={3} />}
      <div className="flex items-center gap-3">
        <span key={order.status} className={`relative ${!pending ? "animate-seal" : ""}`}>
          {working && (
            <span
              aria-hidden
              className="absolute -inset-1 rounded-full border-2 border-warn/20 border-t-warn animate-spin-ring"
            />
          )}
          <span
            className={`grid place-items-center h-9 w-9 rounded-full border ${
              pending
                ? "bg-warn-soft text-warn border-warn/25"
                : failed
                ? "bg-bad-soft text-bad border-bad/25"
                : "bg-good-soft text-good border-good/25"
            }`}
          >
            {pending ? <Clock size={16} /> : failed ? <X size={16} /> : <Check size={16} />}
          </span>
        </span>
        <div>
          <div className="text-[13.5px] font-medium">{tc("orderNumber", { id: order.order_code })}</div>
          <Tag tone={st.tone}>{st.label}</Tag>
        </div>
      </div>

      {pending ? (
        viaProvider ? (
          <div className="space-y-3.5">
            <ProvisionSteps
              elapsed={elapsed}
              workingLabel={kind === "task" ? t("orderSendingTask") : kind === "api" ? t("orderIssuingKey") : t("orderFetching")}
              nextLabel={kind === "task" ? t("orderWaitResult") : kind === "api" ? t("orderReceiveKey") : t("orderHandoff")}
            />
            <div className="rounded-lg border border-line bg-raised/60 p-3">
              <p className="text-[11px] text-faint uppercase tracking-wider mb-2">{t("orderHandoffInfo")}</p>
              <div className="space-y-1.5" aria-hidden>
                <div className="h-3 w-3/4 rounded bg-line/70 animate-shimmer" />
                <div className="h-3 w-1/2 rounded bg-line/70 animate-shimmer" />
              </div>
            </div>
            <p className="text-[11.5px] text-faint">{t("orderAutoUpdate")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[12.5px] text-muted">{t("orderSellerSlaHours", { hours: initial.sla_hours ?? slaHours ?? 24 })}</p>
            <p className="text-[11.5px] text-faint">{t("orderSellerSlaNote")}</p>
          </div>
        )
      ) : failed ? (
        <div className="space-y-3.5">
          {viaProvider ? (
            <div className="relative pl-7">
              <div className="absolute left-[8px] top-2.5 bottom-2.5 w-px bg-line" />
              <div className="relative pb-3">
                <span className="absolute -left-7 top-[1px] grid h-[17px] w-[17px] place-items-center rounded-full border border-good/30 bg-good-soft text-good">
                  <Check size={10} />
                </span>
                <p className="text-[12.5px] text-muted">{t("orderPaid")}</p>
              </div>
              <div className="relative pb-3">
                <span className="absolute -left-7 top-[1px] grid h-[17px] w-[17px] place-items-center rounded-full border border-bad/30 bg-bad-soft text-bad">
                  <X size={10} />
                </span>
                <p className="text-[12.5px] font-medium text-fg">{t("orderProviderFailed")}</p>
                {order.cancel_reason && (
                  <p className="mt-0.5 text-[11.5px] text-faint">{order.cancel_reason}</p>
                )}
              </div>
              <div className="relative">
                <span className="absolute -left-7 top-[1px] grid h-[17px] w-[17px] place-items-center rounded-full border border-good/30 bg-good-soft text-good">
                  <Check size={10} />
                </span>
                <p className="text-[12.5px] text-muted">{t("orderRefundedWallet")}</p>
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">
              {order.status === "refunded" ? t("orderWasRefunded") : t("orderWasCancelled")}
            </p>
          )}

          <div className="flex items-start gap-2.5 rounded-lg border border-good/25 bg-good-soft p-3 animate-rise">
            <span className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full bg-good/15 text-good">
              <Check size={13} />
            </span>
            <div>
              <p className="text-[13px] font-semibold text-good">
                {t("refundedAmount", { amount: amountText })}
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted">{t("refundedHint")}</p>
            </div>
          </div>
        </div>
      ) : order.delivery_count ? (
        <StockDelivery order={order} />
      ) : order.gateway_access ? (
        <ApiAccess order={order} />
      ) : deliveryText ? (
        <TextDelivery text={deliveryText} />
      ) : (
        <p className="text-[12.5px] text-muted">{t("orderSellerSla")}</p>
      )}

      {order.status === "delivered" && order.escrow_expires_at && (
        <InspectionPanel orderCode={order.order_code} escrowExpiresAt={order.escrow_expires_at} steps={inspectionSteps} />
      )}

      <div className="flex gap-2">
        {failed ? (
          <>
            <Button size="sm" block onClick={onRebuy} className="flex-1">{t("tryAgain")}</Button>
            <Link href="/wallet" className="flex-1"><Button variant="secondary" block size="sm">{t("checkWallet")}</Button></Link>
          </>
        ) : (
          <>
            <Link href="/orders" className="flex-1"><Button variant="secondary" block size="sm">{t("viewOrders")}</Button></Link>
            <Button variant="secondary" size="sm" onClick={onRebuy} className="flex-1">{t("buyMore")}</Button>
          </>
        )}
      </div>
    </div>
  );
}
