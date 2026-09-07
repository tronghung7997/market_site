"use client";

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { queryKeys } from "@/lib/query-keys";
import { orderStatus } from "@/lib/order-status";
import { fulfillmentFromStrategy } from "@/lib/fulfillment";
import type { Order } from "@/lib/types";
import { Button, CopyButton, Tag } from "@/components/ui";
import { Check, Clock, X } from "@/components/Icons";

const ORDER_POLL_MS = 3000;
const ORDER_POLL_TIMEOUT_MS = 15 * 60 * 1000;

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

export default function OrderResult({ order: initial, onRebuy, fulfillment }: { order: Order; onRebuy: () => void; fulfillment?: string | null }) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { formatOrderHistoryMoney } = useMoney();
  const viaProvider = initial.product_id != null;
  const kind = fulfillmentFromStrategy(fulfillment).kind;
  const order = useOrderPolling(initial, viaProvider);
  const amountText = formatOrderHistoryMoney(
    order.total_amount,
    order.display_fx_rate_snapshot,
    { locale },
  ).text;
  const deliveryText = order.gateway_access
    ? `${t("gatewayKey")}: ${order.gateway_access.key}\n${t("gatewayCallUrl")}: ${order.gateway_access.url}`
    : order.delivered_data;

  const pending = order.status === "pending";
  const failed = order.status === "cancelled" || order.status === "refunded";
  const working = pending && viaProvider;
  const elapsed = useElapsed(order.created_at, working);
  const st = orderStatus(order.status, locale);

  return (
    <div className="space-y-4">
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
          <div className="text-[13.5px] font-medium">{tc("orderNumber", { id: order.id })}</div>
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
          <p className="text-[12.5px] text-muted">{t("orderSellerSla")}</p>
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
      ) : deliveryText ? (
        <div className="animate-rise">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-faint uppercase tracking-wider">{t("orderHandoffInfo")}</span>
            <CopyButton text={deliveryText} label={tc("copy")} copiedLabel={tc("copied")} />
          </div>
          <pre className="font-mono text-[12px] bg-raised border border-line rounded-lg p-3 whitespace-pre-wrap break-all">{deliveryText}</pre>
        </div>
      ) : (
        <p className="text-[12.5px] text-muted">{t("orderSellerSla")}</p>
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
