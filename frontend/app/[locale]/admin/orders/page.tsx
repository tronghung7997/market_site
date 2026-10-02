"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/lib/hooks/useDebounce";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Row,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, ListFilter, Search, X } from "@/components/Icons";
import { api, vnd } from "@/lib/api";
import { Banner, Card } from "@/components/ui";
import { FacetSelect, InfoTip, type FacetOption } from "@/components/admin";
import { OrderStatusBadge } from "@/components/admin/status-badge";
import { ORDER_STATUS } from "@/components/admin/status-config";
import { Tooltip } from "@/components/ui/tooltip";
import type { AdminOrderBurst, AdminOrderFacet, AdminOrderSort, Order } from "@/lib/types";
import {
  AttentionQueue,
  escrowHint,
  formatSpan,
  formatWhen,
  groupRuns,
  OrderQuickView,
  PulseStrip,
} from "@/features/admin-orders";

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
  { key: "pending", label: "Chờ xử lý", statuses: ["pending"], color: "bg-warn" },
  { key: "processing", label: "Đang xử lý", statuses: ["processing", "accepted"], color: "bg-iris" },
  { key: "delivered", label: "Đã giao", statuses: ["delivered"], color: "bg-iris/60" },
  { key: "completed", label: "Hoàn thành", statuses: ["completed", "confirmed"], color: "bg-good" },
  { key: "disputed", label: "Khiếu nại", statuses: ["disputed"], color: "bg-bad" },
  { key: "refunded", label: "Hoàn tiền", statuses: ["refunded"], color: "bg-faint" },
];

// Cột số căn phải (header lẫn cell)
const RIGHT_COLS = new Set(["total_amount"]);

// Sorting runs on the server (the list is paged there): only these columns sort.
function serverSort(sorting: SortingState): AdminOrderSort {
  const [first] = sorting;
  if (!first) return "newest";
  if (first.id === "total_amount") return first.desc ? "amount_desc" : "amount_asc";
  if (first.id === "quantity") return first.desc ? "quantity_desc" : "quantity_asc";
  return first.desc ? "newest" : "oldest"; // id / created_at
}

function facetOptions(facets: AdminOrderFacet[] | undefined): FacetOption[] {
  return (facets ?? []).map((f) => ({ key: String(f.id), label: f.email ?? `#${f.id}`, count: f.count }));
}

const SKELETON_WIDTHS = ["45%", "80%", "65%", "60%", "30%", "55%", "50%", "40%"];

interface OrdersTableMeta {
  filterSeller: (id: number) => void;
  filterBuyer: (id: number) => void;
}

// Email là chữ thường (bấm vào dòng vẫn mở xem nhanh); chỉ icon nhỏ cạnh
// email là nút lọc, để không lỡ tay lọc khi định mở đơn.
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
  const label = email ?? `#${id}`;
  return (
    <span className="flex max-w-[170px] items-center gap-0.5 text-muted">
      <span className="min-w-0 truncate" title={label}>{label}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onFilter(id);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        title={filterLabel}
        aria-label={`${filterLabel}: ${label}`}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-iris-soft hover:text-iris-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
      >
        <ListFilter size={12} />
      </button>
    </span>
  );
}

// Table columns with sorting
const columns: ColumnDef<Order>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => <SortHeader column={column} label="#" />,
    cell: ({ row }) => (
      <span className="font-mono text-muted" title={`#${row.original.id}`}>
        {row.original.order_code ?? `#${row.original.id}`}
      </span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "product_title",
    header: "Sản phẩm",
    enableSorting: false,
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
            {row.original.quantity > 1 && (
              <span className="ml-1.5 font-mono text-[12px] font-normal text-muted">× {row.original.quantity.toLocaleString("vi-VN")}</span>
            )}
          </span>
          {row.original.variant_name && (
            <span className="text-[11.5px] text-faint truncate">
              {row.original.variant_name}
            </span>
          )}
        </div>
      </Tooltip>
    ),
  },
  {
    id: "parties",
    header: () => (
      <span className="inline-flex items-center">
        Người mua → Shop
        <InfoTip label="Người mua → Shop" text="Ai mua, mua của shop nào. Bấm icon lọc cạnh email để chỉ xem đơn của người đó; bấm vào chỗ khác trên dòng để xem nhanh đơn." />
      </span>
    ),
    cell: ({ row, table }) => {
      const meta = table.options.meta as OrdersTableMeta;
      return (
        <div className="flex items-center gap-1">
          <PartyCell email={row.original.buyer_email} id={row.original.buyer_id} onFilter={meta.filterBuyer} filterLabel="Lọc theo người mua này" />
          <span className="text-faint" aria-hidden="true">→</span>
          <PartyCell email={row.original.seller_email} id={row.original.seller_id} onFilter={meta.filterSeller} filterLabel="Lọc theo shop này" />
        </div>
      );
    },
    enableSorting: false,
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
    header: () => (
      <span className="inline-flex items-center">
        Trạng thái
        <InfoTip label="Trạng thái" text="Đơn đã giao: tiền khách trả còn được sàn giữ trong thời gian bảo hành. Dòng nhỏ bên dưới cho biết khi nào tiền tự trả cho seller; “hết hạn giữ · chờ trả seller” nghĩa là đã hết thời gian giữ mà không có khiếu nại; hệ thống tự trả cho seller trong vòng 30 phút (job chạy mỗi 30 phút)." />
      </span>
    ),
    cell: ({ row }) => {
      const hint = escrowHint(row.original.status, row.original.escrow_expires_at);
      return (
        <div className="flex flex-col items-start gap-0.5">
          <OrderStatusBadge status={row.original.status} />
          {hint && <span className="text-[11px] text-faint">{hint}</span>}
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "created_at",
    header: ({ column }) => <SortHeader column={column} label="Thời gian" />,
    cell: ({ row }) => (
      <span
        className="whitespace-nowrap font-mono text-[12px] text-muted"
        title={new Date(row.original.created_at).toLocaleString("vi-VN")}
      >
        {formatWhen(row.original.created_at)}
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
      className="inline-flex items-center gap-1 group hover:text-fg"
    >
      {label}
      {sorted === "asc" ? (
        <ChevronUp size={13} className="text-iris-hi" />
      ) : sorted === "desc" ? (
        <ChevronDown size={13} className="text-iris-hi" />
      ) : (
        <ChevronsUpDown size={13} className="text-faint group-hover:text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  );
}

// Read by features/admin-order (OrderPage) to decide how "back" works.
const ORDER_LIST_MARK = "admin-orders:opened-from-list";

export default function AdminOrdersPage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  // Filter, sort and page live in the URL: opening an order and pressing
  // Back returns to exactly this view instead of an unfiltered page 1.
  const [status, setStatus] = React.useState(() => searchParams.get("s") ?? "all");
  const [sellerId, setSellerId] = React.useState<string | null>(() => searchParams.get("seller"));
  const [buyerId, setBuyerId] = React.useState<string | null>(() => searchParams.get("buyer"));
  const [search, setSearch] = React.useState(() => searchParams.get("q") ?? "");
  const [sorting, setSorting] = React.useState<SortingState>(() => {
    const [id, dir] = (searchParams.get("sort") ?? "").split(":");
    return id ? [{ id, desc: dir === "desc" }] : [];
  });
  const [pagination, setPagination] = React.useState(() => ({
    pageIndex: Math.max(0, (Number(searchParams.get("p")) || 1) - 1),
    pageSize: DEFAULT_PAGE_SIZE,
  }));

  const debouncedSearch = useDebounce(search, 300);

  // Reset to page 1 only when a filter actually changes — not on mount (or
  // React's dev double-mount), which must keep the page restored from the URL.
  const filterKey = JSON.stringify([status, sellerId, buyerId, debouncedSearch.trim()]);
  const lastFilterKey = React.useRef(filterKey);
  React.useEffect(() => {
    if (lastFilterKey.current === filterKey) return;
    lastFilterKey.current = filterKey;
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [filterKey]);

  React.useEffect(() => {
    const q = new URLSearchParams();
    if (status !== "all") q.set("s", status);
    if (sellerId) q.set("seller", sellerId);
    if (buyerId) q.set("buyer", buyerId);
    if (debouncedSearch.trim()) q.set("q", debouncedSearch.trim());
    if (sorting[0]) q.set("sort", `${sorting[0].id}:${sorting[0].desc ? "desc" : "asc"}`);
    if (pagination.pageIndex > 0) q.set("p", String(pagination.pageIndex + 1));
    const qs = q.toString();
    window.history.replaceState(window.history.state, "", qs ? `${pathname}?${qs}` : pathname);
  }, [status, sellerId, buyerId, debouncedSearch, sorting, pagination.pageIndex, pathname]);

  // Old deep links (?highlight=ID) now open the order page.
  React.useEffect(() => {
    const id = Number(searchParams.get("highlight") ?? searchParams.get("order"));
    if (Number.isSafeInteger(id) && id > 0) router.replace(`/admin/orders/${id}`);
  }, [searchParams, router]);

  // Click reads the order in the quick view; Cmd/Ctrl-click opens it in a tab.
  const openRow = (id: number, event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      openOrder(id, event);
      return;
    }
    setQuickId(id);
  };

  const openOrder = (id: number, event: React.MouseEvent) => {
    try {
      // Lets the order page's "back" return here (filters, page, scroll) via history.
      sessionStorage.setItem(ORDER_LIST_MARK, JSON.stringify({ id, url: `${window.location.pathname}${window.location.search}` }));
    } catch { /* storage blocked: back falls back to the plain list */ }
    if (event.metaKey || event.ctrlKey) {
      window.open(`${pathname}/${id}`, "_blank", "noopener");
      return;
    }
    router.push(`/admin/orders/${id}`);
  };

  // One server page plus the console's counts: the backend filters, counts,
  // sorts and pages (the full order table never reaches the browser).
  const activeTab = STATUS_TABS.find((t) => t.key === status);
  const params = {
    q: debouncedSearch.trim() || undefined,
    statuses: activeTab && activeTab.key !== "all" ? activeTab.statuses : undefined,
    seller_id: sellerId ? Number(sellerId) : undefined,
    buyer_id: buyerId ? Number(buyerId) : undefined,
    sort: serverSort(sorting),
    page: pagination.pageIndex + 1,
    per_page: pagination.pageSize,
  };
  const queryResult = useQuery({
    queryKey: ["admin", "orders", params] as const,
    queryFn: () => api.adminOrders(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const data = queryResult.data;
  const pageOrders = React.useMemo(() => data?.items ?? [], [data]);

  const sellerOptions = React.useMemo(() => facetOptions(data?.sellers), [data?.sellers]);
  const buyerOptions = React.useMemo(() => facetOptions(data?.buyers), [data?.buyers]);

  // Tabs and the distribution bar count the search + party scope (before the
  // status filter), so switching tabs does not resize the numbers themselves.
  const tabCounts = React.useMemo(() => {
    const byStatus = data?.status_counts ?? {};
    const counts: Record<string, number> = { all: Object.values(byStatus).reduce((a, b) => a + b, 0) };
    for (const tab of STATUS_TABS) {
      if (tab.key === "all") continue;
      counts[tab.key] = tab.statuses.reduce((sum, st) => sum + (byStatus[st] ?? 0), 0);
    }
    return counts;
  }, [data?.status_counts]);
  const scopeCount = tabCounts.all ?? 0;

  const totalValue = data?.scope_value ?? 0;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));

  // Bảo hiểm khi dữ liệu co lại còn ít trang hơn trang hiện tại
  // Only once data is in: before that there is "1 page" and a page restored
  // from the URL would be thrown away.
  const loaded = data !== undefined;
  React.useEffect(() => {
    if (!loaded) return;
    setPagination((p) =>
      p.pageIndex > 0 && p.pageIndex >= totalPages ? { ...p, pageIndex: 0 } : p
    );
  }, [totalPages, loaded]);

  // Console header: today, escrow, dispute rate and the attention queue.
  const pulseQuery = useQuery({
    queryKey: ["admin", "orders", "pulse"] as const,
    queryFn: () => api.adminOrdersPulse(Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Ho_Chi_Minh"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const pulse = pulseQuery.data;
  const attentionCount = pulse ? pulse.disputed.length + pulse.stuck.length + pulse.bursts.length : 0;
  const attentionRef = React.useRef<HTMLElement>(null);
  const filterBurst = (b: AdminOrderBurst) => {
    setStatus("all");
    setSearch("");
    setBuyerId(String(b.buyer_id));
    setSellerId(String(b.seller_id));
  };

  // Back-to-back orders of one buyer for one item fold into one row.
  const [grouped, setGrouped] = React.useState(true);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const toggleGroup = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Quick view: a row click reads the order here; the full case opens from it.
  const [quickId, setQuickId] = React.useState<number | null>(null);
  const quickOrder = pageOrders.find((o) => o.id === quickId) ?? null;
  // J/K step through the rows the admin can see: a collapsed group is one
  // stop (its first order), an expanded one is each of its orders.
  const runs = React.useMemo(
    () => (grouped ? groupRuns(pageOrders) : pageOrders.map((order) => ({ kind: "single" as const, order }))),
    [grouped, pageOrders],
  );
  const visibleIds = React.useMemo(
    () => runs.flatMap((run) => (run.kind === "single" ? [run.order.id] : expanded.has(run.key) ? run.orders.map((o) => o.id) : [run.orders[0].id])),
    [runs, expanded],
  );
  const stepQuick = React.useCallback(
    (dir: -1 | 1) => {
      setQuickId((current) => {
        const at = visibleIds.indexOf(current ?? -1);
        const next = at === -1 ? visibleIds[0] : visibleIds[at + dir];
        return next ?? current;
      });
    },
    [visibleIds]
  );
  React.useEffect(() => {
    if (quickId === null) return;
    // Only J/K: the arrow keys keep scrolling the panel and the page.
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "j") { e.preventDefault(); stepQuick(1); }
      if (e.key === "k") { e.preventDefault(); stepQuick(-1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [quickId, stepQuick]);

  const tableMeta = React.useMemo<OrdersTableMeta>(
    () => ({
      filterSeller: (id: number) => setSellerId(String(id)),
      filterBuyer: (id: number) => setBuyerId(String(id)),
    }),
    []
  );

  // Sorting and paging are the server's (manual): the table renders one page.
  const table = useReactTable({
    data: pageOrders,
    columns,
    state: { sorting, pagination },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    pageCount: totalPages,
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
    <div className="animate-rise flex flex-col gap-3">
      <PulseStrip
        pulse={pulse}
        attentionCount={attentionCount}
        onAttention={() => attentionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />
      {pulse && <AttentionQueue ref={attentionRef} pulse={pulse} onFilterBurst={filterBurst} />}
      <Card className="p-0">
        {/* Bộ lọc: người bán · người mua · tìm kiếm */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4">
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
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
            <input
              type="search"
              aria-label="Tìm mã đơn, email, sản phẩm"
              placeholder="Tìm mã đơn, email, sản phẩm…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-line-2 bg-surface pl-9 pr-8 text-[13px] text-fg placeholder:text-placeholder focus:border-iris focus:outline-none focus:ring-1 focus:ring-iris/30"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Xóa tìm kiếm"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-fg"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <span className="ml-auto flex items-center gap-3 text-[12px] text-muted">
            <span className="tabular-nums">
              <span className="font-mono font-semibold text-fg">{scopeCount.toLocaleString("vi-VN")}</span> đơn ·{" "}
              <span className="font-mono font-semibold text-fg">{vnd(totalValue)}</span>
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} className="accent-iris" />
              Gom đơn trùng
            </label>
          </span>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-muted transition-colors hover:bg-raised hover:text-fg"
            >
              <X size={13} />
              Xóa lọc
            </button>
          )}
        </div>

        {/* Tab trạng thái với số đếm */}
        <div className="flex items-center gap-0.5 overflow-x-auto border-b border-line px-2">
          {STATUS_TABS.map((t) => {
            const active = status === t.key;
            const count = tabCounts[t.key] ?? 0;
            // Empty statuses only add noise; the active tab always stays.
            if (count === 0 && !active && t.key !== "all") return null;
            return (
              <button
                key={t.key}
                onClick={() => setStatus(t.key)}
                aria-pressed={active}
                className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] font-medium transition-colors ${
                  active
                    ? "border-iris text-fg"
                    : "border-transparent text-muted hover:text-fg"
                }`}
              >
                {t.color && <span className={`h-1.5 w-1.5 rounded-full ${t.color}`} />}
                {t.label}
                <span
                  className={`tabular-nums text-[11px] ${
                    active ? "font-semibold text-iris-hi" : "text-faint"
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
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/60">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-iris" />
            </div>
          )}

          {queryResult.isError && (
            <div className="px-4 py-3">
              <Banner tone="bad">Không tải được danh sách đơn hàng. Thử tải lại trang.</Banner>
            </div>
          )}

          {total === 0 && !queryResult.isLoading ? (
            <div className="px-4 py-14 text-center">
              <p className="text-[13px] text-muted">
                {!hasFilters
                  ? "Chưa có đơn hàng nào."
                  : "Không có đơn hàng khớp bộ lọc hiện tại."}
              </p>
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="mt-3 inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-muted transition-colors hover:border-line-2 hover:text-fg"
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
                  <tr className="border-b border-line bg-raised/50 text-left text-muted">
                    {table.getHeaderGroups()[0].headers.map((header) => (
                      <th
                        key={header.id}
                        aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : undefined}
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
                      <tr key={i} className="border-b border-line">
                        {columns.map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <div
                              className="h-4 animate-pulse rounded bg-raised"
                              style={{ width: SKELETON_WIDTHS[j % SKELETON_WIDTHS.length] }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : (
                    (() => {
                      const rowsById = new Map(table.getRowModel().rows.map((r) => [r.original.id, r]));
                      const renderRow = (row: Row<Order>, nested = false) => (
                        <tr
                          key={row.id}
                          onClick={(e) => openRow(row.original.id, e)}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                            e.preventDefault();
                            setQuickId(row.original.id);
                          }}
                          tabIndex={0}
                          aria-label={`Xem nhanh đơn ${row.original.order_code}`}
                          aria-selected={quickId === row.original.id}
                          className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris border-b border-line transition-colors last:border-0 hover:bg-raised ${
                            quickId === row.original.id ? "bg-iris-soft" : nested ? "bg-raised/40" : ""
                          }`}
                        >
                          {row.getVisibleCells().map((cell, i) => (
                            <td
                              key={cell.id}
                              className={`px-4 py-2.5 ${RIGHT_COLS.has(cell.column.id) ? "text-right" : ""} ${
                                nested && i === 0 ? "pl-8" : ""
                              }`}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                      );
                      return runs.map((run) => {
                        if (run.kind === "single") {
                          const row = rowsById.get(run.order.id);
                          return row ? renderRow(row) : null;
                        }
                        const open = expanded.has(run.key);
                        const head = run.orders[0];
                        const span = new Date(run.lastAt).getTime() - new Date(run.firstAt).getTime();
                        return (
                          <React.Fragment key={run.key}>
                            <tr className="border-b border-line bg-raised">
                              <td colSpan={columns.length} className="p-0">
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(run.key)}
                                  aria-expanded={open}
                                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-raised"
                                >
                                  <ChevronRight size={14} className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
                                  <span className="font-semibold text-fg">{run.orders.length} đơn</span>
                                  <span className="min-w-0 truncate text-fg">
                                    {head.product_title ?? "—"}
                                    {head.variant_name ? <span className="text-faint"> · {head.variant_name}</span> : null}
                                  </span>
                                  <span className="truncate text-muted">
                                    {head.buyer_email ?? `#${head.buyer_id}`} → {head.seller_email ?? `#${head.seller_id}`}
                                  </span>
                                  <span className="ml-auto flex shrink-0 items-center gap-3">
                                    <span className="text-[12px] text-muted">
                                      {run.statuses.map(([st, n]) => `${n} ${(ORDER_STATUS[st]?.label ?? st).toLowerCase()}`).join(" · ")}
                                    </span>
                                    <span className="font-mono tabular-nums font-medium">{vnd(run.amount)}</span>
                                    <span className="whitespace-nowrap font-mono text-[12px] text-muted">
                                      {formatWhen(run.firstAt)} · trong {formatSpan(Math.max(60_000, span))}
                                    </span>
                                  </span>
                                </button>
                              </td>
                            </tr>
                            {open && run.orders.map((o) => {
                              const row = rowsById.get(o.id);
                              return row ? renderRow(row, true) : null;
                            })}
                          </React.Fragment>
                        );
                      });
                    })()
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <span className="text-[12px] text-muted tabular-nums">
              Hiển thị {(page - 1) * pagination.pageSize + 1}–
              {Math.min(page * pagination.pageSize, total)} / {total.toLocaleString("vi-VN")} đơn hàng
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="h-8 rounded-lg border border-line bg-surface px-3 text-[12px] font-medium text-muted transition-colors hover:border-line-2 hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
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
                        ? "bg-iris text-white"
                        : "border border-line bg-surface text-muted hover:bg-raised"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="h-8 rounded-lg border border-line bg-surface px-3 text-[12px] font-medium text-muted transition-colors hover:border-line-2 hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
              >
                →
              </button>
            </div>
          </div>
        )}
      </Card>

      <OrderQuickView
        order={quickOrder}
        onClose={() => setQuickId(null)}
        onStep={stepQuick}
        onOpen={openOrder}
        onFilterBuyer={(id) => { setQuickId(null); setBuyerId(String(id)); }}
        onFilterSeller={(id) => { setQuickId(null); setSellerId(String(id)); }}
      />

    </div>
  );
}
