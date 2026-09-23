"use client";

import { memo, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { displayOrderStatus, hasOpenDispute } from "@/lib/order-status";
import { formatDate, formatDateTime } from "@/lib/utils";
import { useVariantTermFor } from "@/lib/variant-term";
import type { Order } from "@/lib/types";
import { Tag } from "@/components/ui";
import { ChevronDown, ChevronUp, Inbox, ShieldCheck } from "@/components/Icons";
import OrderChatButton from "@/components/chat/OrderChatButton";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { productPath } from "@/lib/routes";
import type { BuyerOrderSort } from "../model";
import { CopyIconButton, DesktopRowActions, type OrderActionHandlers } from "./OrderRowActions";

function SortHeader({
  label, asc, desc, sort, onSort, className,
}: {
  label: string; asc: BuyerOrderSort; desc: BuyerOrderSort; sort: BuyerOrderSort;
  onSort: (next: BuyerOrderSort) => void; className?: string;
}) {
  const active = sort === asc || sort === desc;
  const Icon = sort === asc ? ChevronUp : ChevronDown;
  return (
    <th className={cn("px-3 py-3", className)} aria-sort={sort === asc ? "ascending" : sort === desc ? "descending" : "none"}>
      <button
        type="button"
        onClick={() => onSort(sort === desc ? asc : desc)}
        className={cn("inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris", active && "text-fg")}
      >
        {label}
        <Icon size={12} className={cn(!active && "opacity-40")} />
      </button>
    </th>
  );
}

/** Product link when the API sent public URL parts; otherwise plain text
 *  (the product may have been deleted). */
export function productHref(order: Order): string | null {
  if (!order.product_key) return null;
  return productPath({ public_key: order.product_key, slug: order.product_slug ?? null });
}

const OrderRow = memo(function OrderRow({
  order: o, confirming, handlers,
}: { order: Order; confirming: boolean; handlers: OrderActionHandlers }) {
  const t = useTranslations("orders");
  const tb = useTranslations("buyerOrders");
  const tc = useTranslations("common");
  const termFor = useVariantTermFor();
  const locale = useLocale();
  const { formatOrderHistoryMoney } = useMoney();
  const st = displayOrderStatus(o, locale);
  const disputed = hasOpenDispute(o);
  const money = formatOrderHistoryMoney(o.total_amount, o.display_fx_rate_snapshot, { locale });
  const awaiting = o.capabilities ? o.capabilities.can_confirm : o.status === "delivered" && !disputed;
  const href = productHref(o);
  const canChat = o.capabilities?.can_chat ?? !["cancelled", "refunded"].includes(o.status);

  return (
    <tr className={cn("transition-colors hover:bg-raised/40", awaiting && "bg-warn-soft/10", disputed && "bg-bad-soft/10")}>
      <td className="px-3 py-3 align-top">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handlers.onOpen(o)}
            className="whitespace-nowrap font-mono text-[12.5px] font-bold text-fg hover:text-iris focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris rounded"
          >
            #{o.order_code}
          </button>
          <CopyIconButton text={o.order_code} title={t("copyOrderCode")} className="h-6 w-6" size={12} />
        </div>
        <div className="mt-0.5 whitespace-nowrap text-[10.5px] text-faint" title={o.created_at}>
          {formatDateTime(o.created_at, locale)}
        </div>
      </td>

      <td className="px-3 py-3 align-top">
        <div className="flex items-start gap-2.5">
          <ProductCover coverId={parseCoverId(o)} title={o.product_title || "??"} className="mt-0.5 h-8 w-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => handlers.onOpen(o)}
              className="block max-w-full truncate text-left text-[13px] font-semibold leading-snug text-fg hover:text-iris focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris rounded"
              title={o.product_title || ""}
            >
              {o.product_title || tc("orderNumber", { id: o.order_code })}
            </button>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
              <span className="shrink-0 rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-fg">
                x{o.quantity.toLocaleString()}
              </span>
              {o.variant_name && (
                <span className="min-w-0 truncate" title={o.variant_name}>
                  {t("packageNamed", { name: o.variant_name, ...termFor(o.service_type) })}
                </span>
              )}
              {href && (
                <Link href={href} className="shrink-0 text-iris hover:underline" onClick={(e) => e.stopPropagation()}>
                  {tb("viewProduct")}
                </Link>
              )}
            </div>
          </div>
        </div>
      </td>

      <td className="px-3 py-3 align-top">
        {o.seller_name ? (
          o.seller_path ? (
            <Link href={o.seller_path} className="block truncate text-[12px] font-medium text-fg hover:text-iris" title={o.seller_name}>
              {o.seller_name}
            </Link>
          ) : (
            <div className="truncate text-[12px] font-medium text-fg" title={o.seller_name}>{o.seller_name}</div>
          )
        ) : (
          <span className="text-[12px] text-faint">&mdash;</span>
        )}
        {canChat && (
          <div className="mt-1">
            <OrderChatButton
              orderId={o.id}
              appearance="link"
              label={tb("chat")}
              iconSize={11}
              className="inline-flex items-center gap-0.5 text-[11px] text-iris hover:underline disabled:opacity-60"
            />
          </div>
        )}
      </td>

      <td className="px-3 py-3 text-right align-top font-mono text-[13px] font-bold tabular text-fg whitespace-nowrap">
        {money.text}
      </td>

      <td className="px-3 py-3 align-top">
        <Tag tone={st.tone}>{st.label}</Tag>
        {o.status === "delivered" && !disputed && o.escrow_expires_at && (
          <p className="mt-1 flex items-center gap-1 text-[10.5px] text-muted">
            <ShieldCheck size={11} className="shrink-0 text-good" />
            <span className="min-w-0 truncate">{t("escrowUntil", { date: formatDate(o.escrow_expires_at, locale) })}</span>
          </p>
        )}
        {st.hint && (
          <p className={cn("mt-1 line-clamp-2 text-[10.5px] leading-snug", awaiting ? "font-medium text-warn" : "text-faint")} title={st.hint}>{st.hint}</p>
        )}
      </td>

      <td className="px-3 py-3 align-top">
        <DesktopRowActions order={o} disputed={disputed} confirming={confirming} handlers={handlers} />
      </td>
    </tr>
  );
});

export function BuyerOrdersTable({
  orders,
  sort,
  onSort,
  confirmingId,
  handlers,
  emptyTitle,
  emptyHint,
  emptyAction,
}: {
  orders: Order[];
  sort: BuyerOrderSort;
  onSort: (next: BuyerOrderSort) => void;
  confirmingId: number | null;
  handlers: OrderActionHandlers;
  emptyTitle: string;
  emptyHint?: string;
  emptyAction?: ReactNode;
}) {
  const t = useTranslations("orders");
  const tb = useTranslations("buyerOrders");

  if (orders.length === 0) {
    return (
      <div className="space-y-2 px-4 py-12 text-center">
        <Inbox size={36} className="mx-auto text-faint" />
        <p className="text-[13.5px] font-medium text-fg">{emptyTitle}</p>
        {emptyHint && <p className="text-xs text-muted">{emptyHint}</p>}
        {emptyAction}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      {/* Fixed layout: the product column takes whatever is left and every cell
          truncates inside its own column, so long variant names or an English
          label can never push the actions off the card. */}
      <table className="w-full min-w-[880px] table-fixed border-collapse text-left text-xs">
        <colgroup>
          <col className="w-[10.5rem]" />
          <col />
          <col className="w-[9.5rem]" />
          <col className="w-[7.5rem]" />
          <col className="w-[12rem]" />
          <col className="w-[11rem]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line bg-raised/40 text-[11px] font-semibold uppercase tracking-wide text-faint">
            <SortHeader label={t("orderCode")} asc="oldest" desc="newest" sort={sort} onSort={onSort} className="whitespace-nowrap" />
            <th className="px-3 py-3">{t("productPackage")}</th>
            <th className="px-3 py-3">{tb("seller")}</th>
            <SortHeader label={t("payment")} asc="amount_asc" desc="amount_desc" sort={sort} onSort={onSort} className="whitespace-nowrap text-right" />
            <th className="px-3 py-3 whitespace-nowrap">{t("statusEscrow")}</th>
            <th className="px-3 py-3 text-right">{tb("actions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line text-[12.5px]">
          {orders.map((o) => (
            <OrderRow key={o.id} order={o} confirming={confirmingId === o.id} handlers={handlers} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
