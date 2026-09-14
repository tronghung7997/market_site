"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money";
import { isDisputeReadyToAccept, resourceLabelMap, summarizeDisputeCase } from "@/lib/dispute-case";
import type { Order } from "@/lib/types";
import { Button, Spinner, Textarea } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AlertCircle, AlertTriangle, RefreshCw } from "@/components/Icons";
import { DisputeCaseView } from "@/components/orders/DisputeCaseView";
import { SellerDisputeRemedyPanel } from "@/components/seller/SellerDisputeRemedyPanel";
import OrderChatButton from "@/components/chat/OrderChatButton";
import MarketplaceChatButton from "@/components/chat/MarketplaceChatButton";
import { useInvalidateSellerOrders, useSellerDispute } from "../useSellerOrders";

/** Open dispute: claim timeline + reply form + per-account remedies.
 *  Closed dispute: read-only history. */
export function SellerDisputeDialog({ order, onClose }: { order: Order | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(order)} onOpenChange={(open) => { if (!open) onClose(); }}>
      {order && <DisputeBody key={order.id} order={order} onClose={onClose} />}
    </Dialog>
  );
}

function DisputeBody({ order, onClose }: { order: Order; onClose: () => void }) {
  const t = useTranslations("seller");
  const td = useTranslations("status.dispute");
  const apiErrorMessage = useApiErrorMessage();
  const { formatBrowseMoney } = useMoney();
  const invalidate = useInvalidateSellerOrders();

  const disputeQuery = useSellerDispute(order.id, true);
  const dispute = disputeQuery.data ?? null;
  const [activeTab, setActiveTab] = useState<"claim" | "remedy">("claim");
  const [sellerNote, setSellerNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasClaimed = (dispute?.claimed_resource_ids?.length ?? 0) > 0;
  const caseSummary = dispute ? summarizeDisputeCase(dispute) : null;
  const isOpenCase = dispute?.status === "open";

  const labelQuery = useQuery({
    queryKey: ["seller-orders", "dispute-resources", dispute?.id ?? 0, dispute?.resource_actions?.length ?? 0, dispute?.status ?? ""],
    queryFn: () => api.sellerDisputeResources(dispute!.id, { per_page: 100 }),
    enabled: Boolean(dispute?.id),
  });
  const labelRows = labelQuery.data?.items ?? [];

  useEffect(() => {
    if (!hasClaimed || !isOpenCase) setActiveTab("claim");
  }, [hasClaimed, isOpenCase]);

  const refresh = async () => {
    await Promise.all([disputeQuery.refetch(), invalidate()]);
  };

  const handleRespond = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispute) { setError(t("disputeNotFound")); return; }
    if (!sellerNote.trim()) { setError(t("disputeResponseRequired")); return; }
    setSubmitting(true);
    setError(null);
    try {
      await api.sellerRespondDispute(dispute.id, sellerNote.trim());
      setSellerNote("");
      await refresh();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t("disputeResponseFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-4xl flex-col gap-0 rounded-2xl border-line bg-surface p-0 shadow-card-lg sm:w-full">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line bg-raised/50 p-4 pr-12">
        <span className="shrink-0 rounded-lg bg-bad-soft p-1.5 text-bad"><AlertCircle size={18} /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              isOpenCase ? "bg-bad-soft text-bad" : "bg-raised text-muted",
            )}>
              {isOpenCase ? t("disputeDetailTitle") : t("disputeHistoryTitle")}
            </span>
            <span className="font-mono text-xs text-faint">{t("orderNumber", { id: order.id })}</span>
            {hasClaimed && (
              <span className="shrink-0 rounded border border-warn/30 bg-warn-soft/70 px-1.5 py-0.5 font-mono text-[10px] text-warn">
                {t("claim_batch", { count: dispute?.claimed_resource_ids?.length ?? 0 })}
              </span>
            )}
          </div>
          <DialogTitle className="mt-0.5 truncate text-[14px] font-bold text-fg">{order.product_title}</DialogTitle>
          <DialogDescription className="sr-only">{t("disputedOrderHint")}</DialogDescription>
        </div>
      </div>

      {hasClaimed && isOpenCase && (
        <div className="flex shrink-0 border-b border-line bg-raised/20" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "claim"}
            onClick={() => setActiveTab("claim")}
            className={cn(
              "flex-1 py-2.5 text-[12px] font-semibold transition-colors",
              activeTab === "claim" ? "border-b-2 border-bad bg-bad-soft/20 text-bad" : "text-muted hover:text-fg",
            )}
          >
            <AlertTriangle size={13} className="mr-1.5 inline-block" aria-hidden="true" />
            {t("disputeTimelineTab")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "remedy"}
            onClick={() => setActiveTab("remedy")}
            className={cn(
              "flex-1 py-2.5 text-[12px] font-semibold transition-colors",
              activeTab === "remedy" ? "border-b-2 border-warn bg-warn-soft/20 text-warn" : "text-muted hover:text-fg",
            )}
          >
            <RefreshCw size={13} className="mr-1.5 inline-block" aria-hidden="true" />
            {t("claimedAccountsTitle", { count: dispute?.claimed_resource_ids?.length ?? 0 })}
            {(caseSummary?.pending ?? 0) > 0 && activeTab !== "remedy" && (
              <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-warn text-[9px] font-bold text-white">
                {caseSummary?.pending}
              </span>
            )}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {disputeQuery.isPending ? (
          <div className="py-12 text-center"><Spinner /></div>
        ) : (activeTab === "claim" || !isOpenCase) ? (
          <div className="space-y-4 p-5 text-xs">
            {dispute ? (
              <DisputeCaseView
                dispute={dispute}
                statusLabel={
                  caseSummary && caseSummary.pending > 0
                    ? t("claimedAccountsTitle", { count: caseSummary.pending })
                    : isDisputeReadyToAccept(dispute)
                      ? td("awaiting_buyer_acceptance")
                      : td.has(dispute.status) ? td(dispute.status as "open") : dispute.status
                }
                statusTone={
                  caseSummary && caseSummary.pending > 0
                    ? "warn"
                    : isDisputeReadyToAccept(dispute) || dispute.status === "open"
                      ? "iris"
                      : "neutral"
                }
                resourceLabels={resourceLabelMap(labelRows)}
                formatRefund={formatBrowseMoney}
                viewerRole="seller"
              />
            ) : (
              <p className="text-muted">{t("disputeFallbackClaim")}</p>
            )}

            {dispute?.status === "open" && (
              <form onSubmit={handleRespond} className="space-y-3 border-t border-line pt-4">
                <div className="space-y-1.5">
                  <label htmlFor="seller-dispute-note" className="block font-semibold text-fg">{t("disputeSellerResponse")}</label>
                  <p className="text-[11.5px] text-muted">{t(hasClaimed ? "replyAgainHintAccounts" : "replyAgainHint")}</p>
                  <Textarea
                    id="seller-dispute-note"
                    rows={3}
                    value={sellerNote}
                    onChange={(e) => setSellerNote(e.target.value)}
                    placeholder={t("disputeSellerPlaceholder")}
                    className="bg-surface text-xs leading-relaxed"
                  />
                </div>
                {error && <div role="alert" className="rounded-lg border border-bad/20 bg-bad-soft p-2.5 text-xs font-medium text-bad">{error}</div>}
                <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col items-start gap-1.5">
                    <OrderChatButton
                      orderId={order.id}
                      appearance="link"
                      label={t("chatWithBuyer")}
                      className="inline-flex items-center gap-1 text-xs font-medium text-iris hover:underline disabled:opacity-60"
                    />
                    <MarketplaceChatButton
                      orderId={order.id}
                      appearance="link"
                      canRequestReview={!dispute.review_requested_at}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" type="button" onClick={onClose} disabled={submitting}>{t("close")}</Button>
                    <Button size="sm" type="submit" disabled={submitting || !sellerNote.trim()}>
                      {submitting ? t("sending") : t("sendDisputeResponse")}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        ) : (
          <div className="p-5">
            {dispute ? (
              <SellerDisputeRemedyPanel
                disputeId={dispute.id}
                dispute={dispute}
                order={order}
                formatRefund={formatBrowseMoney}
                onChanged={refresh}
              />
            ) : (
              <p className="py-10 text-center text-muted">{t("noClaimedAccounts")}</p>
            )}
          </div>
        )}
      </div>
    </DialogContent>
  );
}
