"use client";
/* Hallmark · component: admin orders console · theme: project Proxora (slate canvas · iris accent) · P4 H5 E4 S4 R4 V4 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/lib/hooks/useDebounce";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  ListFilter,
  Search,
  X,
} from "lucide-react";
import { api, vnd, ApiError } from "@/lib/api";
import { Banner, Card, Spinner } from "@/components/ui";
import { FacetSelect, SlidePanel, buildFacetOptions } from "@/components/admin";
import { OrderStatusBadge } from "@/components/admin/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import type { Order, AdminOrderDetail, UsageBalance } from "@/lib/types";

const DEFAULT_PAGE_SIZE = 20;

// Tab trạng thái — statuses gom nhóm theo nghĩa hiển thị (status-config.ts),
// color dùng chung cho chấm trên tab và đoạn tương ứng trong thanh phân bố.
const STATUS_TABS: {
  key: string;
  label: string;
  statuses: string[];
  color?: string;
}[] = [
  { key: "all", label: "Tất cả", statuses: [] },
  { key: "pending", label: "Chờ xử lý", statuses: ["pending"], color: "bg-amber-400" },
  { key: "processing", label: "Đang xử lý", statuses: ["processing", "accepted"], color: "bg-indigo-400" },
  { key: "delivered", label: "Đã giao", statuses: ["delivered"], color: "bg-sky-400" },
  { key: "completed", label: "Hoàn thành", statuses: ["completed", "confirmed"], color: "bg-emerald-400" },
  { key: "disputed", label: "Khiếu nại", statuses: ["disputed"], color: "bg-red-400" },
  { key: "refunded", label: "Hoàn tiền", statuses: ["refunded"], color: "bg-rose-300" },
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

// Cột số căn phải (header lẫn cell)
const RIGHT_COLS = new Set(["quantity", "total_amount"]);

const SKELETON_WIDTHS = ["45%", "80%", "65%", "60%", "30%", "55%", "50%", "40%"];

interface OrdersTableMeta {
  filterSeller: (id: number) => void;
  filterBuyer: (id: number) => void;
}

// Cell email bấm được để lọc nhanh theo người đó
function PartyCell({
  email,
  id,
  onFilter,
  filterLabel,
}: {
  email: string | null | undefined;
  id: number;
  onFilter: (id: number) => void;
  filterLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onFilter(id);
      }}
      title={filterLabel}
      className="group/party flex max-w-[170px] items-center gap-1 text-slate-600 hover:text-indigo-700 transition-colors"
    >
      <span className="truncate">{email ?? `#${id}`}</span>
      <ListFilter
        size={11}
        className="shrink-0 text-indigo-500 opacity-0 group-hover/party:opacity-100 transition-opacity"
      />
    </button>
  );
}

// Table columns with sorting
const columns: ColumnDef<Order>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => <SortHeader column={column} label="#" />,
    cell: ({ row }) => (
      <span className="font-mono text-slate-400">#{row.original.id}</span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "product_title",
    header: ({ column }) => <SortHeader column={column} label="Sản phẩm" />,
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
    header: ({ column }) => <SortHeader column={column} label="Người mua" />,
    cell: ({ row, table }) => (
      <PartyCell
        email={row.original.buyer_email}
        id={row.original.buyer_id}
        onFilter={(table.options.meta as OrdersTableMeta).filterBuyer}
        filterLabel="Lọc theo người mua này"
      />
    ),
    enableSorting: true,
  },
  {
    accessorKey: "seller_email",
    header: ({ column }) => <SortHeader column={column} label="Người bán" />,
    cell: ({ row, table }) => (
      <PartyCell
        email={row.original.seller_email}
        id={row.original.seller_id}
        onFilter={(table.options.meta as OrdersTableMeta).filterSeller}
        filterLabel="Lọc theo người bán này"
      />
    ),
    enableSorting: true,
  },
  {
    accessorKey: "quantity",
    header: ({ column }) => <SortHeader column={column} label="SL" />,
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">{row.original.quantity}</span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "total_amount",
    header: ({ column }) => <SortHeader column={column} label="Tổng cộng" />,
    cell: ({ row }) => (
      <span className="font-mono tabular-nums font-medium">
        {vnd(row.original.total_amount)}
      </span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "status",
    header: ({ column }) => <SortHeader column={column} label="Trạng thái" />,
    cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
    enableSorting: true,
  },
  {
    accessorKey: "created_at",
    header: ({ column }) => <SortHeader column={column} label="Ngày" />,
    cell: ({ row }) => (
      <span
        className="text-slate-500"
        title={new Date(row.original.created_at).toLocaleString("vi-VN")}
      >
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
      className="inline-flex items-center gap-1 group hover:text-slate-700"
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

export default function AdminOrdersPage() {
  const searchParams = useSearchParams();

  // Filter & pagination state
  const [status, setStatus] = React.useState("all");
  const [sellerId, setSellerId] = React.useState<string | null>(null);
  const [buyerId, setBuyerId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [selectedOrderId, setSelectedOrderId] = React.useState<number | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  // Reset page when filters change
  React.useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [status, sellerId, buyerId, debouncedSearch]);

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

  const allOrders = React.useMemo(() => queryResult.data ?? [], [queryResult.data]);

  // Tầng lọc: search → (người bán ∩ người mua) → trạng thái.
  // Dải chỉ số + tab đếm theo scope (chưa áp trạng thái) để chuyển tab
  // không làm số liệu tự co giãn theo chính nó.
  const searchScope = React.useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return allOrders;
    return allOrders.filter(
      (o) =>
        String(o.id).includes(q) ||
        o.buyer_email?.toLowerCase().includes(q) ||
        o.seller_email?.toLowerCase().includes(q) ||
        o.product_title?.toLowerCase().includes(q)
    );
  }, [allOrders, debouncedSearch]);

  // Facet nào cũng đếm trong phạm vi đã áp facet còn lại (cross-filter)
  const sellerOptions = React.useMemo(
    () =>
      buildFacetOptions(
        buyerId !== null ? searchScope.filter((o) => String(o.buyer_id) === buyerId) : searchScope,
        allOrders,
        sellerId,
        (o) => String(o.seller_id),
        (o) => o.seller_email
      ),
    [searchScope, allOrders, sellerId, buyerId]
  );

  const buyerOptions = React.useMemo(
    () =>
      buildFacetOptions(
        sellerId !== null ? searchScope.filter((o) => String(o.seller_id) === sellerId) : searchScope,
        allOrders,
        buyerId,
        (o) => String(o.buyer_id),
        (o) => o.buyer_email
      ),
    [searchScope, allOrders, sellerId, buyerId]
  );

  const scope = React.useMemo(
    () =>
      searchScope.filter(
        (o) =>
          (sellerId === null || String(o.seller_id) === sellerId) &&
          (buyerId === null || String(o.buyer_id) === buyerId)
      ),
    [searchScope, sellerId, buyerId]
  );

  const tabCounts = React.useMemo(() => {
    const counts: Record<string, number> = { all: scope.length };
    for (const tab of STATUS_TABS) {
      if (tab.key === "all") continue;
      counts[tab.key] = scope.filter((o) => tab.statuses.includes(o.status)).length;
    }
    return counts;
  }, [scope]);

  // Đoạn cho thanh phân bố: các nhóm trạng thái + phần "khác" (vd. đã hủy)
  const barSegments = React.useMemo(() => {
    const segments = STATUS_TABS.filter((t) => t.key !== "all").map((t) => ({
      key: t.key,
      label: t.label,
      count: tabCounts[t.key] ?? 0,
      color: t.color!,
      clickable: true,
    }));
    const covered = segments.reduce((sum, s) => sum + s.count, 0);
    const other = scope.length - covered;
    if (other > 0) {
      segments.push({ key: "other", label: "Khác", count: other, color: "bg-slate-300", clickable: false });
    }
    return segments.filter((s) => s.count > 0);
  }, [tabCounts, scope.length]);

  const totalValue = React.useMemo(
    () => scope.reduce((sum, o) => sum + o.total_amount, 0),
    [scope]
  );

  const filteredOrders = React.useMemo(() => {
    if (status === "all") return scope;
    const tab = STATUS_TABS.find((t) => t.key === status);
    if (!tab) return scope;
    return scope.filter((o) => tab.statuses.includes(o.status));
  }, [scope, status]);

  const total = filteredOrders.length;
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));

  // Bảo hiểm khi dữ liệu co lại còn ít trang hơn trang hiện tại
  React.useEffect(() => {
    setPagination((p) =>
      p.pageIndex > 0 && p.pageIndex >= totalPages ? { ...p, pageIndex: 0 } : p
    );
  }, [totalPages]);

  const tableMeta = React.useMemo<OrdersTableMeta>(
    () => ({
      filterSeller: (id: number) => setSellerId(String(id)),
      filterBuyer: (id: number) => setBuyerId(String(id)),
    }),
    []
  );

  // Sort toàn bộ kết quả lọc rồi mới phân trang (trước đây chỉ sort
  // trong trang hiện tại nên bấm sort gần như vô nghĩa)
  const table = useReactTable({
    data: filteredOrders,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
    meta: tableMeta,
  });

  const page = pagination.pageIndex + 1;
  const loadingOrFetching = queryResult.isLoading || queryResult.isFetching;
  const hasFilters =
    status !== "all" || sellerId !== null || buyerId !== null || search.trim() !== "";

  const clearFilters = () => {
    setStatus("all");
    setSellerId(null);
    setBuyerId(null);
    setSearch("");
  };

  return (
    <div className="animate-rise">
      <Card className="p-0">
        {/* Dải chỉ số + thanh phân bố trạng thái (theo phạm vi đang lọc) */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-4 pt-4 pb-3">
          <div className="flex items-baseline gap-8">
            <div>
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-slate-400">
                Đơn hàng
              </p>
              <p className="text-[26px] leading-8 font-semibold font-mono tabular-nums text-slate-900">
                {scope.length.toLocaleString("vi-VN")}
              </p>
            </div>
            <div>
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-slate-400">
                Tổng giá trị
              </p>
              <p className="text-[20px] leading-8 font-semibold font-mono tabular-nums text-slate-900">
                {vnd(totalValue)}
              </p>
            </div>
          </div>

          {scope.length > 0 && (
            <div className="w-full min-w-[240px] flex-1 sm:w-auto sm:max-w-sm">
              <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                {barSegments.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => s.clickable && setStatus(s.key)}
                    title={`${s.label}: ${s.count.toLocaleString("vi-VN")} đơn`}
                    aria-label={`${s.label}: ${s.count.toLocaleString("vi-VN")} đơn`}
                    className={`${s.color} min-w-[5px] transition-opacity hover:opacity-75 ${
                      s.clickable ? "" : "cursor-default"
                    }`}
                    style={{ flexGrow: s.count, flexBasis: 0 }}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-right text-[11px] text-slate-400">
                Phân bố trạng thái — bấm một đoạn để lọc
              </p>
            </div>
          )}
        </div>

        {/* Bộ lọc: người bán · người mua · tìm kiếm */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <FacetSelect
            label="Người bán"
            options={sellerOptions}
            value={sellerId}
            onChange={setSellerId}
          />
          <FacetSelect
            label="Người mua"
            options={buyerOptions}
            value={buyerId}
            onChange={setBuyerId}
          />
          <div className="relative min-w-[180px] max-w-xs flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="search"
              aria-label="Tìm mã đơn, email, sản phẩm"
              placeholder="Tìm mã đơn, email, sản phẩm…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-8 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Xóa tìm kiếm"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              <X size={13} />
              Xóa lọc
            </button>
          )}
        </div>

        {/* Tab trạng thái với số đếm */}
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-slate-200 px-2">
          {STATUS_TABS.map((t) => {
            const active = status === t.key;
            const count = tabCounts[t.key] ?? 0;
            return (
              <button
                key={t.key}
                onClick={() => setStatus(t.key)}
                aria-pressed={active}
                className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] font-medium transition-colors ${
                  active
                    ? "border-indigo-600 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {t.color && <span className={`h-1.5 w-1.5 rounded-full ${t.color}`} />}
                {t.label}
                <span
                  className={`tabular-nums text-[11px] ${
                    active ? "font-semibold text-indigo-600" : "text-slate-400"
                  }`}
                >
                  {count.toLocaleString("vi-VN")}
                </span>
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div className="relative">
          {loadingOrFetching && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
            </div>
          )}

          {queryResult.isError && (
            <div className="px-4 py-3">
              <Banner tone="bad">Không tải được danh sách đơn hàng. Thử tải lại trang.</Banner>
            </div>
          )}

          {total === 0 && !queryResult.isLoading ? (
            <div className="px-4 py-14 text-center">
              <p className="text-[13px] text-slate-500">
                {allOrders.length === 0
                  ? "Chưa có đơn hàng nào."
                  : "Không có đơn hàng khớp bộ lọc hiện tại."}
              </p>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                >
                  <X size={13} />
                  Xóa bộ lọc
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-slate-500">
                    {table.getHeaderGroups()[0].headers.map((header) => (
                      <th
                        key={header.id}
                        className={`px-4 py-2.5 font-medium ${
                          RIGHT_COLS.has(header.column.id) ? "text-right" : ""
                        }`}
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
                            <div
                              className="h-4 animate-pulse rounded bg-slate-100"
                              style={{ width: SKELETON_WIDTHS[j % SKELETON_WIDTHS.length] }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    table.getRowModel().rows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedOrderId(row.original.id)}
                        className="cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className={`px-4 py-2.5 ${
                              RIGHT_COLS.has(cell.column.id) ? "text-right" : ""
                            }`}
                          >
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
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <span className="text-[12px] text-slate-500 tabular-nums">
              Hiển thị {(page - 1) * pagination.pageSize + 1}–
              {Math.min(page * pagination.pageSize, total)} / {total.toLocaleString("vi-VN")} đơn hàng
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
                    onClick={() => table.setPageIndex(pageNum - 1)}
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
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                →
              </button>
            </div>
          </div>
        )}
      </Card>

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
