"use client";

import { Link, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  Download,
  Copy,
  MessageSquare,
  AlertTriangle,
  Search,
  Calendar,
  ShieldCheck,
  Check,
  Layers,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { canOpenDispute, displayOrderStatus, hasOpenDispute } from "@/lib/order-status";
import { formatDate, formatDateTime } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";
import { useOrders, useOrderStats } from "@/hooks/use-orders";
import type { Order, PaginatedOrderResponse } from "@/lib/types";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { Button, Card, Pagination, Spinner, Tag } from "@/components/ui";
import DisputeModal from "./DisputeModal";
import OrderDetailsModal from "./OrderDetailsModal";
import { PER_PAGE_OPTIONS, useOrderFilters } from "./OrderFilters";
import { parseHighlightedResourceIds } from "@/lib/dispute-case";

export default function OrdersPage() {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { formatBrowseMoney, formatOrderHistoryMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
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

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [disputeTarget, setDisputeTarget] = useState<{
    orderId: number;
    order?: Order | null;
    variantName?: string | null;
    initialReason?: string;
    initialEvidence?: Record<string, string>;
    resourceIds?: number[];
    appendToExisting?: boolean;
  } | null>(null);

  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [disputeRevision, setDisputeRevision] = useState(0);
  const [toast, setToast] = useState("");
  const [reviewedOrders, setReviewedOrders] = useState<Set<number>>(new Set());
  const [plateOrders, setPlateOrders] = useState<Set<number>>(new Set());
  const [copiedOrderId, setCopiedOrderId] = useState<number | null>(null);
  const highlightResourceIds = useMemo(
    () => parseHighlightedResourceIds(searchParams.get("resources")),
    [searchParams],
  );
  const autoOpened = useRef(false);

  const handlePlate = useCallback((id: number) => {
    setPlateOrders((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const handleDelivered = useCallback(
    (id: number, deliveredData: string) => {
      queryClient.setQueryData<PaginatedOrderResponse>(
        queryKeys.orders(filters.params as Record<string, unknown>),
        (prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((ord) => (ord.id === id ? { ...ord, delivered_data: deliveredData } : ord)),
              }
            : prev,
      );
      if (selectedOrder?.id === id) {
        setSelectedOrder((prev) => (prev ? { ...prev, delivered_data: deliveredData } : prev));
      }
    },
    [queryClient, filters.params, selectedOrder?.id],
  );

  const [extraHighlightResourceIds, setExtraHighlightResourceIds] = useState<number[]>([]);

  useEffect(() => {
    if (authLoading) return;
    if (!account) router.push("/login");
  }, [account, authLoading, router]);

  useEffect(() => {
    if (autoOpened.current || authLoading || !account) return;
    const query = (searchParams.get("search") || "").trim();
    if (!query && highlightResourceIds.length === 0) return;
    const asId = Number(query);
    if (Number.isInteger(asId) && asId > 0) {
      const match = orders.find((row) => row.id === asId);
      if (match) {
        autoOpened.current = true;
        setSelectedOrder(match);
      } else if (!loading) {
        autoOpened.current = true;
        api.getOrder(asId).then((fetched) => {
          if (fetched) setSelectedOrder(fetched);
        }).catch(() => {});
      }
      return;
    }
    if (orders.length === 1 && !loading) {
      autoOpened.current = true;
      setSelectedOrder(orders[0]);
    }
  }, [account, authLoading, highlightResourceIds.length, loading, orders, searchParams]);

  useEffect(() => {
    const handleNotificationClick = async (event: Event) => {
      const customEvent = event as CustomEvent<{ href: string }>;
      const href = customEvent?.detail?.href;
      if (!href) return;

      try {
        const url = new URL(href, window.location.origin);
        const isOrdersPage =
          url.pathname === "/orders" ||
          url.pathname === `/${locale}/orders` ||
          url.pathname.endsWith("/orders");
        if (!isOrdersPage) return;

        const query = (url.searchParams.get("search") || "").trim();
        const asId = Number(query);
        const resourcesParam = url.searchParams.get("resources");
        if (resourcesParam) {
          setExtraHighlightResourceIds(parseHighlightedResourceIds(resourcesParam));
        }

        if (Number.isInteger(asId) && asId > 0) {
          const match = orders.find((row) => row.id === asId);
          if (match) {
            setSelectedOrder(match);
          } else {
            const fetched = await api.getOrder(asId);
            if (fetched) setSelectedOrder(fetched);
          }
        }
      } catch {
        // ignore
      }
    };

    window.addEventListener("app:notification-click", handleNotificationClick);
    return () => {
      window.removeEventListener("app:notification-click", handleNotificationClick);
    };
  }, [locale, orders]);

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
      queryClient.setQueryData<PaginatedOrderResponse>(
        queryKeys.orders(filters.params as Record<string, unknown>),
        (prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((ord) =>
                  ord.id === orderId
                    ? {
                        ...ord,
                        status: "completed",
                        has_dispute: false,
                        protection: { status: "closed" },
                        fulfillment: ord.fulfillment ? { ...ord.fulfillment, status: "completed" } : ord.fulfillment,
                        capabilities: ord.capabilities
                          ? { ...ord.capabilities, can_confirm: false, can_dispute: false, can_review: true }
                          : ord.capabilities,
                      }
                    : ord,
                ),
              }
            : prev,
      );
      if (selectedOrder?.id === orderId) {
        setSelectedOrder((prev) =>
          prev
            ? {
                ...prev,
                status: "completed",
                has_dispute: false,
                protection: { status: "closed" },
                fulfillment: prev.fulfillment ? { ...prev.fulfillment, status: "completed" } : prev.fulfillment,
                capabilities: prev.capabilities
                  ? { ...prev.capabilities, can_confirm: false, can_dispute: false, can_review: true }
                  : prev.capabilities,
              }
            : prev,
        );
      }
    } catch (e: unknown) {
      showToast(apiErrorMessage(e));
    } finally {
      setConfirmingId(null);
    }
  }

  function handleReviewDone(orderId: number, ok: boolean, message: string) {
    showToast(message);
    if (ok) {
      setReviewedOrders((prev) => new Set(prev).add(orderId));
    }
  }

  function handleDisputeSuccess() {
    const orderId = disputeTarget?.orderId ?? selectedOrder?.id;
    setDisputeTarget(null);
    setDisputeRevision((revision) => revision + 1);
    showToast(t("disputeSuccess"));
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.orderStats() });
    const patch = {
      has_dispute: true as const,
      protection: { status: "dispute_open" as const },
    };
    if (orderId) {
      queryClient.setQueryData<PaginatedOrderResponse>(
        queryKeys.orders(filters.params as Record<string, unknown>),
        (prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((ord) =>
                  ord.id === orderId
                    ? {
                        ...ord,
                        ...patch,
                        capabilities: ord.capabilities
                          ? { ...ord.capabilities, can_confirm: false, can_dispute: false, can_review: false }
                          : ord.capabilities,
                      }
                    : ord,
                ),
              }
            : prev,
      );
      setSelectedOrder((prev) => prev ? {
        ...prev,
        ...patch,
        capabilities: prev.capabilities ? {
          ...prev.capabilities,
          can_confirm: false,
          can_dispute: false,
          can_review: false,
        } : prev.capabilities,
      } : prev);
    }
  }

  function handleDisputeChanged(order: Order, outcome: "withdrawn") {
    setDisputeRevision((revision) => revision + 1);
    queryClient.invalidateQueries({ queryKey: ["orders"] });
    queryClient.invalidateQueries({ queryKey: queryKeys.orderStats() });
    if (outcome === "withdrawn") {
      const completed = !order.escrow_expires_at || new Date(order.escrow_expires_at).getTime() <= Date.now();
      setSelectedOrder((prev) => prev?.id === order.id
        ? {
            ...prev,
            has_dispute: false,
            status: completed ? "completed" : prev.status,
            fulfillment: completed && prev.fulfillment ? { ...prev.fulfillment, status: "completed" } : prev.fulfillment,
            protection: { status: completed ? "closed" : "active" },
          }
        : prev);
      showToast(t(completed ? "withdrawDisputeCompleted" : "withdrawDisputeSuccess"));
    }
  }

  const handleCopyAll = (o: Order) => {
    if (!o.delivered_data) return;
    navigator.clipboard.writeText(o.delivered_data);
    setCopiedOrderId(o.id);
    showToast(t("copiedExclaim"));
    setTimeout(() => setCopiedOrderId(null), 2000);
  };

  const handleDownload = (o: Order) => {
    if (!o.delivered_data) return;
    const blob = new Blob([o.delivered_data], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DonHang_${o.id}_${o.quantity}_tai_khoan.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.max(1, Math.ceil(total / filters.perPage));

  if (authLoading) {
    return (
      <div className="w-full mx-auto max-w-[920px] px-6 py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="w-full mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-6">
      {toast && (
        <div role="status" aria-live="polite" className="fixed top-5 right-5 z-[90] rounded-xl border border-good/25 bg-good-soft px-4 py-2.5 text-[13px] font-semibold text-good shadow-card-lg animate-in fade-in slide-in-from-top-2 duration-200">
          {toast}
        </div>
      )}

      {/* COMPREHENSIVE ORDER DETAILS & 1000-ITEM INSPECTOR MODAL */}
      {selectedOrder !== null && (
        <OrderDetailsModal
          order={selectedOrder}
          highlightResourceIds={extraHighlightResourceIds.length > 0 ? extraHighlightResourceIds : highlightResourceIds}
          onClose={() => setSelectedOrder(null)}
          open={disputeTarget === null}
          lockDismiss={disputeTarget !== null}
          onConfirm={handleConfirm}
          confirming={confirmingId === selectedOrder.id}
          disputeRevision={disputeRevision}
          onOpenDispute={(orderId, options) => {
            setDisputeTarget({
              orderId,
              order: selectedOrder,
              variantName: options?.variantName ?? selectedOrder.variant_name,
              initialReason: options?.initialReason,
              initialEvidence: options?.initialEvidence,
              resourceIds: options?.resourceIds,
              appendToExisting: selectedOrder.has_dispute,
            });
          }}
          onOpenReview={() => {}}
          reviewDone={!!selectedOrder.has_review || reviewedOrders.has(selectedOrder.id)}
          onReviewDone={handleReviewDone}
          onDelivered={handleDelivered}
          onPlate={handlePlate}
          onDisputeChanged={handleDisputeChanged}
        />
      )}

      {disputeTarget !== null && (
        <DisputeModal
          orderId={disputeTarget.orderId}
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

      {/* PAGE HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-fg tracking-tight">{t("title")}</h1>
          <p className="text-[12.5px] text-muted mt-0.5">{t("subtitle")}</p>
        </div>
      </div>

      {/* TOP KPI STAT CARDS (Interactive filters) */}
      {stats && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Total Orders */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => filters.setTab("")}
            className={cn(
              "rounded-2xl border border-line bg-surface p-4 shadow-xs flex items-center justify-between gap-3.5 cursor-pointer select-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-lg",
              filters.tab === ""
                ? "ring-2 ring-iris border-iris bg-iris-soft/25 shadow-md"
                : "hover:border-line-2"
            )}
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-iris-soft text-iris font-semibold text-xl">
                📦
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted truncate">{t("totalOrders")}</div>
                <div className="font-mono text-[22px] font-bold text-fg tabular">{stats.total} <span className="text-[11.5px] font-normal text-muted">{t("unit")}</span></div>
              </div>
            </div>
            <div className="text-right shrink-0">
              {filters.tab === "" ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-iris px-2 py-0.5 text-[10.5px] font-bold text-white shadow-xs">
                  ● {t("tabAll")}
                </span>
              ) : (
                <span className="text-[11px] text-faint hover:text-fg">{t("filter")}</span>
              )}
            </div>
          </div>

          {/* Card 2: Active Orders */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => filters.setTab(filters.tab === "active" ? "" : "active")}
            className={cn(
              "rounded-2xl border border-line bg-surface p-4 shadow-xs flex items-center justify-between gap-3.5 cursor-pointer select-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-lg",
              filters.tab === "active"
                ? "ring-2 ring-good border-good bg-good-soft/25 shadow-md"
                : "hover:border-line-2"
            )}
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-good-soft text-good font-semibold text-xl">
                ✓
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted truncate">{t("active")}</div>
                <div className="font-mono text-[22px] font-bold text-good tabular">{stats.active} <span className="text-[11.5px] font-normal text-muted">{t("unit")}</span></div>
              </div>
            </div>
            <div className="text-right shrink-0">
              {filters.tab === "active" ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-good px-2 py-0.5 text-[10.5px] font-bold text-white shadow-xs">
                  ● {t("filtering")}
                </span>
              ) : (
                <span className="text-[11px] text-faint hover:text-fg">{t("filter")}</span>
              )}
            </div>
          </div>

          {/* Card 3: Disputed Orders */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => filters.setTab(filters.tab === "disputed" ? "" : "disputed")}
            className={cn(
              "rounded-2xl border border-line bg-surface p-4 shadow-xs flex items-center justify-between gap-3.5 cursor-pointer select-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-lg",
              filters.tab === "disputed"
                ? "ring-2 ring-bad border-bad bg-bad-soft/25 shadow-md"
                : "hover:border-line-2"
            )}
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-bad-soft text-bad font-semibold text-xl">
                ⚠️
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted truncate">{t("disputed")}</div>
                <div className="font-mono text-[22px] font-bold text-bad tabular">{stats.disputed} <span className="text-[11.5px] font-normal text-muted">{t("unit")}</span></div>
              </div>
            </div>
            <div className="text-right shrink-0">
              {filters.tab === "disputed" ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-bad px-2 py-0.5 text-[10.5px] font-bold text-white shadow-xs">
                  ● {t("filtering")}
                </span>
              ) : (
                <span className="text-[11px] text-faint hover:text-fg">{t("filter")}</span>
              )}
            </div>
          </div>

          {/* Card 4: Total Spent */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              filters.clear();
              filters.setTab("");
            }}
            className={cn(
              "rounded-2xl border border-line bg-surface p-4 shadow-xs flex items-center justify-between gap-3.5 cursor-pointer select-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-lg hover:border-line-2"
            )}
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-raised text-iris font-semibold text-xl">
                💳
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted truncate">{t("spent")}</div>
                <div className="font-mono text-[20px] font-bold text-fg tabular truncate">
                  {formatBrowseMoney(stats.total_spend, { locale })}
                </div>
              </div>
            </div>
            <div className="text-right shrink-0">
              {filters.hasFilters ? (
                <span className="text-[11px] font-medium text-iris hover:underline">
                  {t("reset")}
                </span>
              ) : (
                <span className="text-[11px] text-faint">{t("spent")}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* FILTER & SEARCH TOOLBAR */}
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs space-y-4">
        {/* Status Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { key: "", label: t("tabAll"), count: stats?.total },
              { key: "active", label: t("tabActive"), count: stats?.active },
              { key: "disputed", label: t("tabDisputed"), count: stats?.disputed },
              { key: "deleted", label: t("tabDeleted"), count: undefined },
            ].map((tab) => {
              const isActive = filters.tab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => filters.setTab(tab.key)}
                  className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[12.5px] font-medium transition-all cursor-pointer ${
                    isActive
                      ? "bg-iris text-white shadow-xs font-semibold"
                      : "text-muted hover:text-fg hover:bg-raised/60"
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.count != null && (
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10.5px] font-mono ${
                        isActive ? "bg-white/25 text-white" : "bg-raised text-muted"
                      }`}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="text-[12px] text-muted tabular">
            {t("showingCount", { count: orders.length, total })}
          </div>
        </div>

        {/* Search Inputs (Flex Responsive Layout - Zero Overflow) */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              type="text"
              value={filters.search}
              onChange={(e) => filters.setSearch(e.target.value)}
              placeholder={t("searchFullPlaceholder")}
              className="w-full rounded-xl border border-line bg-canvas pl-9 pr-8 py-2 text-[13px] text-fg placeholder:text-faint focus:border-iris focus:outline-none focus:ring-2 focus:ring-iris/20"
            />
            {filters.search && (
              <button
                onClick={() => filters.setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-fg p-0.5"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => filters.setDateFrom(e.target.value)}
                aria-label={t("filterDateFrom")}
                className="rounded-xl border border-line bg-canvas px-3 py-2 text-[12px] text-fg focus:border-iris focus:outline-none"
              />
              <span className="text-faint text-[12px]">–</span>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => filters.setDateTo(e.target.value)}
                aria-label={t("filterDateTo")}
                className="rounded-xl border border-line bg-canvas px-3 py-2 text-[12px] text-fg focus:border-iris focus:outline-none"
              />
            </div>

            <select
              value={filters.sort}
              onChange={(e) => filters.setSort(e.target.value)}
              className="rounded-xl border border-line bg-canvas px-3 py-2 text-[12px] text-fg focus:border-iris focus:outline-none cursor-pointer"
            >
              <option value="newest">{t("sortNewest")}</option>
              <option value="oldest">{t("sortOldest")}</option>
              <option value="amount_desc">{t("sortAmountDesc")}</option>
              <option value="amount_asc">{t("sortAmountAsc")}</option>
            </select>

            {filters.hasFilters && (
              <button
                onClick={filters.clear}
                title={t("clearFilters")}
                className="inline-flex items-center gap-1 rounded-xl border border-line bg-raised px-3 py-2 text-[12px] font-semibold text-muted hover:border-bad/30 hover:text-bad transition-colors cursor-pointer shrink-0"
              >
                <X size={13} />
                <span>{t("clearFilters")}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* FULL-WIDTH HIGH DENSITY TANSTACK-STYLE DATA TABLE */}
      {loading ? (
        <div className="rounded-2xl border border-line bg-surface p-12 text-center">
          <Spinner />
        </div>
      ) : orders.length === 0 ? (
        <Card className="p-12 flex flex-col items-center gap-3 text-center">
          <p className="text-[13.5px] text-muted">
            {filters.hasFilters || filters.tab !== "" ? t("emptyFiltered") : t("empty")}
          </p>
          {filters.hasFilters ? (
            <Button variant="secondary" size="sm" onClick={filters.clear}>
              {t("clearFilters")}
            </Button>
          ) : (
            <Link href="/">
              <Button size="sm">{t("explore")}</Button>
            </Link>
          )}
        </Card>
      ) : (
        <div className="rounded-2xl border border-line bg-surface shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-raised/70 border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted whitespace-nowrap">
                <tr>
                  <th className="py-3.5 pl-4 pr-3 w-36">{t("quickActions")}</th>
                  <th className="py-3.5 px-3 w-32">{t("orderCode")}</th>
                  <th className="py-3.5 px-3">{t("productPackage")}</th>
                  <th className="py-3.5 px-3 text-center w-24">{t("quantity")}</th>
                  <th className="py-3.5 px-3 text-right w-36">{t("payment")}</th>
                  <th className="py-3.5 px-4 text-right w-44">{t("statusEscrow")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((o) => {
                  const st = displayOrderStatus(o, locale);
                  const money = formatOrderHistoryMoney(o.total_amount, o.display_fx_rate_snapshot, { locale });
                  const hasDeliveredData = !!o.delivered_data;
                  const isDelivered = o.status === "delivered" || o.status === "completed";
                  const isDisputed = hasOpenDispute(o);

                  return (
                    <tr
                      key={o.id}
                      onClick={() => setSelectedOrder(o)}
                      className="hover:bg-iris-soft/15 transition-colors group cursor-pointer"
                    >
                      {/* QUICK ACTION ICONS */}
                      <td className="py-3.5 pl-4 pr-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          {/* Quick-view Modal button */}
                          <button
                            title={t("viewOrderDetails")}
                            onClick={() => setSelectedOrder(o)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-iris-soft text-iris hover:bg-iris hover:text-white transition-colors cursor-pointer"
                          >
                            <Eye size={15} />
                          </button>

                          {/* Download TXT */}
                          {hasDeliveredData && (
                            <button
                              title={t("downloadTxtHint")}
                              onClick={() => handleDownload(o)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-muted hover:bg-line hover:text-fg transition-colors cursor-pointer"
                            >
                              <Download size={14} />
                            </button>
                          )}

                          {/* Copy All */}
                          {hasDeliveredData && (
                            <button
                              title={t("copyAllData")}
                              onClick={() => handleCopyAll(o)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-muted hover:bg-line hover:text-fg transition-colors cursor-pointer"
                            >
                              {copiedOrderId === o.id ? <Check size={14} className="text-good" /> : <Copy size={14} />}
                            </button>
                          )}

                          {/* Dispute Button */}
                          {canOpenDispute(o.status, o.escrow_expires_at) && !isDisputed && (
                            <button
                              title={o.variant_name ? t("disputePackageTitle", { name: o.variant_name }) : t("disputeThisOrder")}
                              onClick={() => {
                                setDisputeTarget({
                                  orderId: o.id,
                                  order: o,
                                  variantName: o.variant_name,
                                  initialReason: o.variant_name ? t("reasonPackagePrefix", { name: o.variant_name }) : "",
                                });
                              }}
                              className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-muted hover:bg-bad-soft hover:text-bad transition-colors cursor-pointer"
                            >
                              <AlertTriangle size={13} />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* ORDER ID & DATE */}
                      <td className="py-3.5 px-3">
                        <div className="font-mono font-bold text-iris text-[13.5px]">#{o.id}</div>
                        <div className="text-[11px] text-muted mt-0.5 whitespace-nowrap">
                          {formatDateTime(o.created_at, locale)}
                        </div>
                      </td>

                      {/* PRODUCT TITLE & VARIANT */}
                      <td className="py-3.5 px-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <ProductCover coverId={parseCoverId(o)} title={o.product_title ?? "??"} className="h-8 w-8 rounded-lg shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold text-fg group-hover:text-iris transition-colors line-clamp-1">
                              {o.product_title ?? tc("orderNumber", { id: o.id })}
                            </div>
                            <div className="text-[11.5px] text-muted line-clamp-1 mt-0.5">
                              {o.variant_name ? (
                                <span className="font-medium text-fg/80 bg-raised/80 px-1.5 py-0.2 rounded border border-line mr-1.5">
                                  {t("packageNamed", { name: o.variant_name })}
                                </span>
                              ) : null}
                              <span>{tc("qty", { count: o.quantity })}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* QUANTITY */}
                      <td className="py-3.5 px-3 text-center">
                        <span
                          className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 font-mono text-[12px] font-bold ${
                            o.quantity >= 1000
                              ? "bg-iris-soft text-iris border border-iris/30"
                              : "bg-raised text-fg"
                          }`}
                        >
                          x{o.quantity.toLocaleString()}
                        </span>
                      </td>

                      {/* AMOUNT */}
                      <td className="py-3.5 px-3 text-right">
                        <div className="font-mono font-bold text-[13.5px] text-fg tabular">
                          {money.text}
                        </div>
                      </td>

                      {/* STATUS & ESCROW */}
                      <td className="py-3.5 px-4 text-right">
                        <Tag tone={st.tone}>{st.label}</Tag>
                        {o.escrow_expires_at && o.status === "delivered" && (
                          <div className="text-[11px] text-iris-hi flex items-center justify-end gap-1 mt-1 font-medium">
                            <ShieldCheck size={12} className="text-good" />
                            <span>{t("escrowUntil", { date: formatDate(o.escrow_expires_at, locale) })}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PAGINATION CONTROLS */}
      {!loading && total > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <span className="text-[12px] text-muted tabular">
            {t("showing", {
              from: (filters.page - 1) * filters.perPage + 1,
              to: Math.min(filters.page * filters.perPage, total),
              total,
            })}
          </span>

          <div className="flex items-center gap-3">
            <Pagination page={filters.page} totalPages={totalPages} onChange={filters.setPage} />

            <select
              value={filters.perPage}
              onChange={(e) => filters.setPerPage(Number(e.target.value))}
              aria-label={t("perPageAria")}
              className="h-8 rounded-xl bg-surface border border-line px-2.5 text-[12px] text-fg cursor-pointer focus:outline-none focus:border-iris"
            >
              {PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {tc("perPage", { n })}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
