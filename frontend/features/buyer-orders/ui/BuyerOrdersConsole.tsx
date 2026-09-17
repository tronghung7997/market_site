"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { matchesOrderRef } from "@/lib/order-ref";
import type { Order } from "@/lib/types";
import { Button, Card, Pagination, Select } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AlertCircle, RefreshCw, ShieldCheck } from "@/components/Icons";
import { DEFAULT_FILTERS, PAGE_SIZES, hasActiveOrderFilters, type BuyerOrdersFilters } from "../model";
import {
  disputeOpenedPatch,
  reviewedPatch,
  useBuyerOrder,
  useBuyerOrderStats,
  useBuyerOrders,
  useConfirmOrder,
  useInvalidateBuyerOrders,
  usePatchCachedOrder,
} from "../useBuyerOrders";
import { useBuyerOrdersUrl } from "../useOrdersUrl";
import { BuyerOrderCard } from "./BuyerOrderCard";
import { BuyerOrdersTable } from "./BuyerOrdersTable";
import DisputeModal from "./DisputeModal";
import OrderDetailsModal from "./OrderDetailsModal";
import type { OrderActionHandlers } from "./OrderRowActions";
import { OrdersSummaryStrip } from "./OrdersSummaryStrip";
import { OrdersToolbar } from "./OrdersToolbar";

export function BuyerOrdersSkeleton() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true">
      <div className="space-y-1.5">
        <div className="h-6 w-40 rounded bg-raised" />
        <div className="h-3.5 w-64 rounded bg-raised" />
      </div>
      <div className="h-[84px] rounded-xl border border-line bg-raised" />
      <div className="h-[420px] rounded-xl border border-line bg-raised" />
    </div>
  );
}

interface DisputeTarget {
  order: Order;
  variantName?: string | null;
  initialReason?: string;
  initialEvidence?: Record<string, string>;
  resourceIds?: number[];
  appendToExisting?: boolean;
}

export function BuyerOrdersConsole() {
  const t = useTranslations("orders");
  const tb = useTranslations("buyerOrders");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { formatOrderHistoryMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const { account, loading: authLoading } = useAuth();
  const accountId = account?.id;
  const enabled = !authLoading && Boolean(account);

  const url = useBuyerOrdersUrl();
  const { filters } = url;
  const ordersQuery = useBuyerOrders(filters, accountId, enabled);
  const statsQuery = useBuyerOrderStats(accountId, enabled);
  const patchCached = usePatchCachedOrder(accountId);
  const invalidate = useInvalidateBuyerOrders(accountId);
  const confirm = useConfirmOrder(accountId);

  const items = ordersQuery.data?.items ?? [];
  const total = ordersQuery.data?.total ?? 0;

  // The inspector's order comes from the current page when it is there, else
  // from a by-ref fetch (deep links to another page / another filter).
  const fromList = useMemo(
    () => (url.orderRef ? items.find((row) => matchesOrderRef(row, url.orderRef!)) ?? null : null),
    [items, url.orderRef],
  );
  const detailQuery = useBuyerOrder(url.orderRef && !fromList && enabled ? url.orderRef : null, accountId);
  const selectedOrder = fromList ?? (detailQuery.data && url.orderRef && matchesOrderRef(detailQuery.data, url.orderRef) ? detailQuery.data : null);

  const [disputeTarget, setDisputeTarget] = useState<DisputeTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Order | null>(null);
  const [disputeRevision, setDisputeRevision] = useState(0);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((tone: "good" | "bad", text: string) => {
    setNotice({ tone, text });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3200);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const patch = useCallback((p: Partial<BuyerOrdersFilters>) => url.setFilters({ ...filters, ...p }), [filters, url]);

  const runConfirm = useCallback(async (order: Order) => {
    try {
      await confirm.mutateAsync(order.id);
      setConfirmTarget(null);
      showNotice("good", t("confirmSuccess"));
    } catch (err: unknown) {
      showNotice("bad", apiErrorMessage(err));
    }
  }, [confirm, showNotice, t, apiErrorMessage]);

  const handlers = useMemo<OrderActionHandlers>(() => ({
    onOpen: (order, options) => url.openOrder(order.order_code, options),
    onConfirm: (order) => setConfirmTarget(order),
    onDispute: (order) => setDisputeTarget({
      order,
      variantName: order.variant_name,
      initialReason: order.variant_name ? t("reasonPackagePrefix", { name: order.variant_name }) : "",
    }),
  }), [url, t]);

  const handleDisputeSuccess = () => {
    const target = disputeTarget;
    setDisputeTarget(null);
    setDisputeRevision((r) => r + 1);
    showNotice("good", t("disputeSuccess"));
    if (target) patchCached(target.order.id, disputeOpenedPatch);
    void invalidate();
  };

  const handleReviewDone = (orderId: number, ok: boolean, message: string) => {
    showNotice(ok ? "good" : "bad", message);
    if (ok) patchCached(orderId, reviewedPatch);
  };

  const handleDelivered = (orderId: number, deliveredData: string) => {
    patchCached(orderId, (ord) => ({ ...ord, delivered_data: deliveredData }));
  };

  const handleDisputeChanged = (order: Order, outcome: "withdrawn") => {
    setDisputeRevision((r) => r + 1);
    if (outcome === "withdrawn") {
      const completed = !order.escrow_expires_at || new Date(order.escrow_expires_at).getTime() <= Date.now();
      patchCached(order.id, (ord) => ({
        ...ord,
        has_dispute: false,
        dispute_status: "withdrawn",
        status: completed ? "completed" : ord.status,
        fulfillment: completed && ord.fulfillment ? { ...ord.fulfillment, status: "completed" } : ord.fulfillment,
        protection: { status: completed ? "closed" : "active" },
        capabilities: ord.capabilities
          ? { ...ord.capabilities, can_confirm: !completed, can_dispute: !completed, can_append_claims: false }
          : ord.capabilities,
      }));
      showNotice("good", t(completed ? "withdrawDisputeCompleted" : "withdrawDisputeSuccess"));
    }
    void invalidate();
  };

  if (authLoading || (enabled && ordersQuery.isPending && !ordersQuery.data)) return <BuyerOrdersSkeleton />;

  if (ordersQuery.isError && !ordersQuery.data) {
    return (
      <Card className="p-10 text-center">
        <AlertCircle size={32} className="mx-auto mb-2 text-bad" />
        <p className="mb-1 text-[13.5px] font-medium text-fg">{tb("loadFailed")}</p>
        <p className="mb-4 text-[12.5px] text-muted">{apiErrorMessage(ordersQuery.error)}</p>
        <Button size="sm" variant="secondary" onClick={() => void ordersQuery.refetch()}>{tb("retry")}</Button>
      </Card>
    );
  }

  const stats = statsQuery.data ?? null;
  const totalPages = Math.max(1, Math.ceil(total / filters.perPage));
  const refreshing = ordersQuery.isFetching;
  const filtered = hasActiveOrderFilters(filters);
  const nothingAtAll = stats ? stats.total === 0 : !filtered && total === 0;
  const confirmMoney = confirmTarget ? formatOrderHistoryMoney(confirmTarget.total_amount, confirmTarget.display_fx_rate_snapshot, { locale }) : null;

  return (
    <div className="space-y-5">
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={
            notice.tone === "good"
              ? "fixed right-5 top-5 z-[90] rounded-xl border border-good/25 bg-good-soft px-4 py-2.5 text-[13px] font-semibold text-good shadow-card-lg"
              : "fixed right-5 top-5 z-[90] rounded-xl border border-bad/25 bg-bad-soft px-4 py-2.5 text-[13px] font-semibold text-bad shadow-card-lg"
          }
        >
          {notice.text}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-fg">{t("title")}</h1>
          <p className="text-[12.5px] text-muted">{t("subtitle")}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => { void ordersQuery.refetch(); void statsQuery.refetch(); }} disabled={refreshing} className="gap-1.5 self-start sm:self-auto">
          <RefreshCw size={13} className={refreshing ? "animate-spin" : undefined} /> {tb("refresh")}
        </Button>
      </div>

      <OrdersSummaryStrip stats={stats} active={filters.tab} onSelect={(tab) => patch({ tab, page: 1 })} />

      <Card className={refreshing ? "overflow-hidden p-0 opacity-70 transition-opacity" : "overflow-hidden p-0 transition-opacity"} aria-busy={refreshing}>
        <OrdersToolbar filters={filters} onChange={patch} onReset={() => url.setFilters({ ...DEFAULT_FILTERS })} />
        <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px] text-muted">
          <span>{tb("resultSummary", { total })}</span>
          {ordersQuery.isError && <span className="text-warn">{tb("staleWarning")}</span>}
        </div>

        {/* Mobile: stacked records. Desktop: one header + aligned rows. */}
        <div className="space-y-3 p-3 md:hidden">
          {items.length === 0 ? (
            <EmptyBlock nothingAtAll={nothingAtAll} filtered={filtered} onReset={() => url.setFilters({ ...DEFAULT_FILTERS })} />
          ) : items.map((o) => (
            <BuyerOrderCard key={o.id} order={o} confirming={confirm.isPending && confirm.variables === o.id} handlers={handlers} />
          ))}
        </div>
        <div className="hidden md:block">
          <BuyerOrdersTable
            orders={items}
            sort={filters.sort}
            onSort={(sort) => patch({ sort, page: 1 })}
            confirmingId={confirm.isPending ? confirm.variables ?? null : null}
            handlers={handlers}
            emptyTitle={nothingAtAll ? t("empty") : t("emptyFiltered")}
            emptyHint={nothingAtAll ? tb("emptyHint") : undefined}
            emptyAction={nothingAtAll ? (
              <Link href="/"><Button size="sm">{t("explore")}</Button></Link>
            ) : filtered ? (
              <Button size="sm" variant="secondary" onClick={() => url.setFilters({ ...DEFAULT_FILTERS })}>{t("clearFilters")}</Button>
            ) : undefined}
          />
        </div>

        {total > 0 && (
          <div className="flex flex-col gap-2 border-t border-line bg-raised/20 p-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
            <span className="tabular">
              {t("showing", {
                from: (filters.page - 1) * filters.perPage + 1,
                to: Math.min(filters.page * filters.perPage, total),
                total,
              })}
            </span>
            <div className="flex items-center gap-3">
              <Pagination page={filters.page} totalPages={totalPages} onChange={(page) => patch({ page })} />
              <Select
                value={filters.perPage}
                onChange={(e) => patch({ perPage: Number(e.target.value), page: 1 })}
                aria-label={t("perPageAria")}
                className="h-8 rounded-lg bg-surface px-2.5 text-xs"
              >
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{tc("perPage", { n })}</option>)}
              </Select>
            </div>
          </div>
        )}
      </Card>

      {selectedOrder && (
        <OrderDetailsModal
          key={selectedOrder.id}
          order={selectedOrder}
          highlightResourceIds={url.highlightResourceIds}
          highlightLines={url.highlightLines}
          onClose={url.closeOrder}
          open={disputeTarget === null}
          lockDismiss={disputeTarget !== null}
          onConfirm={(orderId) => { if (orderId === selectedOrder.id) void runConfirm(selectedOrder); }}
          confirming={confirm.isPending && confirm.variables === selectedOrder.id}
          disputeRevision={disputeRevision}
          onOpenDispute={(_orderId, options) => {
            setDisputeTarget({
              order: selectedOrder,
              variantName: options?.variantName ?? selectedOrder.variant_name,
              initialReason: options?.initialReason,
              initialEvidence: options?.initialEvidence,
              resourceIds: options?.resourceIds,
              appendToExisting: selectedOrder.has_dispute,
            });
          }}
          initialTab={url.inspectorTab}
          reviewDone={Boolean(selectedOrder.has_review)}
          onReviewDone={handleReviewDone}
          onDelivered={handleDelivered}
          onDisputeChanged={handleDisputeChanged}
        />
      )}
      {url.orderRef && !selectedOrder && detailQuery.isError && (
        <Dialog open onOpenChange={(open) => { if (!open) url.closeOrder(); }}>
          <DialogContent className="max-w-sm gap-3 rounded-2xl border-line bg-surface p-5 shadow-card-lg">
            <DialogTitle className="text-[15px] font-bold text-fg">{tb("orderNotFoundTitle")}</DialogTitle>
            <DialogDescription className="text-[12.5px] text-muted">{tb("orderNotFoundBody", { ref: url.orderRef })}</DialogDescription>
            <div className="flex justify-end pt-1">
              <Button size="sm" variant="secondary" onClick={url.closeOrder}>{tc("close")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {disputeTarget && (
        <DisputeModal
          orderId={disputeTarget.order.id}
          order={disputeTarget.order}
          variantName={disputeTarget.variantName}
          initialReason={disputeTarget.initialReason}
          initialEvidence={disputeTarget.initialEvidence}
          resourceIds={disputeTarget.resourceIds}
          appendToExisting={disputeTarget.appendToExisting}
          onClose={() => setDisputeTarget(null)}
          onSuccess={handleDisputeSuccess}
        />
      )}

      {/* Releasing escrow is irreversible, so the row action gets the same
          two-step confirmation the inspector has. */}
      <Dialog open={confirmTarget !== null} onOpenChange={(open) => { if (!open && !confirm.isPending) setConfirmTarget(null); }}>
        <DialogContent className="max-w-sm gap-3 rounded-2xl border-line bg-surface p-5 shadow-card-lg">
          <DialogTitle className="flex items-center gap-2 text-[15px] font-bold text-fg">
            <ShieldCheck size={16} className="text-good" />
            {confirmMoney ? t("confirmReleaseTitle", { amount: confirmMoney.text }) : t("confirmReceived")}
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">{t("confirmReleaseBody")}</DialogDescription>
          {confirmTarget && (
            <p className="rounded-lg border border-line bg-raised/40 px-3 py-2 text-[12px] text-fg">
              <span className="font-mono font-semibold">#{confirmTarget.order_code}</span>
              {confirmTarget.product_title && <> · {confirmTarget.product_title}</>}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setConfirmTarget(null)} disabled={confirm.isPending}>{t("confirmReleaseMore")}</Button>
            <Button size="sm" onClick={() => confirmTarget && void runConfirm(confirmTarget)} disabled={confirm.isPending}>
              {confirm.isPending ? t("confirming") : t("confirmReleaseYes")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyBlock({ nothingAtAll, filtered, onReset }: { nothingAtAll: boolean; filtered: boolean; onReset: () => void }) {
  const t = useTranslations("orders");
  const tb = useTranslations("buyerOrders");
  return (
    <div className="space-y-2 px-4 py-10 text-center">
      <p className="text-[13.5px] font-medium text-fg">{nothingAtAll ? t("empty") : t("emptyFiltered")}</p>
      {nothingAtAll && <p className="text-xs text-muted">{tb("emptyHint")}</p>}
      {nothingAtAll ? (
        <Link href="/"><Button size="sm">{t("explore")}</Button></Link>
      ) : filtered ? (
        <Button size="sm" variant="secondary" onClick={onReset}>{t("clearFilters")}</Button>
      ) : null}
    </div>
  );
}
