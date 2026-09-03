"use client";

import { useLocale, useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { displayOrderStatus } from "@/lib/order-status";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { Dispute, Order, Resource } from "@/lib/types";
import { useSearchParams } from "next/navigation";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import {
  Button,
  Card,
  CopyButton,
  Input,
  Monogram,
  Pagination,
  Select,
  Spinner,
  Tag,
  Textarea,
  Tooltip,
} from "@/components/ui";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  FileText,
  Inbox,
  Info,
  ListFilter,
  Package,
  Plus,
  RefreshCw,
  Rows,
  Search,
  ShieldCheck,
  Trash,
  Upload,
  X,
} from "@/components/Icons";
import { StatusTimeline } from "@/components/orders/OrderCardPrimitives";
import { DisputeCaseView } from "@/components/orders/DisputeCaseView";
import OrderChatButton from "@/components/chat/OrderChatButton";
import { deliveryResourceMarks, parseHighlightedResourceIds, resourceLabelMap, summarizeDisputeCase } from "@/lib/dispute-case";
import { DeliveryAccountBadge } from "@/components/orders/DeliveryAccountBadge";
import { SellerDisputeRemedyPanel } from "@/components/seller/SellerDisputeRemedyPanel";

const PAGE_SIZE = 20;

type FilterTab = "all" | "disputed" | "action_required" | "escrow" | "completed" | "cancelled";
type TimeFilter = "all" | "today" | "7d" | "30d";

function isOrderDisputed(o: Order, disp?: Dispute | null): boolean {
  if (o.status === "disputed") return true;
  if (o.protection?.status === "dispute_open") return true;
  if (disp) return disp.status === "open";
  return Boolean(o.has_dispute && o.status === "delivered");
}

function closedDisputeStatus(o: Order, disp?: Dispute | null): string | null {
  const status = disp?.status && disp.status !== "open" ? disp.status : o.dispute_status;
  if (!status || status === "open") return null;
  return status;
}

export default function SellerOrdersPage() {
  return (
    <Suspense fallback={<OrdersLoadingSkeleton />}>
      <SellerOrdersConsole />
    </Suspense>
  );
}

function OrdersLoadingSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-raised border border-line" />
        ))}
      </div>
      <div className="h-12 rounded-xl bg-raised border border-line" />
      <div className="h-96 rounded-xl bg-raised border border-line" />
    </div>
  );
}

function SellerOrdersConsole() {
  const t = useTranslations("seller");
  const td = useTranslations("status.dispute");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const searchParams = useSearchParams();

  const [orders, setOrders] = useState<Order[]>([]);
  const [disputes, setDisputes] = useState<Record<number, Dispute>>({});
  const [loading, setLoading] = useState(true);
  const [actingOrderId, setActingOrderId] = useState<number | null>(null);
  const hasLoadedRef = useRef(false);
  const modalOrderIdsRef = useRef<number[]>([]);

  // Filters & Search — initialized from URL ?tab=... if present
  const validTabs: FilterTab[] = ["all", "disputed", "action_required", "escrow", "completed", "cancelled"];
  const urlTab = searchParams.get("tab") as FilterTab | null;
  const [activeTab, setActiveTab] = useState<FilterTab>(
    urlTab && validTabs.includes(urlTab) ? urlTab : "all",
  );

  useEffect(() => {
    if (urlTab && validTabs.includes(urlTab)) {
      setActiveTab(urlTab);
    }
  }, [urlTab]);

  const urlSearch = searchParams.get("search") ?? "";
  const highlightResourceIds = useMemo(
    () => parseHighlightedResourceIds(searchParams.get("resources")),
    [searchParams],
  );
  const [search, setSearch] = useState(urlSearch);
  const [selectedProductTitle, setSelectedProductTitle] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [page, setPage] = useState(1);

  // Modals state
  const [activeDisputeOrder, setActiveDisputeOrder] = useState<Order | null>(null);
  const [activeDeliverOrder, setActiveDeliverOrder] = useState<Order | null>(null);
  const [activeDetailOrder, setActiveDetailOrder] = useState<Order | null>(null);
  const autoOpened = useRef(false);

  const loadData = useCallback(async () => {
    const showSkeleton = !hasLoadedRef.current;
    if (showSkeleton) setLoading(true);
    try {
      const list = await api.sellerOrders();
      setOrders(list);
      setActiveDisputeOrder((current) => (
        current ? list.find((row) => row.id === current.id) ?? current : current
      ));
      setActiveDetailOrder((current) => (
        current ? list.find((row) => row.id === current.id) ?? current : current
      ));

      const extraIds = new Set(modalOrderIdsRef.current);
      const candidateDisputedOrders = list.filter(
        (o) =>
          o.status === "disputed"
          || o.protection?.status === "dispute_open"
          || o.has_dispute
          || extraIds.has(o.id),
      );
      if (candidateDisputedOrders.length > 0) {
        const disputeEntries = await Promise.all(
          candidateDisputedOrders.map(async (o) => {
            try {
              const disp = await api.sellerDispute(o.id);
              return [o.id, disp] as const;
            } catch {
              return null;
            }
          }),
        );
        const map: Record<number, Dispute> = {};
        for (const entry of disputeEntries) {
          if (entry && entry[1]) map[entry[0]] = entry[1];
        }
        setDisputes(map);
      } else {
        setDisputes({});
      }
      hasLoadedRef.current = true;
    } catch {
      // ignore
    } finally {
      if (showSkeleton) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (urlSearch) setSearch(urlSearch);
  }, [urlSearch]);

  useEffect(() => {
    if (autoOpened.current || !orders.length) return;
    const query = (urlSearch || "").trim();
    if (!query && highlightResourceIds.length === 0) return;
    const asId = Number(query);
    const match = Number.isInteger(asId) && asId > 0
      ? orders.find((row) => row.id === asId)
      : null;
    if (!match) return;
    autoOpened.current = true;
    setActiveDetailOrder(match);
  }, [highlightResourceIds.length, orders, urlSearch]);

  useEffect(() => {
    const handleNotificationClick = async (event: Event) => {
      const customEvent = event as CustomEvent<{ href: string }>;
      const href = customEvent?.detail?.href;
      if (!href) return;

      try {
        const url = new URL(href, window.location.origin);
        if (!url.pathname.includes("/seller/orders")) return;

        const query = (url.searchParams.get("search") || "").trim();
        const asId = Number(query);
        if (Number.isInteger(asId) && asId > 0) {
          const match = orders.find((row) => row.id === asId);
          if (match) {
            setActiveDetailOrder(match);
          } else {
            const fetched = await api.getOrder(asId);
            if (fetched) setActiveDetailOrder(fetched);
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
  }, [orders]);

  // Actions
  const handleAccept = async (orderId: number) => {
    setActingOrderId(orderId);
    try {
      await api.sellerAcceptOrder(orderId);
      await loadData();
    } catch (err: unknown) {
      alert(apiErrorMessage(err, t("orderAcceptFailed")));
    } finally {
      setActingOrderId(null);
    }
  };

  const handleDeliverSuccess = async () => {
    setActiveDeliverOrder(null);
    await loadData();
  };

  modalOrderIdsRef.current = [activeDisputeOrder?.id, activeDetailOrder?.id].filter(
    (id): id is number => typeof id === "number",
  );

  const handleDisputeResponseSuccess = async () => {
    await loadData();
  };

  // KPI Metrics Calculation
  const disputedOrders = useMemo(
    () => orders.filter((o) => isOrderDisputed(o, disputes[o.id])),
    [orders, disputes],
  );
  const unrespondedDisputesCount = useMemo(() => {
    return disputedOrders.filter((o) => {
      const dispute = disputes[o.id];
      if (!dispute) return true;
      const summary = summarizeDisputeCase(dispute);
      if (summary.claimed > 0) return summary.pending > 0;
      return !dispute.seller_note;
    }).length;
  }, [disputedOrders, disputes]);

  const actionRequiredOrders = useMemo(() => {
    return orders.filter((o) => o.status === "pending" || o.status === "processing");
  }, [orders]);

  const escrowOrders = useMemo(() => {
    return orders.filter((o) => o.status === "delivered" && !isOrderDisputed(o, disputes[o.id]));
  }, [orders, disputes]);

  const completedOrders = useMemo(() => {
    return orders.filter((o) => o.status === "completed");
  }, [orders]);

  const cancelledOrders = useMemo(() => {
    return orders.filter((o) => o.status === "cancelled" || o.status === "refunded");
  }, [orders]);

  const totalSettledRevenue = useMemo(() => {
    return completedOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
  }, [completedOrders]);

  // Unique product titles for dropdown
  const uniqueProducts = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.product_title) set.add(o.product_title);
    }
    return Array.from(set).sort();
  }, [orders]);

  // Filtered orders
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const disp = disputes[o.id];
      const isDisputed = isOrderDisputed(o, disp);

      // 1. Tab filter
      if (activeTab === "disputed" && !isDisputed) return false;
      if (activeTab === "action_required" && o.status !== "pending" && o.status !== "processing") return false;
      if (activeTab === "escrow" && (o.status !== "delivered" || isDisputed)) return false;
      if (activeTab === "completed" && o.status !== "completed") return false;
      if (activeTab === "cancelled" && o.status !== "cancelled" && o.status !== "refunded") return false;

      // 2. Product filter
      if (selectedProductTitle !== "all" && o.product_title !== selectedProductTitle) {
        return false;
      }

      // 3. Time filter
      if (timeFilter !== "all") {
        const orderDate = new Date(o.created_at).getTime();
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        if (timeFilter === "today" && now - orderDate > oneDay) return false;
        if (timeFilter === "7d" && now - orderDate > 7 * oneDay) return false;
        if (timeFilter === "30d" && now - orderDate > 30 * oneDay) return false;
      }

      // 4. Search query
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const matchId = String(o.id).includes(q);
        const matchTitle = (o.product_title || "").toLowerCase().includes(q);
        const matchVariant = (o.variant_name || "").toLowerCase().includes(q);
        const matchBuyer = (o.buyer_email || "").toLowerCase().includes(q);
        if (!matchId && !matchTitle && !matchVariant && !matchBuyer) return false;
      }

      return true;
    });
  }, [orders, activeTab, selectedProductTitle, timeFilter, search]);

  // Pagination
  const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE);
  const paginatedOrders = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredOrders.slice(start, start + PAGE_SIZE);
  }, [filteredOrders, page]);

  // Export CSV
  const handleExportCsv = () => {
    if (filteredOrders.length === 0) {
      alert(t("ordersNoExport"));
      return;
    }
    const headers = ["Order_ID", "Created_At", "Product", "Variant", "Quantity", "Amount_VND", "Status", "Buyer_Email", "Delivered_Data"];
    const rowsCsv = filteredOrders.map((o) => [
      o.id,
      o.created_at,
      `"${(o.product_title || "").replace(/"/g, '""')}"`,
      `"${(o.variant_name || "").replace(/"/g, '""')}"`,
      o.quantity,
      o.total_amount,
      o.status,
      `"${(o.buyer_email || "").replace(/"/g, '""')}"`,
      `"${(o.delivered_data || "").replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(","), ...rowsCsv.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `seller_orders_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) return <OrdersLoadingSkeleton />;

  return (
    <div className="space-y-5 animate-fade">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-fg tracking-tight">{t("ordersTitle")}</h1>
          <p className="text-[12.5px] text-muted">
            {t("ordersSubtitle")} &bull;{" "}
            {t("ordersTotalCount", { count: orders.length })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={loadData} className="gap-1.5">
            <RefreshCw size={13} />
            <span>{t("refresh")}</span>
          </Button>
          <Link href="/seller/inventory">
            <Button size="sm" variant="secondary" className="gap-1.5">
              <Rows size={13} className="text-iris" />
              <span>{t("manageInventory")}</span>
            </Button>
          </Link>
          <Link href="/seller/products">
            <Button size="sm" variant="secondary" className="gap-1.5">
              <Package size={13} className="text-iris" />
              <span>{t("manageProducts")}</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* 4 Clickable Actionable KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* KPI 1: Disputes */}
        <Card
          onClick={() => {
            setActiveTab(activeTab === "disputed" ? "all" : "disputed");
            setPage(1);
          }}
          className={cn(
            "p-3.5 flex flex-col justify-between cursor-pointer transition-all border-bad/30 bg-bad-soft/20 hover:border-bad/60 hover:shadow-xs",
            activeTab === "disputed" && "ring-2 ring-bad/50 border-bad bg-bad-soft/40 shadow-xs"
          )}
        >
          <div className="flex items-center justify-between text-bad text-[12px] font-bold mb-1">
            <span className="flex items-center gap-1.5">
              {unrespondedDisputesCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-bad animate-ping inline-block" />
              )}
              <span>{t("disputesKpi")}</span>
            </span>
            <AlertCircle size={15} />
          </div>
          <div className="text-2xl font-bold font-mono tabular text-bad">
            {disputedOrders.length}{" "}
            <span className="text-xs font-normal text-muted font-sans">{t("orderUnit")}</span>
          </div>
          <div className="text-[11px] text-bad font-medium mt-1">
            {unrespondedDisputesCount > 0
              ? t("ordersDisputeUrgent", { count: unrespondedDisputesCount })
              : t("ordersDisputesAnswered")}
          </div>
        </Card>

        {/* KPI 2: Action Required (Pending + Processing) */}
        <Card
          onClick={() => {
            setActiveTab(activeTab === "action_required" ? "all" : "action_required");
            setPage(1);
          }}
          className={cn(
            "p-3.5 flex flex-col justify-between cursor-pointer transition-all border-warn/30 bg-warn-soft/20 hover:border-warn/60 hover:shadow-xs",
            activeTab === "action_required" && "ring-2 ring-warn/50 border-warn bg-warn-soft/40 shadow-xs"
          )}
        >
          <div className="flex items-center justify-between text-warn text-[12px] font-bold mb-1">
            <span>{t("actionRequiredKpi")}</span>
            <Clock size={15} />
          </div>
          <div className="text-2xl font-bold font-mono tabular text-warn">
            {actionRequiredOrders.length}{" "}
            <span className="text-xs font-normal text-muted font-sans">{t("orderUnit")}</span>
          </div>
          <div className="text-[11px] text-warn font-medium mt-1">{t("ordersActionHint")}</div>
        </Card>

        {/* KPI 3: Escrow / Warranty */}
        <Card
          onClick={() => {
            setActiveTab(activeTab === "escrow" ? "all" : "escrow");
            setPage(1);
          }}
          className={cn(
            "p-3.5 flex flex-col justify-between cursor-pointer transition-all hover:border-iris/50 hover:shadow-xs",
            activeTab === "escrow" && "ring-2 ring-iris/40 border-iris/50 bg-iris-soft/20 shadow-xs"
          )}
        >
          <div className="flex items-center justify-between text-muted text-[12px] font-medium mb-1">
            <span>{t("escrowKpi")}</span>
            <span className="text-iris">
              <ShieldCheck size={15} />
            </span>
          </div>
          <div className="text-2xl font-bold font-mono tabular text-fg">
            {escrowOrders.length}{" "}
            <span className="text-xs font-normal text-faint font-sans">{t("orderUnit")}</span>
          </div>
          <div className="text-[11px] text-faint font-medium mt-1">{t("ordersEscrowHint")}</div>
        </Card>

        {/* KPI 4: Completed & Settled Revenue */}
        <Card
          onClick={() => {
            setActiveTab(activeTab === "completed" ? "all" : "completed");
            setPage(1);
          }}
          className={cn(
            "p-3.5 flex flex-col justify-between cursor-pointer transition-all hover:border-good/50 hover:shadow-xs",
            activeTab === "completed" && "ring-2 ring-good/40 border-good/50 bg-good-soft/20 shadow-xs"
          )}
        >
          <div className="flex items-center justify-between text-muted text-[12px] font-medium mb-1">
            <span>{t("completedKpi")}</span>
            <span className="text-good">
              <CheckCircle2 size={15} />
            </span>
          </div>
          <div className="text-2xl font-bold font-mono tabular text-good">
            {completedOrders.length}{" "}
            <span className="text-xs font-normal text-muted font-sans">{t("orderUnit")}</span>
          </div>
          <div className="text-[11px] text-good font-mono font-medium mt-1 truncate">
            {formatBrowseMoney(totalSettledRevenue)}
          </div>
        </Card>
      </div>

      {/* FILTER CONSOLE & DATA GRID */}
      <Card className="p-0 overflow-hidden shadow-card-sm">
        {/* Top Faceted Filter Toolbar */}
        <div className="p-3 border-b border-line bg-raised/30 flex flex-col md:flex-row md:items-center justify-between gap-2.5">
          {/* Left: Search input */}
          <div className="relative flex-1 max-w-md w-full">
            <span className="absolute left-3 top-2.5 text-faint pointer-events-none">
              <Search size={13} />
            </span>
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t("searchOrders")}
              className="h-8.5 pl-8 pr-7 text-xs rounded-lg w-full bg-surface"
            />
            {search && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSearch("")}
                className="absolute right-1 top-1 h-6.5 w-6.5 p-0 text-faint hover:text-fg"
              >
                <X size={12} />
              </Button>
            )}
          </div>

          {/* Right: Clean horizontal controls bar */}
          <div className="flex items-center gap-2 text-xs flex-wrap sm:flex-nowrap shrink-0">
            {/* Product Facet Select */}
            {uniqueProducts.length > 0 && (
              <div className="relative w-44 sm:w-52">
                <Select
                  value={selectedProductTitle}
                  onChange={(e) => {
                    setSelectedProductTitle(e.target.value);
                    setPage(1);
                  }}
                  className="h-8.5 w-full text-xs pl-7 pr-6 rounded-lg truncate bg-surface"
                >
                  <option value="all">{t("allProducts")}</option>
                  {uniqueProducts.map((title) => (
                    <option key={title} value={title}>
                      {title}
                    </option>
                  ))}
                </Select>
                <ListFilter size={12} className="absolute left-2.5 top-2.5 text-muted pointer-events-none" />
              </div>
            )}

            {/* Time Filter Select */}
            <div className="w-32 sm:w-36">
              <Select
                value={timeFilter}
                onChange={(e) => {
                  setTimeFilter(e.target.value as TimeFilter);
                  setPage(1);
                }}
                className="h-8.5 w-full text-xs px-2.5 rounded-lg bg-surface"
              >
                <option value="all">{t("filterAllTime")}</option>
                <option value="today">{t("filterToday")}</option>
                <option value="7d">{t("filter7Days")}</option>
                <option value="30d">{t("filter30Days")}</option>
              </Select>
            </div>

            {/* Export CSV Button */}
            <Button
              size="sm"
              variant="secondary"
              onClick={handleExportCsv}
              disabled={filteredOrders.length === 0}
              className="h-8.5 text-xs gap-1.5 px-3 shrink-0"
            >
              <Download size={13} />
              <span>{t("exportCsvPlain")}</span>
            </Button>
          </div>
        </div>

        {/* Status Tabs Bar */}
        <div className="flex items-center px-3 border-b border-line bg-surface overflow-x-auto gap-1 text-xs py-1.5">
          <Button
            size="sm"
            variant={activeTab === "all" ? "secondary" : "ghost"}
            onClick={() => {
              setActiveTab("all");
              setPage(1);
            }}
            className={cn("h-7.5 px-3 text-xs gap-1.5 rounded-lg", activeTab === "all" && "bg-raised font-bold text-fg shadow-xs")}
          >
            <span>{t("allPlain")}</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-surface border border-line font-mono font-semibold text-faint">
              {orders.length}
            </span>
          </Button>

          <Button
            size="sm"
            variant={activeTab === "disputed" ? "secondary" : "ghost"}
            onClick={() => {
              setActiveTab("disputed");
              setPage(1);
            }}
            className={cn(
              "h-7.5 px-3 text-xs gap-1.5 rounded-lg text-bad hover:text-bad",
              activeTab === "disputed" && "bg-bad-soft/70 font-bold border border-bad/30"
            )}
          >
            <span>{t("disputeTab")}</span>
            <span className={cn(
              "px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold",
              disputedOrders.length > 0 ? "bg-bad-soft text-bad border border-bad/40" : "bg-surface border border-line text-faint"
            )}>
              {disputedOrders.length}
            </span>
          </Button>

          <Button
            size="sm"
            variant={activeTab === "action_required" ? "secondary" : "ghost"}
            onClick={() => {
              setActiveTab("action_required");
              setPage(1);
            }}
            className={cn(
              "h-7.5 px-3 text-xs gap-1.5 rounded-lg text-warn hover:text-warn",
              activeTab === "action_required" && "bg-warn-soft/70 font-bold border border-warn/30"
            )}
          >
            <span>{t("actionRequiredTab")}</span>
            <span className={cn(
              "px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold",
              actionRequiredOrders.length > 0 ? "bg-warn-soft text-warn border border-warn/40" : "bg-surface border border-line text-faint"
            )}>
              {actionRequiredOrders.length}
            </span>
          </Button>

          <Button
            size="sm"
            variant={activeTab === "escrow" ? "secondary" : "ghost"}
            onClick={() => {
              setActiveTab("escrow");
              setPage(1);
            }}
            className={cn("h-7.5 px-3 text-xs gap-1.5 rounded-lg", activeTab === "escrow" && "bg-raised font-bold text-fg shadow-xs")}
          >
            <span>{t("escrowTab")}</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-surface border border-line font-mono font-semibold text-faint">
              {escrowOrders.length}
            </span>
          </Button>

          <Button
            size="sm"
            variant={activeTab === "completed" ? "secondary" : "ghost"}
            onClick={() => {
              setActiveTab("completed");
              setPage(1);
            }}
            className={cn(
              "h-7.5 px-3 text-xs gap-1.5 rounded-lg text-good hover:text-good",
              activeTab === "completed" && "bg-good-soft/70 font-bold border border-good/30"
            )}
          >
            <span>{t("completedTab")}</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-surface border border-line font-mono font-semibold text-good">
              {completedOrders.length}
            </span>
          </Button>

          <Button
            size="sm"
            variant={activeTab === "cancelled" ? "secondary" : "ghost"}
            onClick={() => {
              setActiveTab("cancelled");
              setPage(1);
            }}
            className={cn("h-7.5 px-3 text-xs gap-1.5 rounded-lg", activeTab === "cancelled" && "bg-raised font-bold text-fg shadow-xs")}
          >
            <span>{t("cancelledTab")}</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-surface border border-line font-mono font-semibold text-faint">
              {cancelledOrders.length}
            </span>
          </Button>
        </div>

        {/* Data Grid */}
        {filteredOrders.length === 0 ? (
          <div className="py-12 px-4 text-center space-y-2">
            <Inbox size={36} className="mx-auto text-faint" />
            <p className="text-[13.5px] font-medium text-fg">{t("noMatchingOrders")}</p>
            <p className="text-xs text-muted">{t("ordersNoMatchHint")}</p>
          </div>
        ) : (
          <div className="overflow-hidden">
            <table className="w-full table-fixed text-left text-xs border-collapse">
              <thead>
                <tr className="bg-raised/40 text-faint text-[11px] font-semibold border-b border-line uppercase tracking-wide">
                  <th className="px-3 py-3 w-[6.5rem] whitespace-nowrap">{t("orderCode")}</th>
                  <th className="px-3 py-3">{t("productAndVariant")}</th>
                  <th className="px-3 py-3 w-[11rem]">{t("customer")}</th>
                  <th className="px-3 py-3 w-[5.25rem] font-mono">{t("amount")}</th>
                  <th className="px-3 py-3 w-[8.75rem] whitespace-nowrap">{t("statusAndDispute")}</th>
                  <th className="px-3 py-3 w-[9.75rem] text-right">{t("actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-[12.5px]">
                {paginatedOrders.map((o) => {
                  const disp = disputes[o.id];
                  const isDisputed = isOrderDisputed(o, disp);
                  const closedStatus = closedDisputeStatus(o, disp);
                  const st = displayOrderStatus(o, locale);
                  const isPending = o.status === "pending";
                  const isProcessing = o.status === "processing";
                  const isDelivered = o.status === "delivered" && !isDisputed;
                  const isCompleted = o.status === "completed";
                  const hasDisputeResponse = Boolean(
                    disp?.seller_note ||
                    (disp && summarizeDisputeCase(disp).pending === 0 && summarizeDisputeCase(disp).claimed > 0),
                  );

                  return (
                    <tr
                      key={o.id}
                      className={cn(
                        "hover:bg-raised/40 transition-colors",
                        isDisputed && !hasDisputeResponse && "bg-bad-soft/10"
                      )}
                    >
                      {/* 1. Order ID & Time (Compact) */}
                      <td className="px-3 py-3 align-top">
                        <div className="font-mono font-bold text-fg text-[12.5px] whitespace-nowrap">
                          #{o.id}
                        </div>
                        <div className="text-[10.5px] text-faint mt-0.5 whitespace-nowrap" title={o.created_at}>
                          {formatDate(o.created_at, locale)}
                        </div>
                      </td>

                      {/* 2. Product, Variant & Direct Inventory Sync Links (Clear & Non-overlapping) */}
                      <td className="px-3 py-3 align-top">
                        <div className="flex items-start gap-2.5">
                          <ProductCover coverId={parseCoverId(o)} title={o.product_title || "??"} className="h-8 w-8 rounded-lg shrink-0 mt-0.5" />
                          <div className="min-w-0 flex-1">
                            {o.product_id ? (
                              <Link
                                href={`/seller/products/${o.product_id}`}
                                className="font-bold text-fg hover:text-iris transition-colors text-[13.5px] leading-snug block"
                                title={o.product_title || ""}
                              >
                                {o.product_title || t("orderNumber", { id: o.id })}
                              </Link>
                            ) : (
                              <span className="font-bold text-fg text-[13.5px] leading-snug block">
                                {o.product_title || t("orderNumber", { id: o.id })}
                              </span>
                            )}

                            {/* Variant card if present */}
                            {o.variant_name && (
                              <div className="mt-1.5 p-2 rounded-lg bg-raised/80 border border-line text-[11.5px]">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="font-medium text-fg break-words leading-relaxed min-w-0 flex-1">
                                    <span className="text-faint text-[10px] font-bold uppercase tracking-wider mr-1.5">{t("variantShort")}</span>
                                    {o.variant_name}
                                  </div>
                                  <span className="shrink-0 px-1.5 py-0.5 rounded bg-surface border border-line font-mono font-bold text-fg text-[10.5px]">
                                    x{o.quantity.toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* Action badges and stock link */}
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap text-[11px]">
                              {!o.variant_name && (
                                <span className="px-1.5 py-0.5 rounded bg-raised border border-line font-mono text-muted">
                                  SL: {o.quantity.toLocaleString()}
                                </span>
                              )}
                              {o.product_id && (
                                <Link
                                  href={`/seller/inventory?product=${o.product_id}`}
                                  className="inline-flex items-center gap-1 text-[11px] text-iris hover:underline font-semibold bg-iris-soft/60 px-2 py-0.5 rounded-md border border-iris/20 transition-colors"
                                  title={t("ordersInventoryTitle")}
                                >
                                  <Rows size={11} />
                                  <span>{t("manageInventory")}</span>
                                </Link>
                              )}
                              {o.product_id && (
                                <Link
                                  href={`/seller/products/${o.product_id}`}
                                  className="inline-flex items-center gap-1 text-[10.5px] text-faint hover:text-fg hover:underline font-medium px-1 py-0.5"
                                  title={t("editProductTitle")}
                                >
                                  <ExternalLink size={10} />
                                  <span>{t("editProductShort")}</span>
                                </Link>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 3. Customer Info */}
                      <td className="px-3 py-3 align-top">
                        <div className="font-mono text-muted text-[12px] truncate" title={o.buyer_email || ""}>
                          {o.buyer_email || <span className="text-faint">&mdash;</span>}
                        </div>
                        {o.buyer_email && (
                          <div className="flex items-center gap-2 mt-1">
                            <CopyButton text={o.buyer_email} label="Email" className="text-[10.5px]" />
                            <OrderChatButton
                              orderId={o.id}
                              appearance="link"
                              label={t("chat")}
                              iconSize={11}
                              className="text-[11px] text-iris hover:underline inline-flex items-center gap-0.5 disabled:opacity-60"
                            />
                          </div>
                        )}
                      </td>

                      {/* 4. Amount */}
                      <td className="px-3 py-3 align-top font-mono font-bold text-fg text-[13px]">
                        {formatBrowseMoney(o.total_amount)}
                      </td>

                      {/* 5. Status & Dispute / Escrow Indicators */}
                      <td className="px-3 py-3 align-top min-w-0 overflow-hidden">
                        <Tag tone={st.tone}>{st.label}</Tag>
                        {isDisputed && (
                          <p className="mt-1 truncate text-[10.5px] text-muted" title={disp?.reason || ""}>
                            {hasDisputeResponse ? t("responded") : t("awaitingResponse")}
                          </p>
                        )}
                        {closedStatus && (
                          <p className="mt-1 truncate text-[10.5px] text-muted" title={td.has(closedStatus as "open") ? td(closedStatus as "open") : closedStatus}>
                            {td.has(closedStatus as "open") ? td(closedStatus as "open") : closedStatus}
                          </p>
                        )}
                        {isDelivered && o.escrow_expires_at && (
                          <p className="mt-1 truncate text-[10.5px] text-faint">
                            {t("escrowUntilShort", { date: formatDate(o.escrow_expires_at, locale) })}
                          </p>
                        )}
                      </td>

                      {/* 6. Action Shortcuts */}
                      <td className="px-3 py-3 align-top">
                        <div className="flex flex-col items-stretch gap-1">
                          {isDisputed && (
                            <Button
                              size="sm"
                              variant={!hasDisputeResponse ? "danger" : "secondary"}
                              onClick={() => setActiveDisputeOrder(o)}
                              className="h-7 w-full justify-center text-[11px] gap-1 whitespace-nowrap"
                            >
                              <AlertCircle size={12} />
                              <span>{hasDisputeResponse ? t("viewDisputeResponse") : t("handleDispute")}</span>
                            </Button>
                          )}
                          {closedStatus && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setActiveDisputeOrder(o)}
                              className="h-7 w-full justify-center text-[11px] gap-1 whitespace-nowrap"
                            >
                              <AlertCircle size={12} />
                              <span>{t("viewDisputeHistory")}</span>
                            </Button>
                          )}
                          {isPending && (
                            <Button
                              size="sm"
                              disabled={actingOrderId === o.id}
                              onClick={() => handleAccept(o.id)}
                              className="h-7 w-full justify-center text-[11px] gap-1 whitespace-nowrap"
                            >
                              <Check size={12} />
                              <span>{actingOrderId === o.id ? t("accepting") : t("acceptOrder")}</span>
                            </Button>
                          )}
                          {isProcessing && (
                            <Button
                              size="sm"
                              onClick={() => setActiveDeliverOrder(o)}
                              className="h-7 w-full justify-center text-[11px] gap-1 whitespace-nowrap"
                            >
                              <Package size={12} />
                              <span>{t("deliverNow")}</span>
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setActiveDetailOrder(o)}
                            className="h-7 w-full justify-center px-2 text-[11px] text-muted hover:text-fg"
                            title={t("orderDetail")}
                          >
                            <Eye size={13} />
                            <span className="ml-1">{t("orderDetail")}</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer & Pagination */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-line bg-raised/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-muted">
            <span>
              {t("paginationOrders", {
                from: (page - 1) * PAGE_SIZE + 1,
                to: Math.min(page * PAGE_SIZE, filteredOrders.length),
                total: filteredOrders.length,
              })}
            </span>
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </div>
        )}
      </Card>

      {/* DISPUTE RESOLUTION MODAL */}
      {activeDisputeOrder && (
        <SellerDisputeModal
          order={activeDisputeOrder}
          dispute={disputes[activeDisputeOrder.id]}
          isOpen={!!activeDisputeOrder}
          onClose={() => setActiveDisputeOrder(null)}
          onSuccess={handleDisputeResponseSuccess}
        />
      )}

      {/* FAST DELIVERY MODAL */}
      {activeDeliverOrder && (
        <SellerDeliverModal
          order={activeDeliverOrder}
          isOpen={!!activeDeliverOrder}
          onClose={() => setActiveDeliverOrder(null)}
          onSuccess={handleDeliverSuccess}
        />
      )}

      {/* ORDER DETAILS INSPECTOR DRAWER / MODAL */}
      {activeDetailOrder && (
        <SellerOrderDetailModal
          order={activeDetailOrder}
          dispute={disputes[activeDetailOrder.id]}
          highlightResourceIds={highlightResourceIds}
          isOpen={!!activeDetailOrder}
          onClose={() => setActiveDetailOrder(null)}
          onDeliverClick={() => {
            const ord = activeDetailOrder;
            setActiveDetailOrder(null);
            setActiveDeliverOrder(ord);
          }}
          onDisputeClick={() => {
            const ord = activeDetailOrder;
            setActiveDetailOrder(null);
            setActiveDisputeOrder(ord);
          }}
        />
      )}
    </div>
  );
}

/** 1. DISPUTE RESOLUTION MODAL */
function SellerDisputeModal({
  order,
  dispute: propDispute,
  isOpen,
  onClose,
  onSuccess,
}: {
  order: Order;
  dispute?: Dispute | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}) {
  const t = useTranslations("seller");
  const apiErrorMessage = useApiErrorMessage();
  const { formatBrowseMoney } = useMoney();

  const [fetchedDispute, setFetchedDispute] = useState<Dispute | null>(null);
  const dispute = propDispute ?? fetchedDispute;

  useEffect(() => {
    if (!propDispute && isOpen && order?.id) {
      api.sellerDispute(order.id)
        .then(setFetchedDispute)
        .catch(() => setFetchedDispute(null));
    }
  }, [propDispute, isOpen, order?.id]);

  type Tab = "claim" | "remedy";
  const [activeTab, setActiveTab] = useState<Tab>("claim");

  const [sellerNote, setSellerNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labelRows, setLabelRows] = useState<Array<{ id: number; data?: string | null }>>([]);

  const hasClaimed = (dispute?.claimed_resource_ids?.length ?? 0) > 0;
  const caseSummary = dispute ? summarizeDisputeCase(dispute) : null;
  const td = useTranslations("status.dispute");
  const isOpenCase = dispute?.status === "open";

  useEffect(() => {
    if (!isOpen || !dispute?.id) return;
    void api.sellerDisputeResources(dispute.id, { per_page: 100 })
      .then((page) => setLabelRows(page.items))
      .catch(() => setLabelRows([]));
  }, [isOpen, dispute?.id, dispute?.status, dispute?.resource_actions?.length]);

  if (!isOpen) return null;

  const handleRespond = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispute) { setError(t("disputeNotFound")); return; }
    if (!sellerNote.trim()) { setError(t("disputeResponseRequired")); return; }
    setSubmitting(true); setError(null);
    try {
      await api.sellerRespondDispute(dispute.id, sellerNote.trim());
      setSellerNote("");
      await onSuccess();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t("disputeResponseFailed")));
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-panel/75 backdrop-blur-xs animate-fade">
      <div
        role="dialog" aria-modal="true" aria-labelledby="dispute-modal-title"
        className="w-full max-w-4xl bg-surface border border-line rounded-2xl shadow-card-lg overflow-hidden animate-rise flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-4 border-b border-line bg-raised/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="p-1.5 rounded-lg bg-bad-soft text-bad shrink-0"><AlertCircle size={18} /></span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn(
                  "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded shrink-0",
                  isOpenCase ? "text-bad bg-bad-soft" : "text-muted bg-raised",
                )}>
                  {isOpenCase ? t("disputeDetailTitle") : t("disputeHistoryTitle")}
                </span>
                <span className="text-xs text-faint font-mono">{t("orderNumber", { id: order.id })}</span>
                {hasClaimed && (
                  <span className="text-[10px] font-mono text-warn bg-warn-soft/70 border border-warn/30 px-1.5 py-0.2 rounded shrink-0">
                    {t("claim_batch", { count: dispute?.claimed_resource_ids?.length ?? 0 })}
                  </span>
                )}
              </div>
              <h3 id="dispute-modal-title" className="text-[14px] font-bold text-fg truncate max-w-[380px] mt-0.5">
                {order.product_title}
              </h3>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label={t("close")} className="h-7 w-7 p-0 text-muted hover:text-fg shrink-0">
            <X size={14} />
          </Button>
        </div>

        {/* Tab bar */}
        {hasClaimed && isOpenCase && (
          <div className="flex border-b border-line bg-raised/20 shrink-0">
            <button
              onClick={() => setActiveTab("claim")}
              className={cn(
                "flex-1 py-2.5 text-[12px] font-semibold transition-colors",
                activeTab === "claim" ? "text-bad border-b-2 border-bad bg-bad-soft/20" : "text-muted hover:text-fg"
              )}
            >
              <AlertTriangle size={13} className="mr-1.5 inline-block" aria-hidden="true" />
              {t("disputeTimelineTab")}
            </button>
            <button
              onClick={() => setActiveTab("remedy")}
              className={cn(
                "flex-1 py-2.5 text-[12px] font-semibold transition-colors",
                activeTab === "remedy" ? "text-warn border-b-2 border-warn bg-warn-soft/20" : "text-muted hover:text-fg"
              )}
            >
              <RefreshCw size={13} className="mr-1.5 inline-block" aria-hidden="true" />
              {t("claimedAccountsTitle", { count: dispute?.claimed_resource_ids?.length ?? 0 })}
              {(caseSummary?.pending ?? 0) > 0 && activeTab !== "remedy" && (
                <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-warn text-white text-[9px] font-bold">
                  {caseSummary?.pending}
                </span>
              )}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">

          {(activeTab === "claim" || !isOpenCase) && (
            <div className="p-5 space-y-4 text-xs">
              {dispute ? (
                <DisputeCaseView
                  dispute={dispute}
                  statusLabel={
                    caseSummary && caseSummary.pending > 0
                      ? t("claimedAccountsTitle", { count: caseSummary.pending })
                      : td.has(dispute.status) ? td(dispute.status as "open") : dispute.status
                  }
                  statusTone={caseSummary && caseSummary.pending > 0 ? "warn" : dispute.status === "open" ? "iris" : "neutral"}
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
                    <label className="block font-semibold text-fg">{t("disputeSellerResponse")}</label>
                    <p className="text-[11.5px] text-muted">{t("replyAgainHint")}</p>
                    <Textarea rows={3} value={sellerNote} onChange={(e) => setSellerNote(e.target.value)}
                      placeholder={t("disputeSellerPlaceholder")} className="bg-surface text-xs leading-relaxed" />
                  </div>
                  {error && <div className="rounded-lg border border-bad/20 bg-bad-soft p-2.5 text-xs font-medium text-bad">{error}</div>}
                  <div className="flex items-center justify-between pt-1">
                    <OrderChatButton
                      orderId={order.id}
                      appearance="link"
                      label={t("chatWithBuyer")}
                      className="inline-flex items-center gap-1 text-xs font-medium text-iris hover:underline disabled:opacity-60"
                    />
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
          )}

          {/* ── TAB: Resource Remedy ── */}
          {activeTab === "remedy" && isOpenCase && (
            <div className="p-5">
              {dispute ? (
                <SellerDisputeRemedyPanel
                  disputeId={dispute.id}
                  dispute={dispute}
                  order={order}
                  formatRefund={formatBrowseMoney}
                  onChanged={onSuccess}
                />
              ) : (
                <p className="py-10 text-center text-muted">{t("noClaimedAccounts")}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 2. FAST & BULK DELIVERY MODAL */
function SellerDeliverModal({
  order,
  isOpen,
  onClose,
  onSuccess,
}: {
  order: Order;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useTranslations("seller");
  const apiErrorMessage = useApiErrorMessage();
  const [data, setData] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const lines = data.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lineCount = lines.length;
  const uniqueCount = new Set(lines).size;
  const duplicateCount = lineCount - uniqueCount;
  const isMatch = lineCount === order.quantity;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = (evt.target?.result as string) || "";
      setData(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleRemoveDuplicates = () => {
    const unique = Array.from(new Set(lines));
    setData(unique.join("\n"));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data.trim()) {
      setError(t("deliveryRequired"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await api.sellerDeliverOrder(order.id, data.trim());
      onSuccess();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t("deliveryFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-panel/75 backdrop-blur-xs animate-fade">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deliver-modal-title"
        className="w-full max-w-xl bg-surface border border-line rounded-2xl shadow-card-lg overflow-hidden animate-rise flex flex-col max-h-[90vh]"
      >
        <div className="p-4 border-b border-line bg-raised/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-iris-soft text-iris">
              <Package size={18} />
            </span>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-iris bg-iris-soft px-1.5 py-0.2 rounded">
                {t("deliverModalTitle")}
              </span>
              <h3 id="deliver-modal-title" className="text-[14px] font-bold text-fg truncate max-w-[320px] mt-0.5">
                {t("orderNumber", { id: order.id })} &bull; {order.product_title}
              </h3>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 w-7 p-0 text-muted hover:text-fg">
            <X size={14} />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs overflow-y-auto flex-1">
          {/* Order info & required quantity */}
          <div className="p-3 rounded-xl bg-raised border border-line flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-muted">
            <div>
              <span>{t("variantLabel")} </span>
              <strong className="text-fg">{order.variant_name || t("defaultVariant")}</strong>
            </div>
            <div className="flex items-center gap-2">
              <span>{t("deliveryRequirement")}</span>
              <span className="font-mono font-bold text-iris-hi text-sm px-2 py-0.5 rounded bg-surface border border-line">
                {order.quantity.toLocaleString()} item
              </span>
            </div>
          </div>

          {/* File Upload Toolbar */}
          <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-surface border border-line">
            <div className="text-[11.5px] text-muted">
              <span>{t("bulkUpload")}</span>
            </div>
            <label className="cursor-pointer">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-raised hover:bg-raised/80 border border-line text-xs font-semibold text-fg transition-colors">
                <Upload size={12} className="text-iris" />
                <span>{t("uploadTxtCsv")}</span>
              </span>
              <Input type="file" accept=".txt,.csv" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          {/* Textarea & Line validation */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-fg">{t("deliveryPayloadLabel")}</label>
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <span className={cn(
                  "px-1.5 py-0.5 rounded font-semibold",
                  lineCount === 0
                    ? "text-faint bg-raised"
                    : isMatch
                    ? "text-good bg-good-soft/70 border border-good/30"
                    : "text-warn bg-warn-soft/70 border border-warn/30"
                )}>
                  {lineCount === 0
                    ? t("noDataEntered")
                    : isMatch
                    ? t("deliveryExactLines", { count: lineCount.toLocaleString(), required: order.quantity.toLocaleString() })
                    : lineCount < order.quantity
                    ? t("deliveryMissingLines", { count: lineCount.toLocaleString(), required: order.quantity.toLocaleString(), missing: (order.quantity - lineCount).toLocaleString() })
                    : t("deliveryExtraLines", { count: lineCount.toLocaleString(), required: order.quantity.toLocaleString(), extra: (lineCount - order.quantity).toLocaleString() })}
                </span>
              </div>
            </div>

            <Textarea
              rows={6}
              value={data}
              onChange={(e) => setData(e.target.value)}
              placeholder={t("deliveryBulkPlaceholder")}
              className="font-mono text-xs leading-relaxed bg-surface"
              autoFocus
            />

            {/* Duplicate detection badge */}
            {duplicateCount > 0 && (
              <div className="p-2 rounded-lg bg-warn-soft/40 border border-warn/30 text-warn flex items-center justify-between text-[11px]">
                <span>{t("duplicateLines", { count: duplicateCount.toLocaleString() })}</span>
                <Button size="sm" variant="ghost" type="button" onClick={handleRemoveDuplicates} className="h-6 text-[10.5px] text-warn hover:underline">
                  {t("removeDuplicates")}
                </Button>
              </div>
            )}

            <p className="text-[11px] text-muted">
              💡 {t("deliveryCustomerHint")}
            </p>
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-bad-soft border border-bad/20 text-bad text-xs font-medium">
              {error}
            </div>
          )}

          <div className="pt-2 border-t border-line flex items-center justify-end gap-2 shrink-0">
            <Button size="sm" variant="ghost" type="button" onClick={onClose} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button size="sm" type="submit" disabled={submitting || !data.trim()} className="gap-1.5">
              <Package size={13} />
              <span>{submitting ? t("deliverySubmitting") : t("deliveryConfirmCount", { count: lineCount.toLocaleString() })}</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** 3. ORDER DETAIL INSPECTOR DRAWER / MODAL */
function SellerOrderDetailModal({
  order,
  dispute,
  highlightResourceIds = [],
  isOpen,
  onClose,
  onDeliverClick,
  onDisputeClick,
}: {
  order: Order;
  dispute?: Dispute | null;
  highlightResourceIds?: number[];
  isOpen: boolean;
  onClose: () => void;
  onDeliverClick: () => void;
  onDisputeClick: () => void;
}) {
  const t = useTranslations("seller");
  const td = useTranslations("status.dispute");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [fetchedDispute, setFetchedDispute] = useState<Dispute | null>(null);
  const caseRecord = dispute ?? fetchedDispute;
  const isOpenCase = isOrderDisputed(order, caseRecord);

  useEffect(() => {
    if (!isOpen || !order.id) return;
    if (!dispute && (order.dispute_status || order.has_dispute)) {
      api.sellerDispute(order.id).then(setFetchedDispute).catch(() => setFetchedDispute(null));
    }
  }, [isOpen, order.id, order.dispute_status, order.has_dispute, dispute]);

  useEffect(() => {
    if (order.id) {
      setLoadingResources(true);
      api.orderResources(order.id)
        .then((res) => setResources(res || []))
        .catch(() => setResources([]))
        .finally(() => setLoadingResources(false));
    }
  }, [order.id]);

  if (!isOpen) return null;

  const st = displayOrderStatus(
    isOpenCase ? { ...order, has_dispute: true, protection: { status: "dispute_open" } } : order,
    locale,
  );
  const isProcessing = order.status === "processing";

  // Delivered data lines calculation
  const deliveredLines = order.delivered_data
    ? order.delivered_data.split(/\r?\n/).filter((l) => l.trim())
    : [];

  const handleDownloadDeliveredTxt = () => {
    if (!order.delivered_data) return;
    const blob = new Blob([order.delivered_data], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `order_${order.id}_delivered_data.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadResourcesTxt = () => {
    if (resources.length === 0) return;
    const text = resources.map((r) => r.data).join("\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `order_${order.id}_resources.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-panel/75 backdrop-blur-xs animate-fade">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-modal-title"
        className="w-full max-w-4xl bg-surface border border-line rounded-2xl shadow-card-lg overflow-hidden animate-rise flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-4 border-b border-line bg-raised/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <ProductCover coverId={parseCoverId(order)} title={order.product_title || "??"} className="h-9 w-9 rounded-xl shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <Tag tone={st.tone}>{st.label}</Tag>
                <span className="text-xs text-faint font-mono font-semibold">{t("orderNumber", { id: order.id })}</span>
              </div>
              <h3 id="detail-modal-title" className="text-[14px] font-bold text-fg truncate max-w-[320px] mt-0.5">
                {order.product_title}
              </h3>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 w-7 p-0 text-muted hover:text-fg">
            <X size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
          {/* Metadata Summary Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3.5 rounded-xl bg-raised/40 border border-line text-[11.5px]">
            <div>
              <span className="text-faint">{t("buyerLabel")}</span>
              <div className="font-mono text-fg font-medium mt-0.5 truncate" title={order.buyer_email || ""}>
                {order.buyer_email || "—"}
              </div>
            </div>
            <div>
              <span className="text-faint">{t("totalPayment")}</span>
              <div className="font-mono text-fg font-bold mt-0.5">
                {formatBrowseMoney(order.total_amount)}
              </div>
            </div>
            <div>
              <span className="text-faint">{t("createdTime")}</span>
              <div className="font-mono text-fg mt-0.5">
                {formatDate(order.created_at, locale)}
              </div>
            </div>
            {order.variant_name && (
              <div>
                <span className="text-faint">{t("variantAndQuantity")}</span>
                <div className="font-medium text-fg mt-0.5">
                  {order.variant_name} (SL: {order.quantity.toLocaleString()})
                </div>
              </div>
            )}
            {order.escrow_expires_at && (
              <div className="col-span-2">
                <span className="text-faint">{t("escrowDuration")}</span>
                <div className="font-medium text-iris-hi mt-0.5">
                  {formatDateTime(order.escrow_expires_at, locale)}
                </div>
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="p-3 rounded-xl bg-surface border border-line">
            <span className="font-semibold text-muted mb-1 block">{t("orderProgress")}</span>
            <StatusTimeline status={order.status} />
          </div>

          {/* Delivered Data Box with Bulk Export */}
          {order.delivered_data && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-fg">
                  {t("deliveredLines", { count: deliveredLines.length.toLocaleString() })}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="secondary" onClick={handleDownloadDeliveredTxt} className="h-6.5 px-2 text-[11px] gap-1">
                    <Download size={11} />
                    <span>{t("downloadTxt")}</span>
                  </Button>
                  <CopyButton text={order.delivered_data} label={t("copyAll")} className="text-[11px]" />
                </div>
              </div>
              <div className="p-3 rounded-xl bg-raised border border-line font-mono text-[11.5px] text-fg break-all select-all max-h-36 overflow-y-auto leading-relaxed">
                {deliveredLines.slice(0, 50).join("\n")}
                {deliveredLines.length > 50 && (
                  <p className="mt-2 text-[10.5px] text-faint italic font-sans">
                    {t("moreDeliveredLines", { count: (deliveredLines.length - 50).toLocaleString() })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Auto-assigned resources list if applicable with Bulk Export */}
          {resources.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-muted">
                  {t("allocatedResources", { count: resources.length.toLocaleString() })}
                </span>
                <Button size="sm" variant="secondary" onClick={handleDownloadResourcesTxt} className="h-6.5 px-2 text-[11px] gap-1">
                  <Download size={11} />
                  <span>{t("downloadAll")}</span>
                </Button>
              </div>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {resources.slice(0, 30).map((r) => {
                  const mark = deliveryResourceMarks(caseRecord)[r.id];
                  const highlighted = highlightResourceIds.includes(r.id);
                  const inactive = r.status === "error" || mark?.kind === "refunded" || mark?.kind === "replaced";
                  return (
                  <div key={r.id} className={cn(
                    "p-2 rounded-lg border font-mono text-[11px] flex items-center justify-between gap-2",
                    highlighted ? "border-iris bg-iris-soft/40" : "bg-raised border-line",
                    inactive && "opacity-70",
                  )}>
                    <span className={cn("truncate max-w-[240px]", inactive && "text-muted line-through")}>{r.data}</span>
                    <div className="flex items-center gap-1 shrink-0">
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
                {resources.length > 30 && (
                  <div className="p-2 text-center text-[11px] text-faint bg-raised/50 rounded-lg">
                    {t("showingResources", { count: resources.length.toLocaleString() })}
                  </div>
                )}
              </div>
            </div>
          )}

          {caseRecord && (
            <div className="space-y-2 rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-bold text-fg">{isOpenCase ? t("disputedOrderTitle") : t("disputeHistoryTitle")}</div>
                  <div className="text-[11px] text-muted">
                    {isOpenCase ? t("disputedOrderHint") : t("closedDisputeHint")}
                  </div>
                </div>
                <Button size="sm" variant={isOpenCase ? "danger" : "secondary"} onClick={onDisputeClick}>
                  {isOpenCase ? t("handleDispute") : t("viewDisputeHistory")}
                </Button>
              </div>
              <DisputeCaseView
                dispute={caseRecord}
                statusLabel={td.has(caseRecord.status as "open") ? td(caseRecord.status as "open") : caseRecord.status}
                statusTone={isOpenCase ? "warn" : "neutral"}
                formatRefund={formatBrowseMoney}
                viewerRole="seller"
              />
            </div>
          )}

          {isProcessing && (
            <div className="p-3 rounded-xl bg-warn-soft/30 border border-warn/30 flex items-center justify-between">
              <div>
                <div className="font-bold text-warn">{t("waitingDeliveryTitle")}</div>
                <div className="text-[11px] text-muted">{t("waitingDeliveryHint")}</div>
              </div>
              <Button size="sm" onClick={onDeliverClick}>
                {t("deliverNow")}
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 bg-raised/50 border-t border-line flex items-center justify-between shrink-0">
          <OrderChatButton
            orderId={order.id}
            appearance="link"
            label={t("chatWithBuyer")}
            className="text-xs text-iris hover:underline inline-flex items-center gap-1 font-medium disabled:opacity-60"
          />
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t("close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
