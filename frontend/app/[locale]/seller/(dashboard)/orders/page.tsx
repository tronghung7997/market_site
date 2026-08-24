"use client";

import { useLocale, useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { orderStatus } from "@/lib/order-status";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { Dispute, Order, Resource } from "@/lib/types";
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
  MessageSquare,
  Package,
  Plus,
  RefreshCw,
  Rows,
  Search,
  ShieldCheck,
  Star,
  Trash,
  Upload,
  X,
} from "@/components/Icons";
import { StatusTimeline } from "@/components/orders/OrderCardPrimitives";

const PAGE_SIZE = 20;

type FilterTab = "all" | "disputed" | "action_required" | "escrow" | "completed" | "cancelled";
type TimeFilter = "all" | "today" | "7d" | "30d";

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
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();

  const [orders, setOrders] = useState<Order[]>([]);
  const [disputes, setDisputes] = useState<Record<number, Dispute>>({});
  const [loading, setLoading] = useState(true);
  const [actingOrderId, setActingOrderId] = useState<number | null>(null);

  // Filters & Search
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [selectedProductTitle, setSelectedProductTitle] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [page, setPage] = useState(1);

  // Modals state
  const [activeDisputeOrder, setActiveDisputeOrder] = useState<Order | null>(null);
  const [activeDeliverOrder, setActiveDeliverOrder] = useState<Order | null>(null);
  const [activeDetailOrder, setActiveDetailOrder] = useState<Order | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.sellerOrders();
      setOrders(list);

      // Fetch disputes for all disputed orders
      const disputedOrders = list.filter((o) => o.status === "disputed");
      if (disputedOrders.length > 0) {
        const disputeEntries = await Promise.all(
          disputedOrders.map(async (o) => {
            try {
              const disp = await api.sellerDispute(o.id);
              return [o.id, disp] as const;
            } catch {
              return null;
            }
          })
        );
        const map: Record<number, Dispute> = {};
        for (const entry of disputeEntries) {
          if (entry) map[entry[0]] = entry[1];
        }
        setDisputes(map);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Actions
  const handleAccept = async (orderId: number) => {
    setActingOrderId(orderId);
    try {
      await api.sellerAcceptOrder(orderId);
      await loadData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t("orderAcceptFailed"));
    } finally {
      setActingOrderId(null);
    }
  };

  const handleDeliverSuccess = async () => {
    setActiveDeliverOrder(null);
    await loadData();
  };

  const handleDisputeResponseSuccess = async () => {
    setActiveDisputeOrder(null);
    await loadData();
  };

  // KPI Metrics Calculation
  const disputedOrders = useMemo(() => orders.filter((o) => o.status === "disputed"), [orders]);
  const unrespondedDisputesCount = useMemo(() => {
    return disputedOrders.filter((o) => !disputes[o.id]?.seller_note).length;
  }, [disputedOrders, disputes]);

  const actionRequiredOrders = useMemo(() => {
    return orders.filter((o) => o.status === "pending" || o.status === "processing");
  }, [orders]);

  const escrowOrders = useMemo(() => {
    return orders.filter((o) => o.status === "delivered");
  }, [orders]);

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
      // 1. Tab filter
      if (activeTab === "disputed" && o.status !== "disputed") return false;
      if (activeTab === "action_required" && o.status !== "pending" && o.status !== "processing") return false;
      if (activeTab === "escrow" && o.status !== "delivered") return false;
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-raised/40 text-faint text-[11px] font-semibold border-b border-line uppercase tracking-wider">
                  <th className="px-3 py-3 w-[85px] sm:w-[95px] shrink-0">{t("orderCode")}</th>
                  <th className="px-4 py-3 min-w-[280px]">{t("productAndVariant")}</th>
                  <th className="px-3 py-3 w-[160px] sm:w-[180px]">{t("customer")}</th>
                  <th className="px-3 py-3 w-[95px] font-mono">{t("amount")}</th>
                  <th className="px-3 py-3 w-[150px]">{t("statusAndDispute")}</th>
                  <th className="px-4 py-3 text-right w-[130px] sm:w-[150px]">{t("actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-[12.5px]">
                {paginatedOrders.map((o) => {
                  const st = orderStatus(o.status, locale);
                  const isDisputed = o.status === "disputed";
                  const isPending = o.status === "pending";
                  const isProcessing = o.status === "processing";
                  const isDelivered = o.status === "delivered";
                  const isCompleted = o.status === "completed";
                  const disp = disputes[o.id];
                  const hasDisputeResponse = !!disp?.seller_note;

                  return (
                    <tr
                      key={o.id}
                      className={cn(
                        "hover:bg-raised/40 transition-colors",
                        isDisputed && !hasDisputeResponse && "bg-bad-soft/10"
                      )}
                    >
                      {/* 1. Order ID & Time (Compact) */}
                      <td className="px-3 py-3 align-top whitespace-nowrap">
                        <div className="font-mono font-bold text-fg text-[12.5px]">
                          #{o.id}
                        </div>
                        <div className="text-[10.5px] text-faint mt-0.5" title={o.created_at}>
                          {formatDate(o.created_at, locale)}
                        </div>
                      </td>

                      {/* 2. Product, Variant & Direct Inventory Sync Links (Clear & Non-overlapping) */}
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-start gap-2.5">
                          <Monogram text={o.product_title || "??"} className="h-8 w-8 rounded-lg shrink-0 text-[11px] mt-0.5" />
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
                        <div className="font-mono text-muted text-[12px] truncate max-w-[180px]" title={o.buyer_email || ""}>
                          {o.buyer_email || <span className="text-faint">&mdash;</span>}
                        </div>
                        {o.buyer_email && (
                          <div className="flex items-center gap-2 mt-1">
                            <CopyButton text={o.buyer_email} label="Email" className="text-[10.5px]" />
                            <Link
                              href={`/seller/messages?order=${o.id}`}
                              className="text-[11px] text-iris hover:underline inline-flex items-center gap-0.5"
                              title={t("chatWithBuyer")}
                            >
                              <MessageSquare size={11} />
                              <span>{t("chat")}</span>
                            </Link>
                          </div>
                        )}
                      </td>

                      {/* 4. Amount */}
                      <td className="px-3 py-3 align-top font-mono font-bold text-fg text-[13px]">
                        {formatBrowseMoney(o.total_amount)}
                      </td>

                      {/* 5. Status & Dispute / Escrow Indicators */}
                      <td className="px-3 py-3 align-top space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Tag tone={st.tone}>{st.label}</Tag>
                          {isCompleted && o.has_review && (
                            <span className="inline-flex items-center gap-0.5 text-[11px] text-warn font-medium">
                              <Star size={11} className="fill-warn" /> {t("rated")}
                            </span>
                          )}
                        </div>

                        {/* Dispute info summary */}
                        {isDisputed && (
                          <div className="p-1.5 rounded-lg bg-bad-soft border border-bad/20 text-bad text-[11px] space-y-0.5 max-w-[220px]">
                            <div className="font-bold flex items-center justify-between gap-1">
                              <span>{t("disputeReason")}</span>
                              <span className="text-[9.5px] px-1 py-0.2 rounded bg-surface/60 font-normal">
                                {hasDisputeResponse ? t("responded") : t("awaitingResponse")}
                              </span>
                            </div>
                            <p className="truncate text-fg/90" title={disp?.reason || ""}>
                              {disp?.reason || t("disputeFallbackReason")}
                            </p>
                          </div>
                        )}

                        {/* Escrow expiry indicator */}
                        {isDelivered && o.escrow_expires_at && (
                          <div className="text-[10.5px] text-faint flex items-center gap-1">
                            <ShieldCheck size={11} className="text-iris" />
                            <span>{t("escrowUntilShort", { date: formatDate(o.escrow_expires_at, locale) })}</span>
                          </div>
                        )}
                      </td>

                      {/* 6. Action Shortcuts */}
                      <td className="px-4 py-3 align-top text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Dispute Action */}
                          {isDisputed && (
                            <Button
                              size="sm"
                              variant={!hasDisputeResponse ? "danger" : "secondary"}
                              onClick={() => setActiveDisputeOrder(o)}
                              className="h-7 text-[11.5px] gap-1"
                            >
                              <AlertCircle size={12} />
                              <span>{hasDisputeResponse ? t("viewDisputeResponse") : t("handleDispute")}</span>
                            </Button>
                          )}

                          {/* Accept Pending Order */}
                          {isPending && (
                            <Button
                              size="sm"
                              disabled={actingOrderId === o.id}
                              onClick={() => handleAccept(o.id)}
                              className="h-7 text-[11.5px] gap-1"
                            >
                              <Check size={12} />
                              <span>{actingOrderId === o.id ? t("accepting") : t("acceptOrder")}</span>
                            </Button>
                          )}

                          {/* Deliver Processing Order */}
                          {isProcessing && (
                            <Button
                              size="sm"
                              onClick={() => setActiveDeliverOrder(o)}
                              className="h-7 text-[11.5px] gap-1"
                            >
                              <Package size={12} />
                              <span>{t("deliverNow")}</span>
                            </Button>
                          )}

                          {/* Inspect Order Details */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setActiveDetailOrder(o)}
                            className="h-7 px-2 text-[11.5px] text-muted hover:text-fg"
                            title={t("orderDetail")}
                          >
                            <Eye size={13} />
                            <span className="ml-1 hidden sm:inline">{t("orderDetail")}</span>
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
  dispute,
  isOpen,
  onClose,
  onSuccess,
}: {
  order: Order;
  dispute?: Dispute | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useTranslations("seller");
  const locale = useLocale();
  const [sellerNote, setSellerNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispute) {
      setError(t("disputeNotFound"));
      return;
    }
    if (!sellerNote.trim()) {
      setError(t("disputeResponseRequired"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await api.sellerRespondDispute(dispute.id, sellerNote.trim());
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("disputeResponseFailed");
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const hasResponded = !!dispute?.seller_note;
  const evidenceType = ({
    account: t("evidenceTypeAccount"),
    proxy: t("evidenceTypeProxy"),
    server: t("evidenceTypeServer"),
    payment: t("evidenceTypePayment"),
    other: t("evidenceTypeOther"),
  } as Record<string, string>)[dispute?.evidence_type ?? "other"] ?? dispute?.evidence_type ?? "";
  const evidenceLabels: Record<string, string> = {
    username: t("evidenceFieldUsername"),
    issue: t("evidenceFieldIssue"),
    ip: t("evidenceFieldIp"),
    error: t("evidenceFieldError"),
    server_ip: t("evidenceFieldServerIp"),
    transaction_id: t("evidenceFieldTransactionId"),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-panel/75 backdrop-blur-xs animate-fade">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispute-modal-title"
        className="w-full max-w-xl bg-surface border border-line rounded-2xl shadow-card-lg overflow-hidden animate-rise flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="p-4 border-b border-line bg-raised/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-bad-soft text-bad">
              <AlertCircle size={18} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-bad bg-bad-soft px-1.5 py-0.2 rounded">
                  {t("disputeDetailTitle")}
                </span>
                <span className="text-xs text-faint font-mono">{t("orderNumber", { id: order.id })}</span>
              </div>
              <h3 id="dispute-modal-title" className="text-[14px] font-bold text-fg truncate max-w-[320px] mt-0.5">
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
          {/* Buyer Claim Section */}
          <div className="p-3.5 rounded-xl bg-bad-soft/25 border border-bad/30 space-y-2.5">
            <div className="flex items-center justify-between text-bad font-bold">
              <span className="flex items-center gap-1.5">
                <span>🚨 {t("disputeBuyerClaim")}</span>
              </span>
              {dispute?.created_at && (
                <span className="text-[11px] font-normal text-muted font-mono">
                  {formatDateTime(dispute.created_at, locale)}
                </span>
              )}
            </div>

            <div className="p-3 rounded-lg bg-surface/80 border border-line text-fg leading-relaxed whitespace-pre-wrap font-sans">
              {dispute?.reason || t("disputeFallbackClaim")}
            </div>

            {/* Evidence metadata */}
            {dispute?.evidence && Object.keys(dispute.evidence).length > 0 && (
              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] font-semibold text-muted">
                  {t("evidenceAttached", { type: evidenceType })}
                </span>
                <div className="grid grid-cols-1 gap-1 font-mono text-[11.5px] p-2 bg-surface/60 rounded-lg border border-line">
                  {Object.entries(dispute.evidence).map(([k, v]) => (
                    <div key={k} className="flex items-baseline gap-1.5">
                      <span className="text-faint">{evidenceLabels[k] ?? k}:</span>
                      <span className="text-fg break-all">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Initial Delivered Data Snapshot */}
          {order.delivered_data && (
            <div className="space-y-1.5">
              <span className="font-semibold text-muted">{t("deliveredInitial")}</span>
              <div className="p-2.5 rounded-xl bg-raised border border-line font-mono text-[11.5px] text-muted break-all select-all max-h-24 overflow-y-auto">
                {order.delivered_data}
              </div>
            </div>
          )}

          {/* Seller Response View or Input Form */}
          {hasResponded ? (
            <div className="p-3.5 rounded-xl bg-iris-soft/20 border border-iris/30 space-y-2">
              <div className="flex items-center justify-between text-iris-hi font-bold">
                <span>✓ {t("submittedResponse")}</span>
                <Tag tone="warn" className="text-[10px]">{t("disputeWaitingAdmin")}</Tag>
              </div>
              <div className="p-3 rounded-lg bg-surface/80 border border-line text-fg leading-relaxed whitespace-pre-wrap">
                {dispute?.seller_note}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <label className="font-bold text-fg block">
                  {t("disputeSellerResponse")}:
                </label>
                <Textarea
                  rows={4}
                  value={sellerNote}
                  onChange={(e) => setSellerNote(e.target.value)}
                  placeholder={t("disputeSellerPlaceholder")}
                  className="text-xs bg-surface leading-relaxed"
                  autoFocus
                />
              </div>

              {error && (
                <div className="p-2.5 rounded-lg bg-bad-soft border border-bad/20 text-bad text-xs font-medium">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-line">
                <Link
                  href={`/seller/messages?order=${order.id}`}
                  className="text-xs text-iris hover:underline inline-flex items-center gap-1 font-medium"
                >
                  <MessageSquare size={13} />
                  <span>{t("chatWithBuyer")}</span>
                </Link>

                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" type="button" onClick={onClose} disabled={submitting}>
                    {t("cancel")}
                  </Button>
                  <Button size="sm" type="submit" disabled={submitting || !sellerNote.trim()}>
                    {submitting ? t("sending") : t("sendDisputeResponse")}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Footer for already responded state */}
        {hasResponded && (
          <div className="p-3.5 bg-raised/50 border-t border-line flex items-center justify-between shrink-0">
            <Link
              href={`/seller/messages?order=${order.id}`}
              className="text-xs text-iris hover:underline inline-flex items-center gap-1 font-medium"
            >
              <MessageSquare size={13} />
              <span>{t("chatWithBuyer")}</span>
            </Link>
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t("close")}
            </Button>
          </div>
        )}
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
      const msg = err instanceof Error ? err.message : t("deliveryFailed");
      setError(msg);
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
  isOpen,
  onClose,
  onDeliverClick,
  onDisputeClick,
}: {
  order: Order;
  dispute?: Dispute | null;
  isOpen: boolean;
  onClose: () => void;
  onDeliverClick: () => void;
  onDisputeClick: () => void;
}) {
  const t = useTranslations("seller");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);

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

  const st = orderStatus(order.status, locale);
  const isProcessing = order.status === "processing";
  const isDisputed = order.status === "disputed";

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
        className="w-full max-w-xl bg-surface border border-line rounded-2xl shadow-card-lg overflow-hidden animate-rise flex flex-col max-h-[88vh]"
      >
        {/* Header */}
        <div className="p-4 border-b border-line bg-raised/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Monogram text={order.product_title || "??"} className="h-9 w-9 rounded-xl shrink-0" />
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
                {resources.slice(0, 30).map((r) => (
                  <div key={r.id} className="p-2 rounded-lg bg-raised border border-line font-mono text-[11px] flex items-center justify-between">
                    <span className="truncate max-w-[320px]">{r.data}</span>
                    <Tag tone="good" className="text-[9px]">{t("availableStatus")}</Tag>
                  </div>
                ))}
                {resources.length > 30 && (
                  <div className="p-2 text-center text-[11px] text-faint bg-raised/50 rounded-lg">
                    {t("showingResources", { count: resources.length.toLocaleString() })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Direct Actions in Drawer */}
          {isDisputed && (
            <div className="p-3 rounded-xl bg-bad-soft/30 border border-bad/30 flex items-center justify-between">
              <div>
                <div className="font-bold text-bad">{t("disputedOrderTitle")}</div>
                <div className="text-[11px] text-muted">{t("disputedOrderHint")}</div>
              </div>
              <Button size="sm" variant="danger" onClick={onDisputeClick}>
                {t("handleDispute")}
              </Button>
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
          <Link
            href={`/seller/messages?order=${order.id}`}
            className="text-xs text-iris hover:underline inline-flex items-center gap-1 font-medium"
          >
            <MessageSquare size={13} />
            <span>{t("chatWithBuyer")}</span>
          </Link>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t("close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
