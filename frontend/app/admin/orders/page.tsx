 "use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { motion } from "motion/react";
import { ChevronDown, ChevronUp, ChevronsUpDown, Search, X } from "lucide-react";
import { api, vnd, ApiError } from "@/lib/api";
import { Banner, Card, Spinner } from "@/components/ui";
import { FilterPills, SlidePanel } from "@/components/admin";
import { OrderStatusBadge } from "@/components/admin/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import type { Order, AdminOrderDetail, UsageBalance } from "@/lib/types";

const DEFAULT_PAGE_SIZE = 20;

// Status filter options
const STATUS_FILTER = [
  { key: "all", label: "Tất cả" },
  { key: "pending", label: "Chờ xử lý" },
  { key: "processing", label: "Đang xử lý" },
  { key: "delivered", label: "Đã giao" },
  { key: "completed", label: "Hoàn thành" },
  { key: "disputed", label: "Khiếu nại" },
  { key: "refunded", label: "Hoàn tiền" },
];

// Event labels for timeline
const EVENT_LABELS: Record<string, string> = {
  order_placed: "Đặt hàng",
  order_confirmed: "Xác nhận",
  order_delivered_manual: "Giao hàng (thủ công)",
  resources_assigned: "Cấp phát tài nguyên",
  dispute_opened: "Mở khiếu nại",
  dispute_refunded: "Hoàn tiền khiếu nại",
  dispute_rejected: "Từ chối khiếu nại",
};

const RESOURCE_STATUS_STYLES: Record<string, string> = {
  assigned: "bg-indigo-50 text-indigo-700 border-indigo-200",
  expired: "bg-red-50 text-red-700 border-red-200",
  error: "bg-red-50 text-red-700 border-red-200",
};

const DISPUTE_STYLES: Record<string, string> = {
  open: "bg-amber-50 text-amber-700 border-amber-200",
  resolved_refund: "bg-red-50 text-red-700 border-red-200",
  resolved_reject: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const DISPUTE_LABELS: Record<string, string> = {
  open: "Đang mở",
  resolved_refund: "Hoàn tiền",
  resolved_reject: "Từ chối",
};

// Table columns with sorting
const columns: ColumnDef<Order>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => (
      <SortHeader column={column} label="#" />
    ),
    cell: ({ row }) => (
      <span className="font-mono text-slate-400">#{row.original.id}</span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "product_title",
    header: ({ column }) => (
      <SortHeader column={column} label="Sản phẩm" />
    ),
    cell: ({ row }) => (
      <Tooltip
        text={[row.original.product_title, row.original.variant_name]
          .filter(Boolean)
          .join("\n") || `#${row.original.variant_id}`}
        side="bottom"
      >
        <div className="flex flex-col gap-0.5 max-w-[220px] cursor-pointer">
          <span className="font-medium truncate">
            {row.original.product_title ?? `Variant #${row.original.variant_id}`}
          </span>
          {row.original.variant_name && (
            <span className="text-[11.5px] text-slate-400 truncate">
              {row.original.variant_name}
            </span>
          )}
        </div>
      </Tooltip>
    ),
  },
  {
    accessorKey: "buyer_email",
    header: ({ column }) => (
      <SortHeader column={column} label="Người mua" />
    ),
    cell: ({ row }) => (
      <span className="text-slate-600 truncate max-w-[160px] block">
        {row.original.buyer_email ?? `#${row.original.buyer_id}`}
      </span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "seller_email",
    header: ({ column }) => (
      <SortHeader column={column} label="Người bán" />
    ),
    cell: ({ row }) => (
      <span className="text-slate-600 truncate max-w-[160px] block">
        {row.original.seller_email ?? `#${row.original.seller_id}`}
      </span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "quantity",
    header: ({ column }) => (
      <SortHeader column={column} label="SL" />
    ),
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">{row.original.quantity}</span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "total_amount",
    header: ({ column }) => (
      <SortHeader column={column} label="Tổng cộng" />
    ),
    cell: ({ row }) => (
      <span className="font-mono tabular-nums font-medium">
        {vnd(row.original.total_amount)}
      </span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <SortHeader column={column} label="Trạng thái" />
    ),
    cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
    enableSorting: true,
  },
  {
    accessorKey: "created_at",
    header: ({ column }) => (
      <SortHeader column={column} label="Ngày" />
    ),
    cell: ({ row }) => (
      <span className="text-slate-500">
        {new Date(row.original.created_at).toLocaleDateString("vi-VN")}
      </span>
    ),
    enableSorting: true,
  },
];

// Sort header component
function SortHeader({
  column,
  label,
}: {
  column: { getIsSorted: () => false | "asc" | "desc"; toggleSorting: (desc?: boolean) => void };
  label: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      onClick={() => column.toggleSorting(sorted === "asc")}
      className="flex items-center gap-1 group hover:text-slate-700"
    >
      {label}
      {sorted === "asc" ? (
        <ChevronUp size={13} className="text-indigo-600" />
      ) : sorted === "desc" ? (
        <ChevronDown size={13} className="text-indigo-600" />
      ) : (
        <ChevronsUpDown size={13} className="text-slate-300 group-hover:text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  );
}

// Order Detail Panel Content
const USAGE_STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected_quota: "bg-red-50 text-red-700 border-red-200",
  rejected_expired: "bg-amber-50 text-amber-700 border-amber-200",
};

function UsageSection({ orderId, usage: initial }: { orderId: number; usage: UsageBalance }) {
  const [usage, setUsage] = React.useState(initial);
  const [simulating, setSimulating] = React.useState(false);
  const [simError, setSimError] = React.useState<string | null>(null);

  const refresh = async () => {
    try {
      const detail = await api.adminOrderDetail(orderId);
      if (detail.usage) setUsage(detail.usage);
    } catch { /* giữ nguyên dữ liệu cũ nếu refetch lỗi */ }
  };

  const simulate = async () => {
    setSimulating(true);
    setSimError(null);
    try {
      await api.chargeUsage(orderId, "profile", 1);
      await refresh();
    } catch (e) {
      setSimError(e instanceof ApiError ? e.message : "Không giả lập được request");
      await refresh();
    } finally {
      setSimulating(false);
    }
  };

  const pct = usage.units_total > 0 ? Math.min(100, Math.round((usage.units_used / usage.units_total) * 100)) : 0;

  return (
    <section>
      <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
        Số dư request
      </h3>
      <Card className="p-3 space-y-3 text-[13px]">
        <div>
          <div className="flex items-end justify-between mb-1.5">
            <span className="text-slate-500 text-[11.5px]">Đã dùng / Tổng</span>
            <span className="font-mono font-semibold tabular-nums">
              {usage.units_used.toLocaleString("vi-VN")} / {usage.units_total.toLocaleString("vi-VN")}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {usage.units_remaining <= 0 ? (
          <Banner tone="bad">Đã hết số request trong gói này.</Banner>
        ) : usage.units_used / usage.units_total >= 0.8 && (
          <Banner tone="warn">Sắp hết — chỉ còn {usage.units_remaining.toLocaleString("vi-VN")} request.</Banner>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={simulate}
            disabled={simulating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md bg-slate-100 border border-slate-200 hover:border-slate-300 transition-colors disabled:opacity-50"
          >
            {simulating ? "Đang gửi…" : "Giả lập 1 request"}
          </button>
          <span className="text-[11px] text-slate-400">Công cụ debug — chưa có nhà cung cấp thật gọi vào đây.</span>
        </div>
        {simError && <p className="text-[12px] text-red-600">{simError}</p>}

        {usage.records.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="px-3 py-2 font-medium">Lúc</th>
                  <th className="px-3 py-2 font-medium">Endpoint</th>
                  <th className="px-3 py-2 font-medium">Trừ</th>
                  <th className="px-3 py-2 font-medium">Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {usage.records.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 text-slate-500">{new Date(r.created_at).toLocaleString("vi-VN")}</td>
                    <td className="px-3 py-2 font-mono">{r.endpoint}</td>
                    <td className="px-3 py-2 tabular-nums">−{r.units}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${USAGE_STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {r.status === "ok" ? "Thành công" : r.status === "rejected_quota" ? "Hết credit" : "Hết hạn"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}

function OrderDetailContent({ orderId }: { orderId: number }) {
  const [detail, setDetail] = React.useState<AdminOrderDetail | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    api
      .adminOrderDetail(orderId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return <Spinner />;
  if (!detail) return <p className="text-[13px] text-slate-500 p-5">Không thể tải thông tin đơn hàng.</p>;

  return (
    <div className="space-y-6">
      {/* Order Info */}
      <section>
        <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
          Thông tin đơn hàng
        </h3>
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          <div>
            <p className="text-slate-500 text-[11.5px]">Sản phẩm</p>
            <p className="font-medium">{detail.product_title ?? `Variant #${detail.variant_id}`}</p>
            {detail.variant_name && <p className="text-[11.5px] text-slate-400">{detail.variant_name}</p>}
          </div>
          <div>
            <p className="text-slate-500 text-[11.5px]">Tổng cộng</p>
            <p className="font-mono font-semibold">{vnd(detail.total_amount)}</p>
          </div>
          <div>
            <p className="text-slate-500 text-[11.5px]">Người mua</p>
            <p>{detail.buyer_email ?? `#${detail.buyer_id}`}</p>
          </div>
          <div>
            <p className="text-slate-500 text-[11.5px]">Người bán</p>
            <p>{detail.seller_email ?? `#${detail.seller_id}`}</p>
          </div>
          <div>
            <p className="text-slate-500 text-[11.5px]">Trạng thái</p>
            <OrderStatusBadge status={detail.status} />
          </div>
          <div>
            <p className="text-slate-500 text-[11.5px]">Số lượng</p>
            <p className="font-mono">{detail.quantity}</p>
          </div>
        </div>
      </section>

      {/* Timeline */}
      {detail.timeline.length > 0 && (
        <section>
          <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Dòng thời gian
          </h3>
          <div className="relative pl-5">
            <div className="absolute left-[7px] top-1 bottom-1 w-px bg-slate-200" />
            {detail.timeline.map((evt, i) => {
              const isLast = i === detail.timeline.length - 1;
              return (
                <div key={i} className="relative pb-4 last:pb-0">
                  <div
                    className={`absolute -left-5 top-[5px] w-[10px] h-[10px] rounded-full border-2 ${
                      isLast ? "bg-indigo-500 border-indigo-500" : "bg-white border-slate-200"
                    }`}
                  />
                  <p className={`text-[13px] font-medium ${isLast ? "text-slate-900" : "text-slate-500"}`}>
                    {EVENT_LABELS[evt.event] || evt.event}
                  </p>
                  <p className="text-[11.5px] text-slate-400">
                    {new Date(evt.timestamp).toLocaleString("vi-VN")}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Resources */}
      {detail.resources.length > 0 && (
        <section>
          <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Tài nguyên ({detail.resources.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                  <th className="px-3 py-2 font-medium">Hết hạn</th>
                </tr>
              </thead>
              <tbody>
                {detail.resources.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-mono">#{r.id}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${RESOURCE_STATUS_STYLES[r.status] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.expires_at ? new Date(r.expires_at).toLocaleDateString("vi-VN") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Usage / số dư request — chỉ có với sản phẩm dạng credit (endpoint) */}
      {detail.usage && <UsageSection orderId={detail.id} usage={detail.usage} />}

      {/* Dispute */}
      {detail.dispute && (
        <section>
          <h3 className="text-[12px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Khiếu nại
          </h3>
          <Card className="p-3 space-y-2 text-[13px]">
            <div>
              <p className="text-slate-500 text-[11.5px]">Lý do</p>
              <p>{detail.dispute.reason}</p>
            </div>
            <div className="flex gap-4">
              <div>
                <p className="text-slate-500 text-[11.5px]">Trạng thái</p>
                <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${DISPUTE_STYLES[detail.dispute.status] ?? ""}`}>
                  {DISPUTE_LABELS[detail.dispute.status] ?? detail.dispute.status}
                </span>
              </div>
              {detail.dispute.resolved_at && (
                <div>
                  <p className="text-slate-500 text-[11.5px]">Giải quyết lúc</p>
                  <p className="text-[12px]">{new Date(detail.dispute.resolved_at).toLocaleString("vi-VN")}</p>
                </div>
              )}
            </div>
            {detail.dispute.admin_note && (
              <div>
                <p className="text-slate-500 text-[11.5px]">Ghi chú admin</p>
                <p className="text-[12px] italic">{detail.dispute.admin_note}</p>
              </div>
            )}
          </Card>
        </section>
      )}
    </div>
  );
}

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = React.useState(value);
  React.useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export default function AdminOrdersPage() {
  const searchParams = useSearchParams();

  // Filter & pagination state
  const [status, setStatus] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [perPage] = React.useState(DEFAULT_PAGE_SIZE);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [selectedOrderId, setSelectedOrderId] = React.useState<number | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  // Reset page when filters change
  React.useEffect(() => {
    setPage(1);
  }, [status, debouncedSearch]);

  // Handle ?highlight=X query param
  React.useEffect(() => {
    const highlight = searchParams.get("highlight");
    if (highlight) {
      const id = parseInt(highlight, 10);
      if (!isNaN(id)) setSelectedOrderId(id);
    }
  }, [searchParams]);

  // Fetch all orders via admin endpoint (returns flat Order[])
  const queryResult = useQuery({
    queryKey: ["admin", "orders"] as const,
    queryFn: () => api.adminOrders(),
    staleTime: 30_000,
  });

  const allOrders = queryResult.data ?? [];

  // Stats computed from all orders
  const stats = React.useMemo(() => ({
    total: allOrders.length,
    pending: allOrders.filter((o) => o.status === "pending").length,
    processing: allOrders.filter((o) => o.status === "processing" || o.status === "accepted").length,
    completed: allOrders.filter((o) => o.status === "completed" || o.status === "confirmed").length,
    disputed: allOrders.filter((o) => o.status === "disputed").length,
  }), [allOrders]);

  // Client-side filtering
  const filteredOrders = React.useMemo(() => {
    let result = allOrders;
    if (status !== "all") {
      result = result.filter((o) => o.status === status);
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      result = result.filter((o) =>
        String(o.id).includes(q) ||
        (o.buyer_email?.toLowerCase().includes(q)) ||
        (o.seller_email?.toLowerCase().includes(q)) ||
        (o.product_title?.toLowerCase().includes(q))
      );
    }
    return result;
  }, [allOrders, status, debouncedSearch]);

  const total = filteredOrders.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // Client-side pagination
  const orders = React.useMemo(
    () => filteredOrders.slice((page - 1) * perPage, page * perPage),
    [filteredOrders, page, perPage]
  );

  // Table setup
  const table = useReactTable({
    data: orders,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const loadingOrFetching = queryResult.isLoading || queryResult.isFetching;

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] text-slate-500">Tổng đơn hàng</p>
              <p className="text-[24px] font-semibold font-mono tabular-nums">
                {stats.total.toLocaleString("vi-VN")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              {[
                { label: "Chờ xử lý", value: stats.pending, color: "text-amber-600" },
                { label: "Đang xử lý", value: stats.processing, color: "text-indigo-600" },
                { label: "Hoàn thành", value: stats.completed, color: "text-emerald-600" },
                { label: "Khiếu nại", value: stats.disputed, color: "text-red-600" },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-slate-500">{s.label}</p>
                  <p className={`font-semibold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Filters + Search */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="p-0">
          <div className="px-4 py-3 border-b border-slate-200">
            {/* Top row: filters + search */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
              <FilterPills
                options={STATUS_FILTER}
                value={status}
                onChange={(v) => { setStatus(v); setPage(1); }}
                className="flex-1 sm:flex-none"
              />
              <div className="relative flex-1 max-w-xs">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Tìm theo mã đơn, email..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="w-full h-9 pl-9 pr-8 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                />
                {search && (
                  <button
                    onClick={() => { setSearch(""); setPage(1); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="relative">
            {loadingOrFetching && (
              <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center">
                <span className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-indigo-600 animate-spin" />
              </div>
            )}

            {orders.length === 0 && !queryResult.isLoading ? (
              <div className="px-4 py-12 text-center">
                <p className="text-[13px] text-slate-500">
                  {stats.total === 0 ? "Chưa có đơn hàng nào." : "Không tìm thấy đơn hàng phù hợp."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/50">
                      {table.getHeaderGroups()[0].headers.map((header) => (
                        <th
                          key={header.id}
                          className="px-4 py-2.5 font-medium"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {queryResult.isLoading ? (
                      // Skeleton rows
                      Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          {columns.map((_, j) => (
                            <td key={j} className="px-4 py-3">
                              <div className="h-4 bg-slate-100 rounded animate-pulse" style={{ width: `${60 + Math.random() * 40}%` }} />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      table.getRowModel().rows.map((row) => (
                        <tr
                          key={row.id}
                          onClick={() => setSelectedOrderId(row.original.id)}
                          className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors"
                        >
                          {row.getVisibleCells().map((cell) => (
                            <td key={cell.id} className="px-4 py-2.5">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pagination */}
          {total > 0 && (
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
              <span className="text-[12px] text-slate-500">
                Hiển thị {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} / {total.toLocaleString("vi-VN")} đơn hàng
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="h-8 px-3 rounded-lg text-[12px] font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ←
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`h-8 w-8 rounded-lg text-[12px] font-medium transition-colors ${
                        page === pageNum
                          ? "bg-indigo-600 text-white"
                          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="h-8 px-3 rounded-lg text-[12px] font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  →
                </button>
              </div>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Detail Panel */}
      <SlidePanel
        isOpen={selectedOrderId !== null}
        onClose={() => setSelectedOrderId(null)}
        title={`Đơn hàng #${selectedOrderId}`}
        width="lg"
      >
        {selectedOrderId !== null && (
          <OrderDetailContent orderId={selectedOrderId} />
        )}
      </SlidePanel>
    </div>
  );
}
