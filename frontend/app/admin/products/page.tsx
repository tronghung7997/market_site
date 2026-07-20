"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { motion } from "motion/react";
import { Package } from "lucide-react";

import { api, vnd } from "@/lib/api";
import { Card, Spinner, Tag } from "@/components/ui";
import {
  FilterPills,
  SearchInput,
  StatsCard,
} from "@/components/admin";
import { ProductStatusBadge, StatusBadge } from "@/components/admin/status-badge";
import type { AdminProduct } from "@/lib/types";

// Service type labels
const SERVICE_LABELS: Record<string, string> = {
  account: "Tài khoản",
  proxy: "Proxy",
  token: "Token",
  endpoint: "Endpoint",
  cloud: "Cloud",
  payment: "Thanh toán",
  takedown: "Takedown",
  other: "Khác",
};

// Status filter options — "needs_setup" lọc theo cấu hình (provider/pricing),
// không phải ProductStatus, nên xử lý riêng trong useMemo bên dưới.
const STATUS_FILTER = [
  { key: "all", label: "Tất cả" },
  { key: "active", label: "Đang bán" },
  { key: "draft", label: "Nháp" },
  { key: "paused", label: "Tạm dừng" },
  { key: "suspended", label: "Bị khoá" },
  { key: "needs_setup", label: "Cần thiết lập" },
];

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
    header: "Sản phẩm",
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
  },
  {
    accessorKey: "seller_email",
    header: "Seller",
    cell: ({ row }) => (
      <span className="text-[12px] text-slate-500 truncate max-w-[160px] block">
        {row.original.seller_email ?? "—"}
      </span>
    ),
  },
  {
    id: "provider",
    header: "Provider",
    cell: ({ row }) =>
      row.original.provider_name ? (
        <div>
          <div className="text-[12px] font-medium">{row.original.provider_name}</div>
          {row.original.adapter_type && (
            <StatusBadge status={row.original.adapter_type} statusType="strategy" />
          )}
        </div>
      ) : (
        <span className="text-[12px] text-slate-400">Seller Pool</span>
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
    header: "Đơn hàng",
    cell: ({ row }) => (
      <span className="text-[13px] font-medium tabular-nums">
        {row.original.order_count}
      </span>
    ),
  },
  {
    accessorKey: "revenue",
    header: "Doanh thu",
    cell: ({ row }) => (
      <span className="text-[13px] font-medium tabular-nums">
        {vnd(row.original.revenue)}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Trạng thái",
    cell: ({ row }) => <ProductStatusBadge status={row.original.status} />,
  },
];

export default function AdminProductsPage() {
  const router = useRouter();

  // State
  const [products, setProducts] = React.useState<AdminProduct[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState("all");
  const [search, setSearch] = React.useState("");

  // Fetch products
  React.useEffect(() => {
    api
      .adminProducts()
      .then(setProducts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Filter products
  const filtered = React.useMemo(() => {
    return products.filter((p) => {
      if (filter === "needs_setup") {
        if (!p.needs_setup) return false;
      } else if (filter !== "all" && p.status !== filter) {
        return false;
      }
      if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [products, filter, search]);

  // Stats
  const totalRevenue = products.reduce((s, p) => s + p.revenue, 0);
  const activeCount = products.filter((p) => p.status === "active").length;
  const needsSetupCount = products.filter((p) => p.needs_setup).length;
  const serviceGroups = products.reduce<Record<string, number>>((acc, p) => {
    const t = p.service_type || "other";
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  // Table setup
  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (loading) {
    return <Spinner />;
  }

  return (
    <div className="space-y-5">
      {/* Summary stats */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid gap-4 sm:grid-cols-5"
      >
        <StatsCard label="Tổng sản phẩm" value={products.length} tone="iris" />
        <StatsCard
          label="Đang bán"
          value={activeCount}
          tone="good"
        />
        <button
          type="button"
          onClick={() => setFilter("needs_setup")}
          className="text-left cursor-pointer"
          aria-label="Lọc sản phẩm cần thiết lập"
        >
          <StatsCard
            label="Cần thiết lập"
            value={needsSetupCount}
            tone={needsSetupCount > 0 ? "bad" : "neutral"}
            sub={needsSetupCount > 0 ? "Chưa gắn provider hoặc sai cấu hình" : "Không có sản phẩm nào"}
          />
        </button>
        <Card className="p-4 text-center">
          <div className="text-[11px] text-slate-500 font-medium">Loại dịch vụ</div>
          <div className="text-[14px] font-medium mt-1.5 flex flex-wrap gap-1 justify-center">
            {Object.entries(serviceGroups).map(([k, v]) => (
              <span key={k} className="text-[11px] text-slate-500">
                {SERVICE_LABELS[k] ?? k}: {v}
              </span>
            ))}
          </div>
        </Card>
        <StatsCard
          label="Tổng doanh thu"
          value={vnd(totalRevenue)}
          tone="iris"
        />
      </motion.div>

      {/* Filters + Search */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex items-center gap-3 flex-wrap"
      >
        <FilterPills
          options={STATUS_FILTER}
          value={filter}
          onChange={setFilter}
        />
        <div className="flex-1" />
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Tìm sản phẩm..."
          className="w-[220px]"
        />
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        {filtered.length === 0 ? (
          <Card className="p-8 text-center">
            <Package size={40} className="mx-auto text-slate-300 mb-3" />
            <p className="text-[14px] text-slate-500">Không tìm thấy sản phẩm</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="text-[12px] text-slate-500 border-b border-slate-200">
                    {table.getHeaderGroups()[0].headers.map((header) => (
                      <th
                        key={header.id}
                        onClick={header.column.getToggleSortingHandler()}
                        className="px-5 py-3 font-medium cursor-pointer hover:text-slate-700 select-none"
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
                  {table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => router.push(`/admin/products/${row.original.id}`)}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-5 py-3">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </motion.div>
    </div>
  );
}
