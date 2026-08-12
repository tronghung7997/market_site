"use client";

import { Link, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { queryKeys } from "@/lib/query-keys";
import { useOrders, useOrderStats } from "@/hooks/use-orders";
import type { PaginatedOrderResponse } from "@/lib/types";
import { Button, Card, Pagination, Spinner } from "@/components/ui";
import OrderCard, { TerminalOrderRow } from "./OrderCard";
import DisputeModal from "./DisputeModal";
import { FilterCard, PER_PAGE_OPTIONS, StatusTabs, useOrderFilters } from "./OrderFilters";

export default function OrdersPage() {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const { account, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useOrderFilters(searchParams.get("status") ?? "", searchParams.get("search") ?? "");

  const queryClient = useQueryClient();
  const ordersQuery = useOrders(filters.params, !authLoading && !!account);
  const statsQuery = useOrderStats(!authLoading && !!account);
  const orders = ordersQuery.data?.items ?? [];
  const total = ordersQuery.data?.total ?? 0;
  const loading = ordersQuery.isPending;
  const stats = statsQuery.data ?? null;
  const [disputeOrderId, setDisputeOrderId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [reviewOrderId, setReviewOrderId] = useState<number | null>(null);
  const [reviewedOrders, setReviewedOrders] = useState<Set<number>>(new Set());
  const [plateOrders, setPlateOrders] = useState<Set<number>>(new Set());
  const handlePlate = useCallback((id: number) => {
    setPlateOrders((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const handleDelivered = useCallback((id: number, deliveredData: string) => {
    queryClient.setQueryData<PaginatedOrderResponse>(
      queryKeys.orders(filters.params as Record<string, unknown>),
      (prev) => prev
        ? { ...prev, items: prev.items.map((ord) => (ord.id === id ? { ...ord, delivered_data: deliveredData } : ord)) }
        : prev,
    );
  }, [queryClient, filters.params]);

  useEffect(() => {
    if (authLoading) return;
    if (!account) router.push("/login");
  }, [account, authLoading, router]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function handleConfirm(orderId: number) {
    setConfirmingId(orderId);
    try {
      await api.confirmOrder(orderId);
      showToast(t("confirmSuccess"));
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.orderStats() });
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : te("UNKNOWN"));
    } finally {
      setConfirmingId(null);
    }
  }

  function handleReviewDone(orderId: number, ok: boolean, message: string) {
    showToast(message);
    if (ok) {
      setReviewedOrders((prev) => new Set(prev).add(orderId));
      setReviewOrderId(null);
    }
  }

  function handleDisputeSuccess() {
    setDisputeOrderId(null);
    showToast(t("disputeSuccess"));
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.orderStats() });
  }

  const totalPages = Math.max(1, Math.ceil(total / filters.perPage));

  const tabCounts: Record<string, number | undefined> = {
    "": stats?.total,
    active: stats?.active,
    disputed: stats?.disputed,
    deleted: undefined,
  };

  if (authLoading) return <div className="w-full mx-auto max-w-[920px] px-6 py-16"><Spinner /></div>;

  return (
    <div className="w-full mx-auto max-w-[1200px] px-6 py-10">
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-4 py-2.5 rounded-lg text-[13px] font-medium shadow-card-lg bg-good text-white">
          {toast}
        </div>
      )}

      {disputeOrderId !== null && (
        <DisputeModal orderId={disputeOrderId} onClose={() => setDisputeOrderId(null)} onSuccess={handleDisputeSuccess} />
      )}

      <div className="grid lg:grid-cols-[260px_1fr] gap-6 min-w-0">
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start space-y-4">
          <div>
            <h2 className="font-serif text-[24px] tracking-tight">{t("title")}</h2>
            <p className="text-[12.5px] text-muted mt-0.5">{t("subtitle")}</p>
          </div>

          {stats && (
            <Card className="px-4 py-3.5">
              <dl className="text-[12.5px] space-y-2">
                <div className="flex items-baseline justify-between">
                  <dt className="text-muted">{t("totalOrders")}</dt>
                  <dd className="font-semibold tabular">{stats.total}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-muted">{t("active")}</dt>
                  <dd className={cn("font-semibold tabular", stats.active > 0 ? "text-iris-hi" : "")}>{stats.active}</dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-muted">{t("disputed")}</dt>
                  <dd className={cn("font-semibold tabular", stats.disputed > 0 ? "text-bad" : "")}>{stats.disputed}</dd>
                </div>
                <div className="flex items-baseline justify-between border-t border-dashed border-line-2 pt-2.5 mt-2.5">
                  <dt className="text-muted">{t("spent")}</dt>
                  <dd className="font-mono font-semibold tabular text-[13px]">{formatBrowseMoney(stats.total_spend, { locale })}</dd>
                </div>
              </dl>
            </Card>
          )}

          <StatusTabs filters={filters} counts={tabCounts} />
          <FilterCard filters={filters} />
        </aside>

        <div className="min-w-0">
          {loading ? (
            <div className="flex flex-col gap-3.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="h-11 w-11 shrink-0 rounded-lg bg-raised animate-shimmer" />
                    <div className="flex-1 space-y-2 pt-1">
                      <div className="h-4 w-1/3 rounded bg-raised animate-shimmer" />
                      <div className="h-3 w-1/2 rounded bg-raised animate-shimmer" />
                    </div>
                    <div className="h-5 w-24 rounded bg-raised animate-shimmer" />
                  </div>
                </Card>
              ))}
            </div>
          ) : orders.length === 0 ? (
            <Card className="p-8 flex flex-col items-center gap-3 text-center">
              <p className="text-[13px] text-muted">
                {filters.hasFilters || filters.tab !== "" ? t("emptyFiltered") : t("empty")}
              </p>
              {filters.hasFilters ? (
                <Button variant="secondary" size="sm" onClick={filters.clear}>{t("clearFilters")}</Button>
              ) : (
                <Link href="/"><Button size="sm">{t("explore")}</Button></Link>
              )}
            </Card>
          ) : (
            <div className="flex flex-col gap-3.5">
              {orders.map((o) =>
                o.status === "cancelled" || o.status === "refunded" ? (
                  <TerminalOrderRow key={o.id} order={o} />
                ) : (
                  <OrderCard
                    key={o.id}
                    order={o}
                    confirming={confirmingId === o.id}
                    plateHidden={plateOrders.has(o.id)}
                    reviewOpen={reviewOrderId === o.id}
                    reviewDone={!!o.has_review || reviewedOrders.has(o.id)}
                    onConfirm={handleConfirm}
                    onOpenDispute={setDisputeOrderId}
                    onOpenReview={setReviewOrderId}
                    onReviewDone={handleReviewDone}
                    onCloseReview={() => setReviewOrderId(null)}
                    onDelivered={handleDelivered}
                    onPlate={handlePlate}
                  />
                ),
              )}
            </div>
          )}

          {!loading && total > 0 && (
            <div className="mt-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 min-w-0">
                <span className="text-[12px] text-faint tabular min-w-0">
                  {t("showing", {
                    from: (filters.page - 1) * filters.perPage + 1,
                    to: Math.min(filters.page * filters.perPage, total),
                    total,
                  })}
                </span>
                <Pagination page={filters.page} totalPages={totalPages} onChange={filters.setPage} />
              </div>
              {/* Per-page control under pagination so narrow screens don't overflow */}
              <div className="flex justify-end">
                <select
                  value={filters.perPage}
                  onChange={(e) => filters.setPerPage(Number(e.target.value))}
                  aria-label={t("perPageAria")}
                  className="h-8 max-w-full rounded-lg bg-surface border border-line px-2 text-[12px] text-muted cursor-pointer focus:outline-none focus:border-iris"
                >
                  {PER_PAGE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{tc("perPage", { n })}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
