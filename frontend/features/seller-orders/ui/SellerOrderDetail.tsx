"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useVariantTerm } from "@/lib/variant-term";
import { useMoney } from "@/lib/money";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { displayOrderStatus } from "@/lib/order-status";
import { formatDate, formatDateTime } from "@/lib/utils";
import { deliveryResourceMarks, isDisputeReadyToAccept } from "@/lib/dispute-case";
import type { Order } from "@/lib/types";
import { Button, Card, CopyButton, Spinner, Tag } from "@/components/ui";
import { AlertCircle, Check, ChevronLeft, Download, Edit2, Package, Rows } from "@/components/Icons";
import { StatusTimeline } from "@/components/orders/OrderCardPrimitives";
import { DisputeCaseView } from "@/components/orders/DisputeCaseView";
import { DeliveryAccountBadge } from "@/components/orders/DeliveryAccountBadge";
import OrderChatButton from "@/components/chat/OrderChatButton";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { closedDisputeStatus, isOrderDisputed, splitDeliveryLines } from "../model";
import { useAcceptOrder, useSellerDispute, useSellerOrder, useSellerOrderResources } from "../useSellerOrders";
import { SellerDeliverDialog } from "./SellerDeliverDialog";
import { SellerDisputeDialog } from "./SellerDisputeDialog";
import { FulfillmentKindTag } from "./FulfillmentKindTag";

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function SellerOrderDetailSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true">
      <div className="h-5 w-40 rounded bg-raised" />
      <div className="h-24 rounded-xl border border-line bg-raised" />
      <div className="h-20 rounded-xl border border-line bg-raised" />
      <div className="h-48 rounded-xl border border-line bg-raised" />
    </div>
  );
}

export function SellerOrderDetail({
  orderId,
  highlightResourceIds = [],
}: {
  orderId: number;
  highlightResourceIds?: number[];
}) {
  const t = useTranslations("seller");
  const to = useTranslations("sellerOrders");
  const td = useTranslations("status.dispute");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const orderQuery = useSellerOrder(orderId);
  const order = orderQuery.data;
  const term = useVariantTerm(order?.service_type);
  const wantsDispute = Boolean(order && (order.has_dispute || order.dispute_status || order.status === "disputed"));
  const disputeQuery = useSellerDispute(orderId, wantsDispute);
  const resourcesQuery = useSellerOrderResources(orderId);
  const accept = useAcceptOrder();
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (orderQuery.isPending) return <SellerOrderDetailSkeleton />;
  if (orderQuery.isError || !order) {
    return (
      <Card className="p-10 text-center">
        <AlertCircle size={32} className="mx-auto mb-2 text-bad" />
        <p className="mb-1 text-[13.5px] font-medium text-fg">{to("detailLoadFailed")}</p>
        <p className="mb-4 text-[12.5px] text-muted">{orderQuery.error ? apiErrorMessage(orderQuery.error) : ""}</p>
        <div className="flex justify-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => void orderQuery.refetch()}>{to("retry")}</Button>
          <Link href="/seller/orders"><Button size="sm" variant="ghost">{to("backToOrders")}</Button></Link>
        </div>
      </Card>
    );
  }

  const caseRecord = disputeQuery.data ?? null;
  const isOpenCase = isOrderDisputed(order, caseRecord);
  const closedStatus = closedDisputeStatus(order, caseRecord);
  const st = displayOrderStatus(isOpenCase ? { ...order, has_dispute: true, protection: { status: "dispute_open" } } : order, locale);
  const deliveredLines = order.delivered_data ? splitDeliveryLines(order.delivered_data) : [];
  const resources = resourcesQuery.data ?? [];
  const marks = deliveryResourceMarks(caseRecord);

  const handleAccept = async () => {
    setActionError(null);
    try {
      await accept.mutateAsync(order.id);
    } catch (err: unknown) {
      setActionError(apiErrorMessage(err, t("orderAcceptFailed")));
    }
  };

  return (
    <div className="space-y-4 animate-fade">
      <Link href="/seller/orders" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-fg">
        <ChevronLeft size={14} /> {to("backToOrders")}
      </Link>

      {/* Header */}
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <ProductCover coverId={parseCoverId(order)} title={order.product_title || "??"} className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone={st.tone}>{st.label}</Tag>
              {order.fulfillment && <FulfillmentKindTag kind={order.fulfillment.kind} />}
              <span className="font-mono text-xs font-semibold text-faint">{t("orderNumber", { id: order.id })}</span>
            </div>
            <h1 className="mt-0.5 truncate text-[15px] font-bold text-fg">{order.product_title}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {order.status === "pending" && (
            <Button size="sm" disabled={accept.isPending} onClick={handleAccept}>
              <Check size={13} /> {accept.isPending ? t("accepting") : t("acceptOrder")}
            </Button>
          )}
          {order.status === "processing" && (
            <Button size="sm" onClick={() => setDeliverOpen(true)}>
              <Package size={13} /> {t("deliverNow")}
            </Button>
          )}
          {(isOpenCase || closedStatus) && (
            <Button size="sm" variant={isOpenCase && order.dispute_awaiting_seller ? "danger" : "secondary"} onClick={() => setDisputeOpen(true)}>
              <AlertCircle size={13} /> {isOpenCase ? (order.dispute_awaiting_seller ? t("handleDispute") : t("viewDisputeResponse")) : t("viewDisputeHistory")}
            </Button>
          )}
          <OrderChatButton
            orderId={order.id}
            appearance="link"
            label={t("chatWithBuyer")}
            className="inline-flex items-center gap-1 text-xs font-medium text-iris hover:underline disabled:opacity-60"
          />
        </div>
      </Card>

      {actionError && (
        <div role="alert" className="rounded-lg border border-bad/20 bg-bad-soft p-2.5 text-xs font-medium text-bad">{actionError}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Facts */}
          <Card className="grid grid-cols-2 gap-3 p-4 text-[12px] sm:grid-cols-3">
            <div className="min-w-0">
              <span className="text-faint">{t("buyerLabel")}</span>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono font-medium text-fg">
                <span className="truncate" title={order.buyer_email || ""}>{order.buyer_email || "—"}</span>
                {order.buyer_email && <CopyButton text={order.buyer_email} label="" className="text-[10.5px]" />}
              </div>
            </div>
            <div>
              <span className="text-faint">{t("totalPayment")}</span>
              <div className="mt-0.5 font-mono font-bold text-fg">{formatBrowseMoney(order.total_amount)}</div>
            </div>
            <div>
              <span className="text-faint">{t("createdTime")}</span>
              <div className="mt-0.5 font-mono text-fg">{formatDateTime(order.created_at, locale)}</div>
            </div>
            <div className="min-w-0">
              <span className="text-faint">{t("variantAndQuantity", { ...term })}</span>
              <div className="mt-0.5 truncate font-medium text-fg">
                {order.variant_name || t("defaultVariant")} · x{order.quantity.toLocaleString()}
              </div>
            </div>
            {order.escrow_expires_at && (
              <div>
                <span className="text-faint">{t("escrowDuration")}</span>
                <div className="mt-0.5 font-medium text-iris-hi">{formatDateTime(order.escrow_expires_at, locale)}</div>
              </div>
            )}
            {order.cancel_reason && (
              <div className="col-span-2 sm:col-span-3">
                <span className="text-faint">{to("cancelReason")}</span>
                <div className="mt-0.5 text-fg">{order.cancel_reason}</div>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <span className="mb-1 block text-[12px] font-semibold text-muted">{t("orderProgress")}</span>
            <StatusTimeline status={order.status} />
          </Card>

          {order.status === "processing" && (
            <div className="flex items-center justify-between rounded-xl border border-warn/30 bg-warn-soft/30 p-3">
              <div>
                <div className="text-[13px] font-bold text-warn">{t("waitingDeliveryTitle")}</div>
                <div className="text-[11px] text-muted">{t("waitingDeliveryHint")}</div>
              </div>
              <Button size="sm" onClick={() => setDeliverOpen(true)}>{t("deliverNow")}</Button>
            </div>
          )}

          {order.delivered_data && (
            <Card className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-fg">{t("deliveredLines", { count: deliveredLines.length.toLocaleString() })}</span>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => downloadText(`order_${order.id}_delivered_data.txt`, order.delivered_data!)} className="h-7 gap-1 px-2 text-[11px]">
                    <Download size={11} /> {t("downloadTxt")}
                  </Button>
                  <CopyButton text={order.delivered_data} label={t("copyAll")} className="text-[11px]" />
                </div>
              </div>
              <div className="max-h-48 select-all overflow-y-auto whitespace-pre-wrap break-all rounded-xl border border-line bg-raised p-3 font-mono text-[11.5px] leading-relaxed text-fg">
                {deliveredLines.slice(0, 50).join("\n")}
                {deliveredLines.length > 50 && (
                  <p className="mt-2 font-sans text-[10.5px] italic text-faint">{t("moreDeliveredLines", { count: (deliveredLines.length - 50).toLocaleString() })}</p>
                )}
              </div>
            </Card>
          )}

          {resourcesQuery.isPending ? (
            <div className="py-4 text-center"><Spinner /></div>
          ) : resources.length > 0 && (
            <Card className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-muted">{t("allocatedResources", { count: resources.length.toLocaleString() })}</span>
                <Button size="sm" variant="secondary" onClick={() => downloadText(`order_${order.id}_resources.txt`, resources.map((r) => r.data).join("\n"))} className="h-7 gap-1 px-2 text-[11px]">
                  <Download size={11} /> {t("downloadAll")}
                </Button>
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {resources.map((r) => {
                  const mark = marks[r.id];
                  const highlighted = highlightResourceIds.includes(r.id);
                  const inactive = r.status === "error" || mark?.kind === "refunded" || mark?.kind === "replaced";
                  return (
                    <div key={r.id} className={cn(
                      "flex items-center justify-between gap-2 rounded-lg border p-2 font-mono text-[11px]",
                      highlighted ? "border-iris bg-iris-soft/40" : "border-line bg-raised",
                      inactive && "opacity-70",
                    )}>
                      <span className={cn("truncate", inactive && "text-muted line-through")}>{r.data}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <DeliveryAccountBadge mark={mark} highlighted={highlighted} formatRefund={formatBrowseMoney} />
                        {!mark && (
                          <Tag tone={r.status === "assigned" ? "good" : r.status === "error" ? "bad" : "neutral"} className="text-[9px]">
                            {t("availableStatus")}
                          </Tag>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {caseRecord && (
            <Card className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[13px] font-bold text-fg">{isOpenCase ? t("disputedOrderTitle") : t("disputeHistoryTitle")}</div>
                  <div className="text-[11px] text-muted">{isOpenCase ? t("disputedOrderHint") : t("closedDisputeHint")}</div>
                </div>
                <Button size="sm" variant={isOpenCase ? "danger" : "secondary"} onClick={() => setDisputeOpen(true)}>
                  {isOpenCase ? t("handleDispute") : t("viewDisputeHistory")}
                </Button>
              </div>
              <DisputeCaseView
                dispute={caseRecord}
                statusLabel={
                  isDisputeReadyToAccept(caseRecord)
                    ? td("awaiting_buyer_acceptance")
                    : td.has(caseRecord.status as "open") ? td(caseRecord.status as "open") : caseRecord.status
                }
                statusTone={isDisputeReadyToAccept(caseRecord) ? "iris" : isOpenCase ? "warn" : "neutral"}
                formatRefund={formatBrowseMoney}
                viewerRole="seller"
              />
            </Card>
          )}
        </div>

        {/* Side: product shortcuts (moved here from every list row) */}
        <div className="space-y-4">
          <Card className="space-y-2 p-4 text-[12.5px]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">{to("productShortcuts")}</div>
            {order.product_id ? (
              <>
                <Link href={`/seller/products/${order.product_id}`} className="flex items-center gap-2 text-fg hover:text-iris">
                  <Edit2 size={13} className="text-iris" /> {t("editProductShort")}
                </Link>
                <Link href={`/seller/inventory?product=${order.product_id}`} className="flex items-center gap-2 text-fg hover:text-iris">
                  <Rows size={13} className="text-iris" /> {t("manageInventory")}
                </Link>
                <Link href={`/seller/orders?product_id=${order.product_id}`} className="flex items-center gap-2 text-fg hover:text-iris">
                  <Package size={13} className="text-iris" /> {to("ordersOfProduct")}
                </Link>
              </>
            ) : (
              <p className="text-muted">{to("productUnavailable")}</p>
            )}
          </Card>
          {order.escrow_expires_at && order.status === "delivered" && !isOpenCase && (
            <Card className="p-4 text-[12px] text-muted">
              {t("escrowUntilShort", { date: formatDate(order.escrow_expires_at, locale) })}
            </Card>
          )}
        </div>
      </div>

      <SellerDeliverDialog order={deliverOpen ? order : null} onClose={() => setDeliverOpen(false)} />
      <SellerDisputeDialog order={disputeOpen ? order : null} onClose={() => setDisputeOpen(false)} />
    </div>
  );
}
