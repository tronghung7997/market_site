"use client";
/* Hallmark · component: admin products console · theme: project Proxora (slate canvas · iris accent) · P4 H5 E4 S4 R4 V4 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
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
  TriangleAlert,
  X,
} from "lucide-react";

import { api, vnd } from "@/lib/api";
import { Banner, Card, Tag } from "@/components/ui";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { FacetSelect, buildFacetOptions } from "@/components/admin";
import { ProductStatusBadge, StatusBadge } from "@/components/admin/status-badge";
import { SERVICE_LABELS } from "@/lib/labels";
import type { AdminProduct } from "@/lib/types";

const DEFAULT_PAGE_SIZE = 20;

// Tab trạng thái — "needs_setup" lọc theo cấu hình (provider/pricing),
// không phải ProductStatus, nên không nằm trong thanh phân bố.
const STATUS_TABS: {
  key: string;
  label: string;
  color?: string;
  special?: boolean;
}[] = [
  { key: "all", label: "Tất cả" },
  { key: "active", label: "Đang bán", color: "bg-emerald-400" },
  { key: "draft", label: "Nháp", color: "bg-slate-300" },
  { key: "paused", label: "Tạm dừng", color: "bg-amber-400" },
  { key: "suspended", label: "Bị khoá", color: "bg-red-400" },
  { key: "needs_setup", label: "Cần thiết lập", color: "bg-orange-400", special: true },
];

// Cột số căn phải (header lẫn cell)
const RIGHT_COLS = new Set(["order_count", "revenue"]);

const SKELETON_WIDTHS = ["30%", "85%", "60%", "55%", "50%", "35%", "55%", "45%"];

interface ProductsTableMeta {
  filterSeller: (key: string) => void;
  filterProvider: (key: string) => void;
}

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

// Table columns
const columns: ColumnDef<AdminProduct>[] = [
  {
    id: "index",
    header: "#",
    cell: ({ row }) => (
      <span className="text-[12px] text-slate-400 tabular-nums">
        {row.index + 1}
      </span>
    ),
  },
  {
    accessorKey: "title",
    header: ({ column }) => <SortHeader column={column} label="Sản phẩm" />,
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 border border-slate-200 font-serif text-[13px] font-semibold text-indigo-600">
          {row.original.title.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="font-medium text-[13.5px] truncate max-w-[240px] flex items-center gap-1.5">
            <span className="truncate">{row.original.title}</span>
            {row.original.needs_setup && <Tag tone="bad">Cần thiết lập</Tag>}
            {!row.original.needs_setup && row.original.demo_mode && <Tag tone="iris">Demo</Tag>}
          </div>
          <div className="text-[11px] text-slate-400">
            {SERVICE_LABELS[row.original.service_type] ?? row.original.service_type}
          </div>
        </div>
      </div>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "seller_email",
    header: "Người bán",
    cell: ({ row, table }) =>
      row.original.seller_email ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            (table.options.meta as ProductsTableMeta).filterSeller(row.original.seller_email!);
          }}
          title="Lọc theo người bán này"
          className="group/party flex max-w-[170px] items-center gap-1 text-[12px] text-slate-500 hover:text-indigo-700 transition-colors"
        >
          <span className="truncate">{row.original.seller_email}</span>
          <ListFilter
            size={11}
            className="shrink-0 text-indigo-500 opacity-0 group-hover/party:opacity-100 transition-opacity"
          />
        </button>
      ) : (
        <span className="text-[12px] text-slate-400">—</span>
      ),
  },
  {
    id: "provider",
    header: "Nguồn hàng",
    cell: ({ row, table }) => (
      <div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            (table.options.meta as ProductsTableMeta).filterProvider(
              row.original.provider_name ?? "Seller Pool"
            );
          }}
          title="Lọc theo nguồn hàng này"
          className={`group/party flex items-center gap-1 text-[12px] transition-colors hover:text-indigo-700 ${
            row.original.provider_name ? "font-medium text-slate-700" : "text-slate-400"
          }`}
        >
          <span className="truncate max-w-[140px]">
            {row.original.provider_name ?? "Seller Pool"}
          </span>
          <ListFilter
            size={11}
            className="shrink-0 text-indigo-500 opacity-0 group-hover/party:opacity-100 transition-opacity"
          />
        </button>
        {row.original.provider_name && row.original.adapter_type && (
          <StatusBadge status={row.original.adapter_type} statusType="strategy" />
        )}
      </div>
    ),
  },
  {
    accessorKey: "pricing_strategy",
    header: "Chiến lược giá",
    cell: ({ row }) =>
      row.original.pricing_strategy ? (
        <StatusBadge status={row.original.pricing_strategy} statusType="strategy" />
      ) : (
        <span className="text-[12px] text-slate-400">Cố định</span>
      ),
  },
  {
    accessorKey: "order_count",
    header: ({ column }) => <SortHeader column={column} label="Đơn hàng" />,
    cell: ({ row }) => (
      <span className="text-[13px] font-medium tabular-nums">
        {row.original.order_count.toLocaleString("vi-VN")}
      </span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "revenue",
    header: ({ column }) => <SortHeader column={column} label="Doanh thu" />,
    cell: ({ row }) => (
      <span className="text-[13px] font-medium tabular-nums font-mono">
        {vnd(row.original.revenue)}
      </span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "status",
    header: ({ column }) => <SortHeader column={column} label="Trạng thái" />,
    cell: ({ row }) => <ProductStatusBadge status={row.original.status} />,
    enableSorting: true,
  },
];

export default function AdminProductsPage() {
  const router = useRouter();

  // Filter & pagination state
  const [status, setStatus] = React.useState("all");
  const [sellerKey, setSellerKey] = React.useState<string | null>(null);
  const [providerKey, setProviderKey] = React.useState<string | null>(null);
  const [serviceKey, setServiceKey] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const debouncedSearch = useDebounce(search, 300);

  React.useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [status, sellerKey, providerKey, serviceKey, debouncedSearch]);

  const queryResult = useQuery({
    queryKey: ["admin", "products"] as const,
    queryFn: () => api.adminProducts(),
    staleTime: 30_000,
  });

  const allProducts = React.useMemo(() => queryResult.data ?? [], [queryResult.data]);

  // Tầng lọc: search → (người bán ∩ nguồn hàng ∩ loại dịch vụ) → trạng thái
  const searchScope = React.useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return allProducts;
    return allProducts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.seller_email?.toLowerCase().includes(q) ||
        p.provider_name?.toLowerCase().includes(q)
    );
  }, [allProducts, debouncedSearch]);

  const sellerOf = (p: AdminProduct) => p.seller_email ?? "—";
  const providerOf = (p: AdminProduct) => p.provider_name ?? "Seller Pool";

  const matchesFacets = React.useCallback(
    (p: AdminProduct, skip?: "seller" | "provider" | "service") =>
      (skip === "seller" || sellerKey === null || sellerOf(p) === sellerKey) &&
      (skip === "provider" || providerKey === null || providerOf(p) === providerKey) &&
      (skip === "service" || serviceKey === null || p.service_type === serviceKey),
    [sellerKey, providerKey, serviceKey]
  );

  // Facet nào cũng đếm trong phạm vi đã áp các facet còn lại (cross-filter)
  const sellerOptions = React.useMemo(
    () =>
      buildFacetOptions(
        searchScope.filter((p) => matchesFacets(p, "seller")),
        allProducts,
        sellerKey,
        sellerOf,
        sellerOf
      ),
    [searchScope, allProducts, sellerKey, matchesFacets]
  );

  const providerOptions = React.useMemo(
    () =>
      buildFacetOptions(
        searchScope.filter((p) => matchesFacets(p, "provider")),
        allProducts,
        providerKey,
        providerOf,
        providerOf
      ),
    [searchScope, allProducts, providerKey, matchesFacets]
  );

  const serviceOptions = React.useMemo(
    () =>
      buildFacetOptions(
        searchScope.filter((p) => matchesFacets(p, "service")),
        allProducts,
        serviceKey,
        (p) => p.service_type,
        (p) => SERVICE_LABELS[p.service_type] ?? p.service_type
      ),
    [searchScope, allProducts, serviceKey, matchesFacets]
  );

  const scope = React.useMemo(
    () => searchScope.filter((p) => matchesFacets(p)),
    [searchScope, matchesFacets]
  );

  const tabCounts = React.useMemo(() => {
    const counts: Record<string, number> = { all: scope.length };
    for (const tab of STATUS_TABS) {
      if (tab.key === "all") continue;
      counts[tab.key] = tab.special
        ? scope.filter((p) => p.needs_setup).length
        : scope.filter((p) => p.status === tab.key).length;
    }
    return counts;
  }, [scope]);

  // Thanh phân bố chỉ gồm trạng thái thật (needs_setup chồng lấn nên đứng ngoài)
  const barSegments = React.useMemo(() => {
    const segments = STATUS_TABS.filter((t) => t.key !== "all" && !t.special).map((t) => ({
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

  const totalRevenue = React.useMemo(
    () => scope.reduce((sum, p) => sum + p.revenue, 0),
    [scope]
  );

  const filteredProducts = React.useMemo(() => {
    if (status === "all") return scope;
    if (status === "needs_setup") return scope.filter((p) => p.needs_setup);
    return scope.filter((p) => p.status === status);
  }, [scope, status]);

  const total = filteredProducts.length;
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));

  React.useEffect(() => {
    setPagination((p) =>
      p.pageIndex > 0 && p.pageIndex >= totalPages ? { ...p, pageIndex: 0 } : p
    );
  }, [totalPages]);

  const tableMeta = React.useMemo<ProductsTableMeta>(
    () => ({
      filterSeller: (key: string) => setSellerKey(key),
      filterProvider: (key: string) => setProviderKey(key),
    }),
    []
  );

  const table = useReactTable({
    data: filteredProducts,
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
    status !== "all" ||
    sellerKey !== null ||
    providerKey !== null ||
    serviceKey !== null ||
    search.trim() !== "";

  const clearFilters = () => {
    setStatus("all");
    setSellerKey(null);
    setProviderKey(null);
    setServiceKey(null);
    setSearch("");
  };

  const needsSetupCount = tabCounts.needs_setup ?? 0;

  return (
    <div className="animate-rise">
      <Card className="p-0">
        {/* Dải chỉ số + thanh phân bố trạng thái (theo phạm vi đang lọc) */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-4 pt-4 pb-3">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
            <div>
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-slate-400">
                Sản phẩm
              </p>
              <p className="text-[26px] leading-8 font-semibold font-mono tabular-nums text-slate-900">
                {scope.length.toLocaleString("vi-VN")}
              </p>
            </div>
            <div>
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-slate-400">
                Doanh thu
              </p>
              <p className="text-[20px] leading-8 font-semibold font-mono tabular-nums text-slate-900">
                {vnd(totalRevenue)}
              </p>
            </div>
            {needsSetupCount > 0 && (
              <button
                type="button"
                onClick={() => setStatus("needs_setup")}
                className="inline-flex items-center gap-1.5 self-center rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[12px] font-medium text-red-700 transition-colors hover:border-red-300 hover:bg-red-100"
              >
                <TriangleAlert size={13} />
                {needsSetupCount.toLocaleString("vi-VN")} cần thiết lập
              </button>
            )}
          </div>

          {scope.length > 0 && (
            <div className="w-full min-w-[240px] flex-1 sm:w-auto sm:max-w-sm">
              <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                {barSegments.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => s.clickable && setStatus(s.key)}
                    title={`${s.label}: ${s.count.toLocaleString("vi-VN")} sản phẩm`}
                    aria-label={`${s.label}: ${s.count.toLocaleString("vi-VN")} sản phẩm`}
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

        {/* Bộ lọc: người bán · nguồn hàng · loại dịch vụ · tìm kiếm */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <FacetSelect
            label="Người bán"
            options={sellerOptions}
            value={sellerKey}
            onChange={setSellerKey}
          />
          <FacetSelect
            label="Nguồn hàng"
            options={providerOptions}
            value={providerKey}
            onChange={setProviderKey}
          />
          <FacetSelect
            label="Loại dịch vụ"
            options={serviceOptions}
            value={serviceKey}
            onChange={setServiceKey}
          />
          <div className="relative min-w-[180px] max-w-xs flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm sản phẩm, người bán, nguồn hàng…"
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
              <Banner tone="bad">Không tải được danh sách sản phẩm. Thử tải lại trang.</Banner>
            </div>
          )}

          {total === 0 && !queryResult.isLoading ? (
            <div className="px-4 py-14 text-center">
              <p className="text-[13px] text-slate-500">
                {allProducts.length === 0
                  ? "Chưa có sản phẩm nào."
                  : "Không có sản phẩm khớp bộ lọc hiện tại."}
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
                        onClick={() => router.push(`/admin/products/${row.original.id}`)}
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
              {Math.min(page * pagination.pageSize, total)} / {total.toLocaleString("vi-VN")} sản phẩm
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
    </div>
  );
}
