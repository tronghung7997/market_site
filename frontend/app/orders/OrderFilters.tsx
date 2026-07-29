"use client";

/** Bộ lọc danh sách đơn: tab trạng thái (kiểu hộp thư, đếm bên phải) + tìm
 *  kiếm debounce + khoảng ngày + sắp xếp + phân trang. Toàn bộ state lọc gói
 *  trong useOrderFilters — page chỉ cầm `filters.params()` ném vào API. */

import { useEffect, useMemo, useState } from "react";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui";
import { Search, X } from "@/components/Icons";

export const TABS = [
  { key: "", label: "Tất cả" },
  { key: "active", label: "Hoạt động" },
  { key: "disputed", label: "Khiếu nại" },
  { key: "deleted", label: "Đã xoá" },
] as const;

const SORT_OPTIONS = [
  { value: "newest", label: "Mới nhất" },
  { value: "oldest", label: "Cũ nhất" },
  { value: "price_desc", label: "Giá cao → thấp" },
  { value: "price_asc", label: "Giá thấp → cao" },
];

export const PER_PAGE_OPTIONS = [10, 20, 50];

export interface OrderFilterParams {
  status?: string; search?: string; date_from?: string; date_to?: string;
  sort?: string; page?: number; per_page?: number;
}

export function useOrderFilters(initialTab: string) {
  const [tab, setTab] = useState(initialTab);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);

  const debouncedSearch = useDebounce(search, 350);

  // Đổi bất kỳ tiêu chí nào → quay về trang 1.
  useEffect(() => {
    setPage(1);
  }, [tab, debouncedSearch, dateFrom, dateTo, sort, perPage]);

  const hasFilters = search !== "" || dateFrom !== "" || dateTo !== "" || sort !== "newest";

  const clear = () => { setSearch(""); setDateFrom(""); setDateTo(""); setSort("newest"); };

  // Object memo theo đúng các giá trị lọc — page dùng làm dependency của
  // effect fetch: đổi tiêu chí nào cũng ra object mới, không đổi thì giữ ref.
  const params = useMemo<OrderFilterParams>(() => ({
    status: tab || undefined,
    search: debouncedSearch.trim() || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    sort,
    page,
    per_page: perPage,
  }), [tab, debouncedSearch, dateFrom, dateTo, sort, page, perPage]);

  return {
    tab, setTab, search, setSearch, dateFrom, setDateFrom, dateTo, setDateTo,
    sort, setSort, page, setPage, perPage, setPerPage,
    debouncedSearch, hasFilters, clear, params,
  };
}

export type OrderFilters = ReturnType<typeof useOrderFilters>;

/** Thư mục trạng thái — kiểu hộp thư, số đếm bên phải. */
export function StatusTabs({ filters, counts }: {
  filters: OrderFilters;
  counts: Record<string, number | undefined>;
}) {
  return (
    <Card className="p-1.5">
      {TABS.map((t) => {
        const active = filters.tab === t.key;
        const count = counts[t.key];
        return (
          <button
            key={t.key}
            onClick={() => filters.setTab(t.key)}
            aria-pressed={active}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors",
              active ? "bg-iris-soft font-medium text-iris-hi" : "text-muted hover:bg-raised hover:text-fg",
            )}
          >
            {t.label}
            {count != null && (
              <span className={cn("tabular text-[11.5px]", active ? "font-semibold" : "text-faint")}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </Card>
  );
}

/** Bộ lọc — áp tức thì, không cần nút "Lọc". */
export function FilterCard({ filters }: { filters: OrderFilters }) {
  return (
    <Card className="p-4 space-y-3">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          type="text"
          placeholder="Tìm theo mã đơn…"
          value={filters.search}
          onChange={(e) => filters.setSearch(e.target.value)}
          className="h-9 w-full rounded-lg bg-surface border border-line pl-8 pr-7 text-[13px] placeholder:text-faint focus:border-iris focus:outline-none"
        />
        {filters.search && (
          <button
            onClick={() => filters.setSearch("")}
            aria-label="Xóa tìm kiếm"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-fg"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 min-w-0">
        <div className="min-w-0">
          <label className="text-[11px] text-faint block mb-1">Từ ngày</label>
          <input
            type="date" value={filters.dateFrom} onChange={(e) => filters.setDateFrom(e.target.value)}
            className="h-9 w-full min-w-0 rounded-lg bg-surface border border-line px-2 text-[12px] text-muted focus:border-iris focus:outline-none"
          />
        </div>
        <div className="min-w-0">
          <label className="text-[11px] text-faint block mb-1">Đến ngày</label>
          <input
            type="date" value={filters.dateTo} onChange={(e) => filters.setDateTo(e.target.value)}
            className="h-9 w-full min-w-0 rounded-lg bg-surface border border-line px-2 text-[12px] text-muted focus:border-iris focus:outline-none"
          />
        </div>
      </div>
      <select
        value={filters.sort}
        onChange={(e) => filters.setSort(e.target.value)}
        aria-label="Sắp xếp"
        className="h-9 w-full rounded-lg bg-surface border border-line px-2.5 text-[12.5px] text-muted focus:border-iris focus:outline-none cursor-pointer"
      >
        {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {filters.hasFilters && (
        <button
          onClick={filters.clear}
          className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-raised hover:text-fg"
        >
          <X size={13} />
          Xóa lọc
        </button>
      )}
    </Card>
  );
}
