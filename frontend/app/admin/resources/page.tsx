"use client";
/* Hallmark · component: admin resources console · theme: project Proxora (slate canvas · iris accent) · P4 H4 E4 S4 R4 V4 */

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronUp, ChevronsUpDown, ListFilter, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { Banner, Card, Tag } from "@/components/ui";
import { FacetSelect, type FacetOption } from "@/components/admin";
import type { ResourceSummary, AdminResource } from "@/lib/types";

const PER_PAGE = 20;

// Tab trạng thái — color dùng chung cho chấm trên tab và đoạn tương
// ứng trong thanh phân bố. Số đếm lấy từ summary (toàn hệ thống).
const STATUS_TABS: {
  key: string;
  label: string;
  summaryKey?: keyof ResourceSummary;
  color?: string;
}[] = [
  { key: "all", label: "Tất cả" },
  { key: "available", label: "Sẵn sàng", summaryKey: "available", color: "bg-emerald-400" },
  { key: "assigned", label: "Đã cấp phát", summaryKey: "assigned", color: "bg-indigo-400" },
  { key: "expired", label: "Hết hạn", summaryKey: "expired", color: "bg-amber-400" },
  { key: "error", label: "Lỗi", summaryKey: "error", color: "bg-red-400" },
];

const STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral" | "iris"> = {
  available: "good",
  assigned: "iris",
  expired: "warn",
  error: "bad",
};

const STATUS_LABEL: Record<string, string> = {
  available: "Sẵn sàng",
  assigned: "Đã cấp phát",
  expired: "Hết hạn",
  error: "Lỗi",
};

const SKELETON_WIDTHS = ["30%", "80%", "55%", "60%", "40%", "35%", "45%", "45%"];

interface ResourcesTableMeta {
  filterSeller: (id: number) => void;
}

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

const columns: ColumnDef<AdminResource>[] = [
  {
    accessorKey: "id",
    header: ({ column }) => <SortHeader column={column} label="ID" />,
    cell: ({ row }) => <span className="font-mono text-slate-400">#{row.original.id}</span>,
    enableSorting: true,
  },
  {
    accessorKey: "product_title",
    header: "Sản phẩm",
    cell: ({ row }) => (
      <span className="truncate max-w-[200px] block font-medium">
        {row.original.product_title ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "variant_name",
    header: "Biến thể",
    cell: ({ row }) => (
      <span className="text-slate-500 truncate max-w-[150px] block">
        {row.original.variant_name ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "seller_email",
    header: "Người bán",
    cell: ({ row, table }) => (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          (table.options.meta as ResourcesTableMeta).filterSeller(row.original.seller_id);
        }}
        title="Lọc theo người bán này"
        className="group/party flex max-w-[170px] items-center gap-1 text-slate-500 hover:text-indigo-700 transition-colors"
      >
        <span className="truncate">
          {row.original.seller_email ?? `#${row.original.seller_id}`}
        </span>
        <ListFilter
          size={11}
          className="shrink-0 text-indigo-500 opacity-0 group-hover/party:opacity-100 transition-opacity"
        />
      </button>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => <SortHeader column={column} label="Trạng thái" />,
    cell: ({ row }) => (
      <Tag tone={STATUS_TONE[row.original.status] ?? "neutral"}>
        {STATUS_LABEL[row.original.status] ?? row.original.status}
      </Tag>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "order_id",
    header: "Đơn hàng",
    cell: ({ row }) =>
      row.original.order_id ? (
        <Link
          href={`/admin/orders?highlight=${row.original.order_id}`}
          className="font-mono text-indigo-600 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          #{row.original.order_id}
        </Link>
      ) : (
        <span className="text-slate-400">—</span>
      ),
  },
  {
    accessorKey: "created_at",
    header: ({ column }) => <SortHeader column={column} label="Ngày tạo" />,
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
  {
    accessorKey: "expires_at",
    header: ({ column }) => <SortHeader column={column} label="Hết hạn" />,
    cell: ({ row }) => (
      <span className="text-slate-500">
        {row.original.expires_at
          ? new Date(row.original.expires_at).toLocaleDateString("vi-VN")
          : "—"}
      </span>
    ),
    enableSorting: true,
  },
];

export default function AdminResourcesPage() {
  const [status, setStatus] = React.useState("all");
  const [sellerKey, setSellerKey] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const debouncedSearch = useDebounce(search, 300);

  React.useEffect(() => { setPage(1); }, [status, sellerKey, debouncedSearch]);

  const { data: summary } = useQuery({
    queryKey: ["admin", "resources", "summary"],
    queryFn: () => api.adminResourceSummary(),
    staleTime: 30_000,
  });

  // Người bán + số tài nguyên toàn hệ thống — nguồn cho dropdown lọc
  const { data: sellerFacets } = useQuery({
    queryKey: ["admin", "resources", "sellers"],
    queryFn: () => api.adminResourceSellers(),
    staleTime: 30_000,
  });

  const sellerOptions = React.useMemo<FacetOption[]>(
    () =>
      (sellerFacets ?? []).map((s) => ({
        key: String(s.seller_id),
        label: s.seller_email ?? `#${s.seller_id}`,
        count: s.count,
      })),
    [sellerFacets]
  );

  // Danh sách lọc + phân trang phía server (khác orders/products vốn
  // lọc client-side) — vì vậy tab đếm và thanh phân bố dựa trên summary
  // toàn hệ thống, không co giãn theo ô tìm kiếm.
  const apiParams = React.useMemo(() => ({
    status: status === "all" ? undefined : status,
    seller_id: sellerKey !== null ? Number(sellerKey) : undefined,
    search: debouncedSearch || undefined,
    page,
    per_page: PER_PAGE,
  }), [status, sellerKey, debouncedSearch, page]);

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ["admin", "resources", apiParams],
    queryFn: () => api.adminResources(apiParams),
  });

  const resources = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const tableMeta = React.useMemo<ResourcesTableMeta>(
    () => ({
      filterSeller: (id: number) => setSellerKey(String(id)),
    }),
    []
  );

  const table = useReactTable({
    data: resources,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    meta: tableMeta,
  });

  const totalCount = summary
    ? summary.available + summary.assigned + summary.expired + summary.error
    : 0;

  const barSegments = STATUS_TABS.filter(
    (t) => t.summaryKey && (summary?.[t.summaryKey] ?? 0) > 0
  ).map((t) => ({
    key: t.key,
    label: t.label,
    count: summary![t.summaryKey!],
    color: t.color!,
  }));

  const hasFilters = status !== "all" || sellerKey !== null || search.trim() !== "";

  const clearFilters = () => {
    setStatus("all");
    setSellerKey(null);
    setSearch("");
  };

  return (
    <div className="animate-rise">
      <Card className="p-0">
        {/* Dải chỉ số + thanh phân bố trạng thái (toàn hệ thống) */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-4 pt-4 pb-3">
          <div>
            <p className="text-[11.5px] font-medium uppercase tracking-wide text-slate-400">
              Tổng tài nguyên
            </p>
            <p className="text-[26px] leading-8 font-semibold font-mono tabular-nums text-slate-900">
              {totalCount.toLocaleString("vi-VN")}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Vòng đời: sẵn sàng → đã cấp phát → hết hạn / lỗi
            </p>
          </div>

          {totalCount > 0 && (
            <div className="w-full min-w-[240px] flex-1 sm:w-auto sm:max-w-sm">
              <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
                {barSegments.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setStatus(s.key)}
                    title={`${s.label}: ${s.count.toLocaleString("vi-VN")} tài nguyên`}
                    aria-label={`${s.label}: ${s.count.toLocaleString("vi-VN")} tài nguyên`}
                    className={`${s.color} min-w-[5px] transition-opacity hover:opacity-75`}
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

        {/* Bộ lọc: người bán · tìm kiếm */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <FacetSelect
            label="Người bán"
            options={sellerOptions}
            value={sellerKey}
            onChange={setSellerKey}
          />
          <div className="relative min-w-[180px] max-w-xs flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm theo ID, sản phẩm, biến thể, người bán…"
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
            const count = t.summaryKey ? summary?.[t.summaryKey] ?? 0 : totalCount;
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
          {isFetching && !isLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
            </div>
          )}

          {isError && (
            <div className="px-4 py-3">
              <Banner tone="bad">Không tải được danh sách tài nguyên. Thử tải lại trang.</Banner>
            </div>
          )}

          {!isLoading && resources.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <p className="text-[13px] text-slate-500">
                {hasFilters
                  ? "Không có tài nguyên khớp bộ lọc hiện tại."
                  : "Chưa có tài nguyên nào."}
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
                      <th key={header.id} className="px-4 py-2.5 font-medium">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
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
                        className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
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
        {!isLoading && total > 0 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <span className="text-[12px] text-slate-500 tabular-nums">
              Hiển thị {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} / {total.toLocaleString("vi-VN")} tài nguyên
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ←
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) pageNum = i + 1;
                else if (page <= 3) pageNum = i + 1;
                else if (page >= totalPages - 2) pageNum = totalPages - 4 + i;
                else pageNum = page - 2 + i;
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
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
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
