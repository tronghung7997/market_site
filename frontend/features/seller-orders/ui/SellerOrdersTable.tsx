"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { displayOrderStatus } from "@/lib/order-status";
import { formatDate } from "@/lib/utils";
import type { Order, SellerOrderSort } from "@/lib/types";
import { Button, CopyButton, Tag } from "@/components/ui";
import { AlertCircle, Check, ChevronDown, ChevronRight, ChevronUp, Inbox, Package } from "@/components/Icons";
import OrderChatButton from "@/components/chat/OrderChatButton";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { closedDisputeStatus, isOrderDisputed } from "../model";
import { sellerOrderDeadline, timeLeft } from "../deadline";
import { FulfillmentKindTag } from "./FulfillmentKindTag";
import { distinctTokens } from "@/lib/name-tokens";

function SortHeader({
  label, asc, desc, sort, onSort, className,
}: {
  label: string; asc: SellerOrderSort; desc: SellerOrderSort; sort: SellerOrderSort;
  onSort: (next: SellerOrderSort) => void; className?: string;
}) {
  const active = sort === asc || sort === desc;
  const Icon = sort === asc ? ChevronUp : ChevronDown;
  return (
    <th className={cn("px-3 py-3", className)} aria-sort={sort === asc ? "ascending" : sort === desc ? "descending" : "none"}>
      <button
        type="button"
        onClick={() => onSort(sort === desc ? asc : desc)}
        className={cn("inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-fg", active && "text-fg")}
      >
        {label}
        <Icon size={12} className={cn(!active && "opacity-40")} />
      </button>
    </th>
  );
}

export function SellerOrdersTable({
  orders,
  sort,
  onSort,
  actingOrderId,
  onAccept,
  onDeliver,
  onDispute,
  emptyAction,
  empty = "filtered",
}: {
  orders: Order[];
  sort: SellerOrderSort;
  onSort: (next: SellerOrderSort) => void;
  actingOrderId: number | null;
  onAccept: (order: Order) => void;
  onDeliver: (order: Order) => void;
  onDispute: (order: Order) => void;
  emptyAction?: React.ReactNode;
  /** "none": the shop has no orders at all; "filtered": none match the filters. */
  empty?: "none" | "filtered";
}) {
  const t = useTranslations("seller");
  const to = useTranslations("sellerOrders");
  const td = useTranslations("status.dispute");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();

  if (orders.length === 0) {
    return (
      <div className="space-y-2 px-4 py-12 text-center">
        <Inbox size={36} className="mx-auto text-faint" />
        <p className="text-[13.5px] font-medium text-fg">{empty === "none" ? t("noOrdersYet") : t("noMatchingOrders")}</p>
        <p className="text-xs text-muted">{empty === "none" ? t("noOrdersYetHint") : t("ordersNoMatchHint")}</p>
        {emptyAction}
      </div>
    );
  }

  const now = Date.now();

  /** Status tag plus what happens next and by when. */
  const statusBlock = (o: Order) => {
    const isDisputed = isOrderDisputed(o);
    const closedStatus = closedDisputeStatus(o);
    const st = displayOrderStatus(o, locale, "seller");
    const awaiting = isDisputed && Boolean(o.dispute_awaiting_seller);
    const deadline = isDisputed ? null : sellerOrderDeadline(o, now);
    const left = deadline ? timeLeft(deadline.at, now) : null;
    return (
      <>
        <Tag tone={st.tone}>{st.label}</Tag>
        {isDisputed && (
          <p className={cn("mt-1 truncate text-[10.5px]", awaiting ? "font-semibold text-bad" : "text-muted")}>
            {awaiting ? t("awaitingResponse") : t("responded")}
          </p>
        )}
        {closedStatus && (
          <p className="mt-1 truncate text-[10.5px] text-muted">
            {td.has(closedStatus as "open") ? td(closedStatus as "open") : closedStatus}
          </p>
        )}
        {deadline?.kind === "deliver" && (
          <p className={cn("mt-1 text-[10.5px]", deadline.overdue ? "font-semibold text-bad" : "font-medium text-warn")}>
            {deadline.overdue
              ? to("deadlineOverdue", { date: formatDate(deadline.at.toISOString(), locale) })
              : to("deadlineDeliver", { left: to(`left.${left!.unit}`, { count: left!.value }) })}
          </p>
        )}
        {deadline?.kind === "payout" && (
          <p className="mt-1 truncate text-[10.5px] text-faint">
            {to("deadlinePayout", { date: formatDate(deadline.at.toISOString(), locale) })}
          </p>
        )}
      </>
    );
  };

  /** The one next step for the order, then its detail page. */
  const actions = (o: Order) => {
    const isDisputed = isOrderDisputed(o);
    const closedStatus = closedDisputeStatus(o);
    const awaiting = isDisputed && Boolean(o.dispute_awaiting_seller);
    return (
      <>
        {isDisputed && (
          <Button size="sm" variant={awaiting ? "danger" : "secondary"} onClick={() => onDispute(o)} className="h-8 justify-center gap-1 whitespace-nowrap text-[11.5px]">
            <AlertCircle size={12} /> {awaiting ? t("handleDispute") : t("viewDisputeResponse")}
          </Button>
        )}
        {!isDisputed && closedStatus && (
          <Button size="sm" variant="secondary" onClick={() => onDispute(o)} className="h-8 justify-center gap-1 whitespace-nowrap text-[11.5px]">
            <AlertCircle size={12} /> {t("viewDisputeHistory")}
          </Button>
        )}
        {o.status === "pending" && (
          <Button size="sm" disabled={actingOrderId === o.id} onClick={() => onAccept(o)} className="h-8 justify-center gap-1 whitespace-nowrap text-[11.5px]">
            <Check size={12} /> {actingOrderId === o.id ? t("accepting") : t("acceptOrder")}
          </Button>
        )}
        {o.status === "processing" && (
          <Button size="sm" onClick={() => onDeliver(o)} className="h-8 justify-center gap-1 whitespace-nowrap text-[11.5px]">
            <Package size={12} /> {t("deliverNow")}
          </Button>
        )}
        <Link
          href={`/seller/orders/${o.order_code}`}
          className="inline-flex h-8 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2 text-[11.5px] text-muted hover:bg-surface hover:text-fg"
        >
          {t("orderDetail")} <ChevronRight size={12} />
        </Link>
      </>
    );
  };

  const money = (o: Order) => (
    <>
      {formatBrowseMoney(o.total_amount, { locale })}
      {o.settlement?.status === "refunded" && <div className="text-[10.5px] font-medium text-bad">{to("refundedMark")}</div>}
    </>
  );

  return (
    <>
      {/* Phones: one stacked record per order — status, amount and the next
          step stay on screen instead of in a sideways-scrolling table. */}
      <ul className="divide-y divide-line md:hidden">
        {orders.map((o) => {
          const awaiting = isOrderDisputed(o) && Boolean(o.dispute_awaiting_seller);
          return (
            <li key={o.id} className={cn("space-y-2.5 px-4 py-3.5", awaiting && "bg-bad-soft/10")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/seller/orders/${o.order_code}`} className="font-mono text-[12.5px] font-bold text-fg hover:text-iris">
                    {o.order_code}
                  </Link>
                  <p className="text-[11px] text-faint">{formatDate(o.created_at, locale)}</p>
                </div>
                <div className="shrink-0 text-right font-mono text-[13.5px] font-bold tabular text-fg">{money(o)}</div>
              </div>
              <div className="flex items-start gap-2.5">
                <ProductCover coverId={parseCoverId(o)} title={o.product_title || "??"} className="mt-0.5 h-8 w-8 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-fg">{o.product_title || t("orderNumber", { id: o.order_code })}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    {distinctTokens(o.variant_name, o.product_title).map((token) => (
                      <span key={token} className="rounded bg-iris-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-iris-hi">{token}</span>
                    ))}
                    <span className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-fg">x{o.quantity.toLocaleString(locale)}</span>
                    {o.fulfillment && <FulfillmentKindTag kind={o.fulfillment.kind} />}
                  </div>
                  {o.buyer_email && <p className="mt-1 truncate font-mono text-[11px] text-faint">{o.buyer_email}</p>}
                </div>
              </div>
              <div>{statusBlock(o)}</div>
              <div className="flex flex-wrap items-center gap-2">
                {actions(o)}
                {o.buyer_email && (
                  <OrderChatButton
                    orderId={o.id}
                    appearance="link"
                    label={t("chat")}
                    iconSize={11}
                    className="inline-flex h-8 items-center gap-0.5 px-1 text-[11.5px] text-iris hover:underline disabled:opacity-60"
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[960px] table-fixed border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-raised/40 text-[11px] font-semibold uppercase tracking-wide text-faint">
              <SortHeader label={t("orderCode")} asc="oldest" desc="newest" sort={sort} onSort={onSort} className="w-[8.5rem] whitespace-nowrap" />
              <th className="px-3 py-3">{t("productAndVariant")}</th>
              <th className="w-[13rem] px-3 py-3">{t("customer")}</th>
              <SortHeader label={t("amount")} asc="amount_asc" desc="amount_desc" sort={sort} onSort={onSort} className="w-[7rem] text-right" />
              <th className="w-[12rem] px-3 py-3 whitespace-nowrap">{to("colStatusDeadline")}</th>
              <th className="w-[10.5rem] px-3 py-3 text-right">{to("colNextStep")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-[12.5px]">
            {orders.map((o) => {
              const awaiting = isOrderDisputed(o) && Boolean(o.dispute_awaiting_seller);
              return (
                <tr key={o.id} className={cn("transition-colors hover:bg-raised/40", awaiting && "bg-bad-soft/10")}>
                  <td className="px-3 py-3 align-top">
                    <Link href={`/seller/orders/${o.order_code}`} className="whitespace-nowrap font-mono text-[12.5px] font-bold text-fg hover:text-iris">
                      {o.order_code}
                    </Link>
                    <div className="mt-0.5 whitespace-nowrap text-[10.5px] text-faint" title={o.created_at}>
                      {formatDate(o.created_at, locale)}
                    </div>
                  </td>

                  <td className="px-3 py-3 align-top">
                    <div className="flex items-start gap-2.5">
                      <ProductCover coverId={parseCoverId(o)} title={o.product_title || "??"} className="mt-0.5 h-8 w-8 shrink-0 rounded-lg" />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/seller/orders/${o.order_code}`}
                          className="line-clamp-2 break-words text-[13px] font-semibold leading-snug text-fg hover:text-iris"
                          title={o.product_title || ""}
                        >
                          {o.product_title || t("orderNumber", { id: o.order_code })}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                          {distinctTokens(o.variant_name, o.product_title).map((token) => (
                            <span key={token} className="rounded bg-iris-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-iris-hi">{token}</span>
                          ))}
                          <span className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-fg">
                            x{o.quantity.toLocaleString(locale)}
                          </span>
                          {o.fulfillment && <FulfillmentKindTag kind={o.fulfillment.kind} />}
                          {o.task_progress && o.task_progress.total > 0 && (
                            <span className="font-mono text-[10.5px] text-faint">
                              {to("taskProgress", { done: o.task_progress.completed, total: o.task_progress.total })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-3 align-top">
                    <div className="truncate font-mono text-[12px] text-muted" title={o.buyer_email || ""}>
                      {o.buyer_email || <span className="text-faint">&mdash;</span>}
                    </div>
                    {o.buyer_email && (
                      <div className="mt-1 flex items-center gap-2">
                        <OrderChatButton
                          orderId={o.id}
                          appearance="link"
                          label={t("chat")}
                          iconSize={11}
                          className="inline-flex items-center gap-0.5 text-[11px] text-iris hover:underline disabled:opacity-60"
                        />
                      </div>
                    )}
                  </td>

                  <td className="px-3 py-3 text-right align-top font-mono text-[13px] font-bold tabular text-fg whitespace-nowrap">
                    {money(o)}
                  </td>

                  <td className="px-3 py-3 align-top">{statusBlock(o)}</td>

                  <td className="px-3 py-3 align-top">
                    <div className="flex flex-col items-stretch gap-1">{actions(o)}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
