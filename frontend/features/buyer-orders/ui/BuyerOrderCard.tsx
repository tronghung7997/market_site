"use client";

import { memo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { displayOrderStatus, hasOpenDispute } from "@/lib/order-status";
import { daysAgo, formatDateTime } from "@/lib/utils";
import { useVariantTermFor } from "@/lib/variant-term";
import type { Order } from "@/lib/types";
import { Button, Tag } from "@/components/ui";
import { AlertTriangle, Eye, ShieldCheck, Star, Wallet } from "@/components/Icons";
import OrderChatButton from "@/components/chat/OrderChatButton";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { orderAccentTone, nameCarriesTerm } from "../model";
import { CopyIconButton, DeliveryShortcuts, rowActions, type OrderActionHandlers } from "./OrderRowActions";
import { DeadlineNote } from "./DeadlineNote";
import { SellerTierBadge } from "@/components/SellerTierBadge";

const ACCENT: Record<ReturnType<typeof orderAccentTone>, string> = {
  bad: "border-l-bad", iris: "border-l-iris", good: "border-l-good", neutral: "border-l-line", warn: "border-l-warn",
};

/** Mobile stacked record for one order (desktop uses the table). */
export const BuyerOrderCard = memo(function BuyerOrderCard({
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
  const a = rowActions(o, disputed);
  const money = formatOrderHistoryMoney(o.total_amount, o.display_fx_rate_snapshot, { locale });
  const canChat = o.capabilities?.can_chat ?? !["cancelled", "refunded"].includes(o.status);

  return (
    <article className={cn("rounded-xl border border-line border-l-4 bg-surface p-4 shadow-card", ACCENT[orderAccentTone(o, disputed)])}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => handlers.onOpen(o)}
            className="font-mono text-[14px] font-bold text-iris hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris rounded"
          >
            {o.order_code}
          </button>
          <CopyIconButton text={o.order_code} title={t("copyOrderCode")} className="h-7 w-7" size={13} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="whitespace-nowrap text-[11.5px] text-muted" title={formatDateTime(o.created_at, locale)}>
            {daysAgo(o.created_at, locale)}
          </span>
          <Tag tone={st.tone}>{st.label}</Tag>
        </div>
      </div>

      <button type="button" onClick={() => handlers.onOpen(o)} className="mt-3 flex w-full items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris rounded-lg">
        <ProductCover coverId={parseCoverId(o)} title={o.product_title ?? "??"} className="mt-0.5 h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[13.5px] font-semibold leading-snug text-fg">
            {o.product_title ?? tc("orderNumber", { id: o.order_code })}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
            {o.variant_name && <span className="break-all">{nameCarriesTerm(o.variant_name, termFor(o.service_type).term) ? o.variant_name : t("packageNamed", { name: o.variant_name, ...termFor(o.service_type) })}</span>}
            <span className="font-mono font-medium text-fg">{tc("qty", { count: o.quantity })}</span>
          </div>
        </div>
      </button>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-muted">{tb("seller")}</dt>
        <dd className="min-w-0 flex items-center gap-2">
          {o.seller_name ? (
            o.seller_path
              ? <Link href={o.seller_path} className="min-w-0 truncate font-medium text-fg hover:text-iris">{o.seller_name}</Link>
              : <span className="min-w-0 truncate font-medium text-fg">{o.seller_name}</span>
          ) : <span className="text-faint">&mdash;</span>}
          {o.seller_name && <SellerTierBadge tier={o.seller_badge_tier} image={o.seller_tier_badge} size="xs" />}
          {canChat && (
            <OrderChatButton orderId={o.id} appearance="link" label={tb("chat")} iconSize={11} className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-iris hover:underline disabled:opacity-60" />
          )}
        </dd>
        <dt className="text-muted">{t("payment")}</dt>
        <dd className="font-mono text-[14px] font-bold tabular text-fg">{money.text}</dd>
      </dl>

      <DeadlineNote order={o} disputed={disputed} variant="card" />
      {st.hint && !disputed && (
        <p className={cn("mt-2 text-[11.5px]", a.canConfirm ? "font-medium text-warn" : "text-muted")}>{st.hint}</p>
      )}
      {disputed && (
        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-bad/25 bg-bad-soft/40 px-2.5 py-1 text-[11.5px] font-medium text-bad">
          <span className="flex items-center gap-1.5"><AlertTriangle size={13} className="shrink-0" /> {t("tabDisputed")}</span>
          <button type="button" onClick={() => handlers.onOpen(o)} className="font-semibold underline">{tb("viewDispute")}</button>
        </div>
      )}

      {/* One next step, full width; everything else is a quieter second row. */}
      <div className="mt-3 space-y-2">
        {a.canConfirm ? (
          <Button size="sm" block disabled={confirming} onClick={() => handlers.onConfirm(o)} className="min-h-[40px] gap-1.5">
            <ShieldCheck size={14} /> {confirming ? t("confirming") : t("confirmReceived")}
          </Button>
        ) : a.canReview ? (
          <Button size="sm" block onClick={() => handlers.onOpen(o, { tab: "review" })} className="min-h-[40px] gap-1.5">
            <Star size={13} /> {t("review")}
          </Button>
        ) : a.refundHref ? (
          <Link href={a.refundHref} className="block">
            <Button size="sm" block variant="secondary" className="min-h-[40px] gap-1.5"><Wallet size={13} /> {tb("viewRefund")}</Button>
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => handlers.onOpen(o)} className="min-h-[38px] gap-1.5">
            <Eye size={14} /> {a.hasData ? t("viewOrderDetails") : tb("detail")}
          </Button>
          {a.hasData && <DeliveryShortcuts order={o} />}
          {a.canDispute && (
            <Button size="sm" variant="ghost" onClick={() => handlers.onDispute(o)} className="ml-auto min-h-[38px] gap-1.5 text-muted hover:text-bad">
              <AlertTriangle size={13} /> {t("openDispute")}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
});
