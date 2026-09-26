"use client";
/* Hallmark · component: admin orders console · theme: project Proxora (slate canvas · iris accent) · P4 H5 E4 S4 R4 V4 */

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
import { api, vnd } from "@/lib/api";
import { Banner, Card } from "@/components/ui";
import { FacetSelect, type FacetOption } from "@/components/admin";
import { OrderStatusBadge } from "@/components/admin/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import type { AdminOrderFacet, AdminOrderSort, Order } from "@/lib/types";

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

// Cột số căn phải (header lẫn cell)
const RIGHT_COLS = new Set(["quantity", "total_amount"]);

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
      <span className="min-w-0 truncate">{email ?? `#${id}`}</span>
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
      <span className="font-mono text-slate-500" title={`#${row.original.id}`}>
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
    header: "Người mua",
    cell: ({ row, table }) => (
      <PartyCell
        email={row.original.buyer_email}
        id={row.original.buyer_id}
        onFilter={(table.options.meta as OrdersTableMeta).filterBuyer}
        filterLabel="Lọc theo người mua này"
      />
    ),
    enableSorting: false,
  },
  {
    accessorKey: "seller_email",
    header: "Người bán",
    cell: ({ row, table }) => (
      <PartyCell
        email={row.original.seller_email}
        id={row.original.seller_id}
        onFilter={(table.options.meta as OrdersTableMeta).filterSeller}
        filterLabel="Lọc theo người bán này"
      />
    ),
    enableSorting: false,
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
    header: "Trạng thái",
    cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
    enableSorting: false,
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
    const other = scopeCount - covered;
    if (other > 0) {
      segments.push({ key: "other", label: "Khác", count: other, color: "bg-slate-300", clickable: false });
    }
    return segments.filter((s) => s.count > 0);
  }, [tabCounts, scopeCount]);

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
                {scopeCount.toLocaleString("vi-VN")}
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

          {scopeCount > 0 && (
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
                {!hasFilters
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
                        onClick={(e) => openOrder(row.original.id, e)}
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

    </div>
  );
}
