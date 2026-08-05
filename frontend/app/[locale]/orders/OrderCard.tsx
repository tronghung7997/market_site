"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { vnd } from "@/lib/api";
import { orderStatus } from "@/lib/order-status";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { Order } from "@/lib/types";
import ServiceDashboard from "@/components/ServiceDashboard";
import { StatusTimeline, OrderResources, OrderDispute } from "@/components/orders/OrderCardPrimitives";
import { Button, Card, CopyButton, Disclosure, Monogram, Tag } from "@/components/ui";
import { Shield, Star } from "@/components/Icons";
import OrderProxyPanel from "./OrderProxyPanel";
import ReviewForm from "./ReviewForm";

export { TerminalOrderRow } from "@/components/orders/OrderCardPrimitives";

export default function OrderCard({
  order: o, confirming, plateHidden, reviewOpen, reviewDone,
  onConfirm, onOpenDispute, onOpenReview, onReviewDone, onCloseReview, onDelivered, onPlate,
}: {
  order: Order;
  confirming: boolean;
  plateHidden: boolean;
  reviewOpen: boolean;
  reviewDone: boolean;
  onConfirm: (orderId: number) => void;
  onOpenDispute: (orderId: number) => void;
  onOpenReview: (orderId: number) => void;
  onReviewDone: (orderId: number, ok: boolean, message: string) => void;
  onCloseReview: () => void;
  onDelivered: (orderId: number, deliveredData: string) => void;
  onPlate: (orderId: number) => void;
}) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const locale = useLocale();
  const st = orderStatus(o.status, locale);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [askConfirm, setAskConfirm] = useState(false);
  const delivered = o.status === "delivered" || o.status === "completed";
  const deliveredData = locale === "en" ? o.delivered_data?.replace(/^Gọi qua:/gm, "Call URL:") : o.delivered_data;

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-raised/50 border-b border-line">
        <span className="font-mono text-[13px] font-semibold">#{o.id}</span>
        <span className="text-[11.5px] text-faint">{formatDateTime(o.created_at, locale)}</span>
        <div className="ml-auto flex items-center gap-2.5">
          <Tag tone={st.tone}>{st.label}</Tag>
          <span className="font-mono text-[14px] font-semibold tabular">{vnd(o.total_amount, locale)}</span>
        </div>
      </div>

      <div className="px-4 pb-4 pt-3">
        <div className="flex items-center gap-3 min-w-0">
          <Monogram text={o.product_title ?? "??"} />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-[14px] truncate">{o.product_title ?? tc("orderNumber", { id: o.id })}</div>
            <div className="text-[12px] text-muted truncate">
              {o.variant_name ? `${o.variant_name} · ` : ""}{tc("qty", { count: o.quantity })}
            </div>
          </div>
          {o.escrow_expires_at && o.status === "delivered" && (
            <div className="text-[11px] text-faint flex items-center gap-1 shrink-0">
              <Shield size={11} className="text-good" /> {t("escrowUntil", { date: formatDate(o.escrow_expires_at, locale) })}
            </div>
          )}
        </div>

        {st.hint && <p className="text-[12px] text-muted mt-2.5">{st.hint}</p>}

        {o.has_dispute && <OrderDispute orderId={o.id} />}

        {!["disputed", "refunded", "cancelled"].includes(o.status) && (
          <div className="mt-3 rounded-lg bg-raised/60 border border-line/70">
            <StatusTimeline status={o.status} />
          </div>
        )}

        {o.delivered_data && !plateHidden && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10.5px] text-faint uppercase tracking-wider">{t("deliveredData")}</span>
              <CopyButton text={o.delivered_data} />
            </div>
            <pre className="font-mono text-[12px] bg-raised border border-line rounded-lg p-2.5 whitespace-pre-wrap break-all">{deliveredData}</pre>
          </div>
        )}

        {delivered && (
          <OrderProxyPanel
            orderId={o.id}
            deliveredData={o.delivered_data}
            onPlate={onPlate}
            onDelivered={onDelivered}
          />
        )}

        {o.status === "delivered" && (
          askConfirm ? (
            <div className="mt-3.5 rounded-lg border border-warn/30 bg-warn-soft p-3">
              <p className="text-[13px] font-semibold">{t("confirmReleaseTitle", { amount: vnd(o.total_amount, locale) })}</p>
              <p className="mt-0.5 text-[11.5px] text-muted">{t("confirmReleaseBody")}</p>
              <div className="flex gap-2 mt-2.5">
                <Button size="sm" onClick={() => onConfirm(o.id)} disabled={confirming}>
                  {confirming ? t("confirming") : t("confirmReleaseYes")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setAskConfirm(false)} disabled={confirming}>
                  {t("confirmReleaseMore")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 mt-3.5">
              <Button size="sm" onClick={() => setAskConfirm(true)}>{t("confirmReceived")}</Button>
              <Button size="sm" variant="danger" onClick={() => onOpenDispute(o.id)}>{t("openDispute")}</Button>
            </div>
          )
        )}

        {o.status === "completed" && !reviewDone && !reviewOpen && (
          <div className="mt-3.5">
            <Button size="sm" variant="secondary" onClick={() => onOpenReview(o.id)}>
              <Star size={13} /> {t("review")}
            </Button>
          </div>
        )}
        {o.status === "completed" && reviewDone && (
          <p className="flex items-center gap-1.5 text-[12px] mt-2.5 text-good font-medium">
            <Star size={12} className="fill-good" /> {t("reviewed")}
          </p>
        )}
        {reviewOpen && (
          <ReviewForm
            orderId={o.id}
            onDone={(ok, message) => onReviewDone(o.id, ok, message)}
            onCancel={onCloseReview}
          />
        )}

        {delivered && (
          <Disclosure
            label={t("showDashboard")} labelOpen={t("hideDashboard")}
            open={dashboardOpen}
            onToggle={() => setDashboardOpen((v) => !v)}
          >
            <ServiceDashboard orderId={o.id} />
          </Disclosure>
        )}
        {delivered && <OrderResources orderId={o.id} />}
      </div>
    </Card>
  );
}
