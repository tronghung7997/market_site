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
  ArrowUpDown,
  Filter,
  Star,
} from "lucide-react";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { canOpenDispute, displayOrderStatus, hasOpenDispute } from "@/lib/order-status";
import { formatDate, formatDateTime, daysAgo } from "@/lib/utils";
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
  const isOrderDeepLink =
    Boolean(searchParams.get("order_id") || searchParams.get("order")) ||
    Boolean(searchParams.get("resources"));
  const initialSearch = isOrderDeepLink ? "" : (searchParams.get("search") ?? "");

  const filters = useOrderFilters(
    searchParams.get("status") ?? "",
    initialSearch,
    searchParams.get("date_from") ?? "",
    searchParams.get("date_to") ?? "",
    searchParams.get("sort") ?? "newest",
  );

  const queryClient = useQueryClient();
  const ordersQuery = useOrders(filters.params, !authLoading && !!account, account?.id);
  const statsQuery = useOrderStats(!authLoading && !!account, account?.id);
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
  const [copiedCodeId, setCopiedCodeId] = useState<number | null>(null);
  const highlightResourceIds = useMemo(
    () => parseHighlightedResourceIds(searchParams.get("resources")),
    [searchParams],
  );
  const autoOpened = useRef(false);
  const targetOrderIdFromUrl = useMemo(() => {
    const rawOrderId = Number(searchParams.get("order_id") || searchParams.get("order"));
    if (Number.isInteger(rawOrderId) && rawOrderId > 0) return rawOrderId;
    const resources = searchParams.get("resources");
    const rawSearch = (searchParams.get("search") || "").replace(/^#/, "").trim();
    const searchId = Number(rawSearch);
    if (resources && Number.isInteger(searchId) && searchId > 0) return searchId;
    if (searchParams.get("search")?.startsWith("#") && Number.isInteger(searchId) && searchId > 0) return searchId;
    return 0;
  }, [searchParams]);
  const initialTargetOrderId = useRef<number>(0);
  if (initialTargetOrderId.current === 0 && targetOrderIdFromUrl > 0) {
    initialTargetOrderId.current = targetOrderIdFromUrl;
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (filters.tab) sp.set("status", filters.tab);
    else sp.delete("status");

    if (filters.debouncedSearch.trim()) sp.set("search", filters.debouncedSearch.trim());
    else if (!isOrderDeepLink) sp.delete("search");

    if (selectedOrder) {
      sp.set("order_id", String(selectedOrder.id));
    } else if (autoOpened.current) {
      sp.delete("order_id");
      sp.delete("order");
    }

    if (filters.dateFrom) sp.set("date_from", filters.dateFrom);
    else sp.delete("date_from");

    if (filters.dateTo) sp.set("date_to", filters.dateTo);
    else sp.delete("date_to");

    if (filters.sort && filters.sort !== "newest") sp.set("sort", filters.sort);
    else sp.delete("sort");

    if (filters.page > 1) sp.set("page", String(filters.page));
    else sp.delete("page");

    const newQuery = sp.toString();
    const newUrl = `${window.location.pathname}${newQuery ? `?${newQuery}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", newUrl);
  }, [filters.tab, filters.debouncedSearch, filters.dateFrom, filters.dateTo, filters.sort, filters.page, selectedOrder, isOrderDeepLink]);

  const handlePlate = useCallback((id: number) => {
    setPlateOrders((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const handleDelivered = useCallback(
    (id: number, deliveredData: string) => {
      queryClient.setQueryData<PaginatedOrderResponse>(
        queryKeys.orders(filters.params as Record<string, unknown>, account?.id),
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
    [queryClient, filters.params, selectedOrder?.id, account?.id],
  );

  const [extraHighlightResourceIds, setExtraHighlightResourceIds] = useState<number[]>([]);

  useEffect(() => {
    if (authLoading) return;
    if (!account) router.push("/login");
  }, [account, authLoading, router]);

  useEffect(() => {
    if (autoOpened.current || authLoading || !account) return;
    const effectiveId = initialTargetOrderId.current || targetOrderIdFromUrl;
    if (effectiveId > 0) {
      const match = orders.find((row) => row.id === effectiveId);
      if (match) {
        autoOpened.current = true;
        setSelectedOrder(match);
      } else if (!loading) {
        autoOpened.current = true;
        api.getOrder(effectiveId).then((fetched) => {
          if (fetched) setSelectedOrder(fetched);
        }).catch(() => {});
      }
    }
  }, [account, authLoading, loading, orders, targetOrderIdFromUrl]);

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

        const targetId =
          Number(url.searchParams.get("order_id") || url.searchParams.get("order")) ||
          Number((url.searchParams.get("search") || "").replace(/^#/, "").trim());
        const resourcesParam = url.searchParams.get("resources");
        if (resourcesParam) {
          setExtraHighlightResourceIds(parseHighlightedResourceIds(resourcesParam));
        }

        if (Number.isInteger(targetId) && targetId > 0) {
          const match = orders.find((row) => row.id === targetId);
          if (match) {
            setSelectedOrder(match);
          } else {
            const fetched = await api.getOrder(targetId);
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
        queryKeys.orders(filters.params as Record<string, unknown>, account?.id),
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
        queryKeys.orders(filters.params as Record<string, unknown>, account?.id),
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

  const handleCopyCode = (id: number) => {
    navigator.clipboard.writeText(`#${id}`);
    setCopiedCodeId(id);
    showToast(t("copiedOrderCode"));
    setTimeout(() => setCopiedCodeId(null), 2000);
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

  const handleCloseOrderModal = useCallback(() => {
    const currentId = selectedOrder?.id;
    setSelectedOrder(null);
    setExtraHighlightResourceIds([]);
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      let changed = false;
      if (sp.has("order_id")) {
        sp.delete("order_id");
        changed = true;
      }
      if (sp.has("order")) {
        sp.delete("order");
        changed = true;
      }
      if (sp.has("resources")) {
        sp.delete("resources");
        if (
          currentId &&
          sp.has("search") &&
          (sp.get("search") === String(currentId) || sp.get("search") === `#${currentId}`)
        ) {
          sp.delete("search");
        }
        changed = true;
      }
      if (changed) {
        const newQuery = sp.toString();
        const newUrl = `${window.location.pathname}${newQuery ? `?${newQuery}` : ""}${window.location.hash}`;
        window.history.replaceState(null, "", newUrl);
      }
    }
  }, [selectedOrder?.id]);

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
          onClose={handleCloseOrderModal}
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
        <>
          {/* Mobile Horizontal Carousel (sm:hidden) */}
          <div className="sm:hidden flex items-stretch gap-2.5 overflow-x-auto pb-1.5 -mx-4 px-4 scrollbar-none snap-x snap-mandatory">
            {/* Card 1: Total Orders */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => filters.setTab("")}
              className={cn(
                "min-w-[135px] max-w-[160px] flex-1 shrink-0 snap-start rounded-2xl border bg-surface p-3 cursor-pointer select-none transition-all shadow-xs flex flex-col justify-between",
                filters.tab === ""
                  ? "ring-2 ring-iris border-iris bg-iris-soft/25 shadow-sm"
                  : "border-line hover:border-line-2"
              )}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-iris-soft text-iris text-sm">
                  📦
                </div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted truncate">
                  {t("totalOrders")}
                </div>
              </div>
              <div className="mt-2.5 flex items-baseline justify-between gap-1">
                <div className="font-mono text-[19px] font-bold text-fg tabular">
                  {stats.total} <span className="text-[11px] font-normal text-muted">{t("unit")}</span>
                </div>
                {filters.tab === "" && (
                  <span className="rounded bg-iris px-1.5 py-0.2 text-[9.5px] font-bold text-white">
                    ●
                  </span>
                )}
              </div>
            </div>

            {/* Card 2: Active Orders */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => filters.setTab(filters.tab === "active" ? "" : "active")}
              className={cn(
                "min-w-[135px] max-w-[160px] flex-1 shrink-0 snap-start rounded-2xl border bg-surface p-3 cursor-pointer select-none transition-all shadow-xs flex flex-col justify-between",
                filters.tab === "active"
                  ? "ring-2 ring-good border-good bg-good-soft/25 shadow-sm"
                  : "border-line hover:border-line-2"
              )}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-good-soft text-good font-semibold text-sm">
                  ✓
                </div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted truncate">
                  {t("tabActive")}
                </div>
              </div>
              <div className="mt-2.5 flex items-baseline justify-between gap-1">
                <div className="font-mono text-[19px] font-bold text-good tabular">
                  {stats.active} <span className="text-[11px] font-normal text-muted">{t("unit")}</span>
                </div>
                {filters.tab === "active" && (
                  <span className="rounded bg-good px-1.5 py-0.2 text-[9.5px] font-bold text-white">
                    ●
                  </span>
                )}
              </div>
            </div>

            {/* Card 3: Disputed Orders */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => filters.setTab(filters.tab === "disputed" ? "" : "disputed")}
              className={cn(
                "min-w-[135px] max-w-[160px] flex-1 shrink-0 snap-start rounded-2xl border bg-surface p-3 cursor-pointer select-none transition-all shadow-xs flex flex-col justify-between",
                filters.tab === "disputed"
                  ? "ring-2 ring-bad border-bad bg-bad-soft/25 shadow-sm"
                  : "border-line hover:border-line-2"
              )}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bad-soft text-bad text-sm">
                  ⚠️
                </div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted truncate">
                  {t("disputed")}
                </div>
              </div>
              <div className="mt-2.5 flex items-baseline justify-between gap-1">
                <div className="font-mono text-[19px] font-bold text-bad tabular">
                  {stats.disputed} <span className="text-[11px] font-normal text-muted">{t("unit")}</span>
                </div>
                {filters.tab === "disputed" && (
                  <span className="rounded bg-bad px-1.5 py-0.2 text-[9.5px] font-bold text-white">
                    ●
                  </span>
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
                "min-w-[135px] max-w-[160px] flex-1 shrink-0 snap-start rounded-2xl border border-line bg-surface p-3 cursor-pointer select-none transition-all shadow-xs flex flex-col justify-between hover:border-line-2"
              )}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-raised text-iris text-sm">
                  💳
                </div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted truncate">
                  {t("spent")}
                </div>
              </div>
              <div className="mt-2.5 flex items-baseline justify-between gap-1">
                <div className="font-mono text-[16px] font-bold text-fg tabular truncate">
                  {formatBrowseMoney(stats.total_spend, { locale })}
                </div>
              </div>
            </div>
          </div>

          {/* Desktop/Tablet Grid (hidden sm:grid) */}
          <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
        </>
      )}

      {/* FILTER & SEARCH TOOLBAR */}
      <div className="rounded-2xl border border-line bg-surface p-3.5 sm:p-4 shadow-xs space-y-3.5">
        {/* Status Pills */}
        <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none -mx-1 px-1 py-0.5">
            {[
              { key: "", label: t("tabAll"), count: stats?.total },
              { key: "active", label: t("tabActive"), count: stats?.active },
              { key: "disputed", label: t("tabDisputed"), count: stats?.disputed },
              { key: "deleted", label: t("tabDeleted"), count: stats?.cancelled_or_refunded },
            ].map((tab) => {
              const isActive = filters.tab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => filters.setTab(tab.key)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 sm:px-3.5 py-1.5 text-[12px] sm:text-[12.5px] font-medium transition-all cursor-pointer shrink-0 ${
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

          <div className="hidden sm:block text-[12px] text-muted tabular shrink-0">
            {t("showingCount", { count: orders.length, total })}
          </div>
        </div>

        {/* Search Inputs (Flex Responsive Layout - Zero Overflow) */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
            <div className="relative w-full min-w-0 flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                type="text"
                value={filters.search}
                onChange={(e) => filters.setSearch(e.target.value)}
                placeholder={t("searchFullPlaceholder")}
                className="w-full rounded-xl border border-line bg-canvas pl-9 pr-24 sm:pr-28 py-2 text-[13px] text-fg placeholder:text-faint focus:border-iris focus:outline-none focus:ring-2 focus:ring-iris/20"
              />
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                {filters.isExactIdSearch && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-iris/15 px-1.5 py-0.5 text-[10.5px] font-bold text-iris">
                    ● {t("exactIdMatch")}
                  </span>
                )}
                {filters.search && (
                  <button
                    onClick={filters.clearSearch}
                    aria-label={t("clearSearch")}
                    className="text-faint hover:text-fg p-0.5 rounded transition-colors cursor-pointer"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              {/* Date Presets Quick Pills */}
              <div className="flex items-center gap-1 rounded-xl border border-line bg-canvas p-0.5 overflow-x-auto scrollbar-none">
                {[
                  { key: "all", label: t("filterAllTime") },
                  { key: "today", label: t("filterToday") },
                  { key: "7d", label: t("filter7Days") },
                  { key: "30d", label: t("filter30Days") },
                ].map((p) => {
                  const isCurrent = filters.activeDatePreset === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => filters.setDatePreset(p.key as any)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer shrink-0",
                        isCurrent
                          ? "bg-iris text-white shadow-xs font-semibold"
                          : "text-muted hover:text-fg hover:bg-raised"
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {/* Custom Date Range Picker */}
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => filters.setDateFrom(e.target.value)}
                  aria-label={t("filterDateFrom")}
                  className="flex-1 sm:flex-none rounded-xl border border-line bg-canvas px-2.5 py-1.5 text-[12px] text-fg focus:border-iris focus:outline-none"
                />
                <span className="text-faint text-[12px]">–</span>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => filters.setDateTo(e.target.value)}
                  aria-label={t("filterDateTo")}
                  className="flex-1 sm:flex-none rounded-xl border border-line bg-canvas px-2.5 py-1.5 text-[12px] text-fg focus:border-iris focus:outline-none"
                />
              </div>

              {/* Sort Dropdown */}
              <select
                value={filters.sort}
                onChange={(e) => filters.setSort(e.target.value)}
                aria-label={tc("sort")}
                className="w-full sm:w-auto rounded-xl border border-line bg-canvas px-3 py-1.5 text-[12px] text-fg focus:border-iris focus:outline-none cursor-pointer"
              >
                <option value="newest">{t("sortNewest")}</option>
                <option value="oldest">{t("sortOldest")}</option>
                <option value="amount_desc">{t("sortAmountDesc")}</option>
                <option value="amount_asc">{t("sortAmountAsc")}</option>
              </select>
            </div>
          </div>

          {/* Active Filter Chips Bar */}
          {filters.hasFilters && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-line/60 text-[12px]">
              <span className="text-faint text-[11px] font-medium mr-1 flex items-center gap-1">
                <Filter size={11} />
                {t("filtering")}:
              </span>
              {filters.tab && (
                <span className="inline-flex items-center gap-1 rounded-lg border border-iris/30 bg-iris-soft/50 px-2 py-0.5 text-[11.5px] font-medium text-iris-hi">
                  <span>
                    {filters.tab === "active"
                      ? t("tabActive")
                      : filters.tab === "disputed"
                      ? t("tabDisputed")
                      : filters.tab === "deleted"
                      ? t("tabDeleted")
                      : filters.tab}
                  </span>
                  <button
                    type="button"
                    onClick={() => filters.setTab("")}
                    className="hover:text-fg ml-0.5"
                  >
                    <X size={11} />
                  </button>
                </span>
              )}
              {filters.search && (
                <span className="inline-flex items-center gap-1 rounded-lg border border-line bg-raised px-2 py-0.5 text-[11.5px] font-medium text-fg">
                  <span>{t("activeFilterSearch", { query: filters.search })}</span>
                  <button
                    type="button"
                    onClick={filters.clearSearch}
                    className="text-faint hover:text-fg ml-0.5"
                  >
                    <X size={11} />
                  </button>
                </span>
              )}
              {(filters.dateFrom || filters.dateTo) && (
                <span className="inline-flex items-center gap-1 rounded-lg border border-line bg-raised px-2 py-0.5 text-[11.5px] font-medium text-fg">
                  <span>
                    {t("activeFilterDate", {
                      range: `${filters.dateFrom || "..."} → ${filters.dateTo || "..."}`,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={filters.clearDates}
                    className="text-faint hover:text-fg ml-0.5"
                  >
                    <X size={11} />
                  </button>
                </span>
              )}
              {filters.sort !== "newest" && (
                <span className="inline-flex items-center gap-1 rounded-lg border border-line bg-raised px-2 py-0.5 text-[11.5px] font-medium text-fg">
                  <span>
                    {filters.sort === "oldest"
                      ? t("sortOldest")
                      : filters.sort === "amount_desc"
                      ? t("sortAmountDesc")
                      : filters.sort === "amount_asc"
                      ? t("sortAmountAsc")
                      : filters.sort}
                  </span>
                  <button
                    type="button"
                    onClick={() => filters.setSort("newest")}
                    className="text-faint hover:text-fg ml-0.5"
                  >
                    <X size={11} />
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={filters.clear}
                className="text-iris hover:underline text-[11.5px] font-medium ml-1 cursor-pointer"
              >
                {t("clearAll")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Smooth fetching progress line */}
      {ordersQuery.isFetching && !loading && (
        <div className="h-0.5 w-full bg-iris/20 overflow-hidden rounded-full -mt-2">
          <div className="h-full bg-iris animate-pulse w-full" />
        </div>
      )}

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
        <>
          {/* MOBILE ORDER CARDS (Dedicated touch-friendly layout, zero truncation) */}
          <div className="block md:hidden space-y-3">
            {orders.map((o) => {
              const st = displayOrderStatus(o, locale);
              const money = formatOrderHistoryMoney(o.total_amount, o.display_fx_rate_snapshot, { locale });
              const hasDeliveredData = !!o.delivered_data;
              const isDisputed = hasOpenDispute(o);
              const timeAgo = daysAgo(o.created_at, locale);
              const exactDate = formatDateTime(o.created_at, locale);
              const canDispute = canOpenDispute(o.status, o.escrow_expires_at);

              const borderAccent =
                isDisputed
                  ? "border-l-bad"
                  : o.status === "completed"
                  ? "border-l-iris"
                  : o.status === "delivered"
                  ? "border-l-good"
                  : o.status === "cancelled" || o.status === "refunded"
                  ? "border-l-line"
                  : "border-l-warn";

              return (
                <div
                  key={o.id}
                  className={cn(
                    "rounded-2xl border border-line bg-surface p-4 shadow-xs border-l-4 transition-all hover:shadow-card-md",
                    borderAccent
                  )}
                >
                  {/* Top Line: Order #ID + Copy code + Date + Status */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => setSelectedOrder(o)}
                        className="font-mono font-bold text-iris text-[14.5px] hover:underline cursor-pointer"
                      >
                        #{o.id}
                      </button>
                      <button
                        type="button"
                        title={copiedCodeId === o.id ? t("copiedOrderCode", { code: `#${o.id}` }) : t("copyOrderCode")}
                        onClick={() => handleCopyCode(o.id)}
                        className="p-1 rounded-md text-muted hover:text-fg hover:bg-raised transition-colors cursor-pointer"
                      >
                        {copiedCodeId === o.id ? (
                          <Check size={13} className="text-good" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11.5px] text-muted whitespace-nowrap" title={exactDate}>
                        {timeAgo}
                      </span>
                      <Tag tone={st.tone}>{st.label}</Tag>
                    </div>
                  </div>

                  {/* Product Details Row */}
                  <div
                    onClick={() => setSelectedOrder(o)}
                    className="mt-3 flex items-start gap-3 cursor-pointer group"
                  >
                    <ProductCover
                      coverId={parseCoverId(o)}
                      title={o.product_title ?? "??"}
                      className="h-11 w-11 rounded-xl shrink-0 mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-[13.5px] text-fg leading-snug group-hover:text-iris transition-colors break-words">
                        {o.product_title ?? tc("orderNumber", { id: o.id })}
                      </h3>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[12px] text-muted">
                        {o.variant_name && (
                          <span className="font-medium text-fg/80 bg-raised px-2 py-0.5 rounded-md border border-line text-[11px] break-all">
                            {t("packageNamed", { name: o.variant_name })}
                          </span>
                        )}
                        <span className="font-mono text-fg font-medium">
                          {tc("qty", { count: o.quantity })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Guarantees & Status Alerts */}
                  {o.escrow_expires_at && o.status === "delivered" && (
                    <div className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-good font-medium bg-good-soft/30 border border-good/20 rounded-lg px-2.5 py-1">
                      <ShieldCheck size={13} className="shrink-0 text-good" />
                      <span>{t("escrowUntil", { date: formatDate(o.escrow_expires_at, locale) })}</span>
                    </div>
                  )}

                  {isDisputed && (
                    <div className="mt-2.5 flex items-center justify-between gap-2 text-[11.5px] text-bad font-medium bg-bad-soft/40 border border-bad/25 rounded-lg px-2.5 py-1">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={13} className="shrink-0" />
                        <span>{t("tabDisputed")}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedOrder(o)}
                        className="underline text-bad hover:text-bad font-semibold cursor-pointer"
                      >
                        {t("disputeViewCase")}
                      </button>
                    </div>
                  )}

                  {/* Price & Divider */}
                  <div className="mt-3 pt-2.5 border-t border-line/70 flex items-center justify-between">
                    <div className="text-[12px] text-muted flex items-center gap-1.5">
                      <span>{t("payment")}:</span>
                      <span className="font-mono text-[15px] font-bold text-fg tabular">
                        {money.text}
                      </span>
                    </div>
                    {o.status === "completed" && (
                      o.has_review || reviewedOrders.has(o.id) ? (
                        <span className="flex items-center gap-1 text-[11.5px] text-good font-medium">
                          <Star size={12} className="fill-good text-good" /> {t("reviewed")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSelectedOrder(o)}
                          className="flex items-center gap-1 text-[11.5px] text-iris hover:underline font-medium cursor-pointer"
                        >
                          <Star size={12} /> {t("review")}
                        </button>
                      )
                    )}
                  </div>

                  {/* Action Buttons: Clear, Touch-friendly, No Cut-off */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedOrder(o)}
                      className="flex-1 min-w-[140px] min-h-[38px] rounded-xl bg-iris text-white text-[12.5px] font-semibold flex items-center justify-center gap-1.5 shadow-xs hover:bg-iris/90 active:scale-[0.98] transition-all cursor-pointer"
                    >
                      <Eye size={15} />
                      <span>{t("viewOrderDetails")}</span>
                    </button>

                    {hasDeliveredData && (
                      <button
                        type="button"
                        title={t("downloadTxtHint")}
                        onClick={() => handleDownload(o)}
                        className="min-h-[38px] px-3 rounded-xl border border-line bg-surface text-fg hover:bg-raised text-[12px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Download size={14} className="text-muted" />
                        <span>{t("downloadTxt")}</span>
                      </button>
                    )}

                    {hasDeliveredData && (
                      <button
                        type="button"
                        title={t("copyAllData")}
                        onClick={() => handleCopyAll(o)}
                        className="min-h-[38px] px-3 rounded-xl border border-line bg-surface text-fg hover:bg-raised text-[12px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        {copiedOrderId === o.id ? (
                          <>
                            <Check size={14} className="text-good" />
                            <span className="text-good">{t("copiedShort")}</span>
                          </>
                        ) : (
                          <>
                            <Copy size={14} className="text-muted" />
                            <span>{tc("copy")}</span>
                          </>
                        )}
                      </button>
                    )}

                    {canDispute && !isDisputed && (
                      <button
                        type="button"
                        title={o.variant_name ? t("disputePackageTitle", { name: o.variant_name }) : t("disputeThisOrder")}
                        onClick={() => {
                          setDisputeTarget({
                            orderId: o.id,
                            order: o,
                            variantName: o.variant_name,
                            initialReason: o.variant_name ? t("reasonPackagePrefix", { name: o.variant_name }) : "",
                          });
                        }}
                        className="min-h-[38px] px-3 rounded-xl border border-line bg-surface text-bad hover:bg-bad-soft text-[12px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <AlertTriangle size={13} />
                        <span>{t("openDispute")}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* FULL-WIDTH HIGH DENSITY TANSTACK-STYLE DATA TABLE (DESKTOP) */}
          <div className="hidden md:block rounded-2xl border border-line bg-surface shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-raised/70 border-b border-line text-[11px] font-semibold uppercase tracking-wider text-muted whitespace-nowrap">
                <tr>
                  <th className="py-3.5 pl-4 pr-3 w-36">{t("quickActions")}</th>
                  <th
                    className="py-3.5 px-3 w-36 cursor-pointer select-none hover:text-fg transition-colors"
                    onClick={() => filters.toggleSort("code")}
                    title={tc("sort")}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{t("orderCode")}</span>
                      {filters.sort === "newest" && <span className="text-iris font-bold">↓</span>}
                      {filters.sort === "oldest" && <span className="text-iris font-bold">↑</span>}
                      {filters.sort !== "newest" && filters.sort !== "oldest" && (
                        <ArrowUpDown size={11} className="text-faint opacity-60" />
                      )}
                    </div>
                  </th>
                  <th className="py-3.5 px-3">{t("productPackage")}</th>
                  <th className="py-3.5 px-3 text-center w-24">{t("quantity")}</th>
                  <th
                    className="py-3.5 px-3 text-right w-36 cursor-pointer select-none hover:text-fg transition-colors"
                    onClick={() => filters.toggleSort("amount")}
                    title={tc("sort")}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      {filters.sort === "amount_desc" && <span className="text-iris font-bold">↓</span>}
                      {filters.sort === "amount_asc" && <span className="text-iris font-bold">↑</span>}
                      {filters.sort !== "amount_desc" && filters.sort !== "amount_asc" && (
                        <ArrowUpDown size={11} className="text-faint opacity-60" />
                      )}
                      <span>{t("payment")}</span>
                    </div>
                  </th>
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
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-iris text-[13.5px]">#{o.id}</span>
                          <button
                            type="button"
                            title={copiedCodeId === o.id ? t("copiedOrderCode") : t("copyOrderCode")}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyCode(o.id);
                            }}
                            className="p-1 rounded text-muted hover:text-fg hover:bg-raised transition-colors cursor-pointer"
                          >
                            {copiedCodeId === o.id ? (
                              <Check size={12} className="text-good" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
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
      </>
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
