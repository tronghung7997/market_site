"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { Order } from "@/lib/types";
import { Button, Card, Pagination } from "@/components/ui";
import { AlertCircle, Download, Package, RefreshCw, Rows } from "@/components/Icons";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { downloadCsv, EXPORT_MAX_ROWS, fetchAllFilteredOrders, ordersToCsv } from "../exportCsv";
import { DEFAULT_FILTERS, PAGE_SIZE, type SellerOrdersFilters } from "../model";
import { useAcceptOrder, useSellerOrders } from "../useSellerOrders";
import { OrdersSummaryStrip } from "./OrdersSummaryStrip";
import { OrdersToolbar } from "./OrdersToolbar";
import { SellerDeliverDialog } from "./SellerDeliverDialog";
import { SellerDisputeDialog } from "./SellerDisputeDialog";
import { SellerOrdersTable } from "./SellerOrdersTable";

export function SellerOrdersSkeleton() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <div className="h-6 w-48 rounded bg-raised" />
          <div className="h-3.5 w-72 rounded bg-raised" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-24 rounded bg-raised" />
          <div className="h-8 w-24 rounded bg-raised" />
        </div>
      </div>
      <div className="h-[84px] rounded-xl border border-line bg-raised" />
      <div className="h-[420px] rounded-xl border border-line bg-raised" />
    </div>
  );
}

export function SellerOrdersConsole({
  filters,
  onFiltersChange,
}: {
  filters: SellerOrdersFilters;
  onFiltersChange: (next: SellerOrdersFilters) => void;
}) {
  const t = useTranslations("seller");
  const to = useTranslations("sellerOrders");
  const apiErrorMessage = useApiErrorMessage();
  const query = useSellerOrders(filters);
  const accept = useAcceptOrder();
  const [deliverOrder, setDeliverOrder] = useState<Order | null>(null);
  const [disputeOrder, setDisputeOrder] = useState<Order | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportWithData, setExportWithData] = useState(false);
  const [exporting, setExporting] = useState(false);

  const patch = useCallback((p: Partial<SellerOrdersFilters>) => onFiltersChange({ ...filters, ...p }), [filters, onFiltersChange]);

  // Keep the open dialogs on the fresh row after a refetch.
  useEffect(() => {
    const items = query.data?.items;
    if (!items) return;
    setDeliverOrder((cur) => (cur ? items.find((o) => o.id === cur.id) ?? cur : cur));
    setDisputeOrder((cur) => (cur ? items.find((o) => o.id === cur.id) ?? cur : cur));
  }, [query.data]);

  const handleAccept = async (order: Order) => {
    setNotice(null);
    try {
      await accept.mutateAsync(order.id);
    } catch (err: unknown) {
      setNotice(apiErrorMessage(err, t("orderAcceptFailed")));
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setNotice(null);
    try {
      const rows = await fetchAllFilteredOrders(filters);
      if (rows.length === 0) {
        setNotice(t("ordersNoExport"));
        return;
      }
      downloadCsv(`seller_orders_${new Date().toISOString().slice(0, 10)}.csv`, ordersToCsv(rows, exportWithData));
      setExportOpen(false);
    } catch (err: unknown) {
      setNotice(apiErrorMessage(err, to("exportFailed")));
    } finally {
      setExporting(false);
    }
  };

  if (query.isPending) return <SellerOrdersSkeleton />;
  if (query.isError && !query.data) {
    return (
      <Card className="p-10 text-center">
        <AlertCircle size={32} className="mx-auto mb-2 text-bad" />
        <p className="mb-1 text-[13.5px] font-medium text-fg">{to("loadFailed")}</p>
        <p className="mb-4 text-[12.5px] text-muted">{apiErrorMessage(query.error)}</p>
        <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>{to("retry")}</Button>
      </Card>
    );
  }

  const data = query.data;
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const refreshing = query.isFetching;

  return (
    <div className="space-y-5 animate-fade">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-fg">{t("ordersTitle")}</h1>
          <p className="text-[12.5px] text-muted">
            {t("ordersSubtitle")} &bull; {t("ordersTotalCount", { count: data.counts.all })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => void query.refetch()} disabled={refreshing} className="gap-1.5">
            <RefreshCw size={13} className={refreshing ? "animate-spin" : undefined} /> {t("refresh")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setExportOpen(true)} disabled={data.total === 0} className="gap-1.5">
            <Download size={13} /> {t("exportCsvPlain")}
          </Button>
          <Link href="/seller/inventory">
            <Button size="sm" variant="secondary" className="gap-1.5"><Rows size={13} className="text-iris" /> {t("manageInventory")}</Button>
          </Link>
          <Link href="/seller/products">
            <Button size="sm" variant="secondary" className="gap-1.5"><Package size={13} className="text-iris" /> {t("manageProducts")}</Button>
          </Link>
        </div>
      </div>

      {notice && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-bad/20 bg-bad-soft p-2.5 text-xs font-medium text-bad">
          <span>{notice}</span>
          <Button size="sm" variant="ghost" onClick={() => setNotice(null)} className="h-6 px-1.5 text-bad">{t("close")}</Button>
        </div>
      )}

      <OrdersSummaryStrip counts={data.counts} active={filters.tab} onSelect={(tab) => patch({ tab, page: 1 })} />

      <Card className={refreshing ? "overflow-hidden p-0 opacity-70 transition-opacity" : "overflow-hidden p-0 transition-opacity"} aria-busy={refreshing}>
        <OrdersToolbar
          filters={filters}
          products={data.products}
          onChange={patch}
          onReset={() => onFiltersChange({ ...DEFAULT_FILTERS })}
        />
        <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px] text-muted">
          <span>{to("resultSummary", { total: data.total })}</span>
          {query.isError && <span className="text-warn">{to("staleWarning")}</span>}
        </div>
        <SellerOrdersTable
          orders={data.items}
          sort={filters.sort}
          onSort={(sort) => patch({ sort, page: 1 })}
          actingOrderId={accept.isPending ? accept.variables ?? null : null}
          onAccept={handleAccept}
          onDeliver={setDeliverOrder}
          onDispute={setDisputeOrder}
          emptyAction={(
            <Button size="sm" variant="secondary" onClick={() => onFiltersChange({ ...DEFAULT_FILTERS })}>
              {t("clearFilters")}
            </Button>
          )}
        />
        {totalPages > 1 && (
          <div className="flex flex-col gap-2 border-t border-line bg-raised/20 p-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
            <span>
              {t("paginationOrders", {
                from: (filters.page - 1) * PAGE_SIZE + 1,
                to: Math.min(filters.page * PAGE_SIZE, data.total),
                total: data.total,
              })}
            </span>
            <Pagination page={filters.page} totalPages={totalPages} onChange={(page) => patch({ page })} />
          </div>
        )}
      </Card>

      <SellerDeliverDialog order={deliverOrder} onClose={() => setDeliverOrder(null)} />
      <SellerDisputeDialog order={disputeOrder} onClose={() => setDisputeOrder(null)} />

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-md gap-3 rounded-2xl border-line bg-surface p-5 shadow-card-lg">
          <DialogTitle className="text-[15px] font-bold text-fg">{to("exportTitle")}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">
            {to("exportBody", { total: Math.min(data.total, EXPORT_MAX_ROWS) })}
          </DialogDescription>
          <label className="flex items-start gap-2 text-[12.5px] text-fg">
            <input
              type="checkbox"
              checked={exportWithData}
              onChange={(e) => setExportWithData(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-line-2 text-iris"
            />
            <span>
              {to("exportIncludeData")}
              <span className="block text-[11.5px] text-muted">{to("exportIncludeDataHint")}</span>
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setExportOpen(false)} disabled={exporting}>{t("cancel")}</Button>
            <Button size="sm" onClick={handleExport} disabled={exporting} className="gap-1.5">
              <Download size={13} /> {exporting ? to("exporting") : t("exportCsvPlain")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
