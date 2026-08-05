"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui";
import { Search, X } from "@/components/Icons";

export const TAB_KEYS = ["", "active", "disputed", "deleted"] as const;

export const PER_PAGE_OPTIONS = [10, 20, 50];

export interface OrderFilterParams {
  status?: string; search?: string; date_from?: string; date_to?: string;
  sort?: string; page?: number; per_page?: number;
}

export function useOrderFilters(initialTab: string, initialSearch = "") {
  const [tab, setTab] = useState(initialTab);
  const [search, setSearch] = useState(initialSearch);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);

  const debouncedSearch = useDebounce(search, 350);

  useEffect(() => {
    setPage(1);
  }, [tab, debouncedSearch, dateFrom, dateTo, sort, perPage]);

  const hasFilters = search !== "" || dateFrom !== "" || dateTo !== "" || sort !== "newest";

  const clear = () => { setSearch(""); setDateFrom(""); setDateTo(""); setSort("newest"); };

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

export function StatusTabs({ filters, counts }: {
  filters: OrderFilters;
  counts: Record<string, number | undefined>;
}) {
  const t = useTranslations("orders");
  const tabs = [
    { key: "", label: t("tabAll") },
    { key: "active", label: t("tabActive") },
    { key: "disputed", label: t("tabDisputed") },
    { key: "deleted", label: t("tabDeleted") },
  ];
  return (
    <Card className="p-1.5">
      {tabs.map((tab) => {
        const active = filters.tab === tab.key;
        const count = counts[tab.key];
        return (
          <button
            key={tab.key}
            onClick={() => filters.setTab(tab.key)}
            aria-pressed={active}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors",
              active ? "bg-iris-soft font-medium text-iris-hi" : "text-muted hover:bg-raised hover:text-fg",
            )}
          >
            {tab.label}
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

export function FilterCard({ filters }: { filters: OrderFilters }) {
  const t = useTranslations("orders");
  const tc = useTranslations("common");
  const sortOptions = [
    { value: "newest", label: t("sortNewest") },
    { value: "oldest", label: t("sortOldest") },
    { value: "price_desc", label: t("sortPriceDesc") },
    { value: "price_asc", label: t("sortPriceAsc") },
  ];
  return (
    <Card className="p-4 space-y-3">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          type="text"
          placeholder={t("searchPlaceholder")}
          value={filters.search}
          onChange={(e) => filters.setSearch(e.target.value)}
          className="h-9 w-full rounded-lg bg-surface border border-line pl-8 pr-7 text-[13px] placeholder:text-faint focus:border-iris focus:outline-none"
        />
        {filters.search && (
          <button
            onClick={() => filters.setSearch("")}
            aria-label={t("clearSearch")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-fg"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 min-w-0">
        <div className="min-w-0">
          <label className="text-[11px] text-faint block mb-1">{t("dateFrom")}</label>
          <input
            type="date" value={filters.dateFrom} onChange={(e) => filters.setDateFrom(e.target.value)}
            className="h-9 w-full min-w-0 rounded-lg bg-surface border border-line px-2 text-[12px] text-muted focus:border-iris focus:outline-none"
          />
        </div>
        <div className="min-w-0">
          <label className="text-[11px] text-faint block mb-1">{t("dateTo")}</label>
          <input
            type="date" value={filters.dateTo} onChange={(e) => filters.setDateTo(e.target.value)}
            className="h-9 w-full min-w-0 rounded-lg bg-surface border border-line px-2 text-[12px] text-muted focus:border-iris focus:outline-none"
          />
        </div>
      </div>
      <select
        value={filters.sort}
        onChange={(e) => filters.setSort(e.target.value)}
        aria-label={tc("sort")}
        className="h-9 w-full rounded-lg bg-surface border border-line px-2.5 text-[12.5px] text-muted focus:border-iris focus:outline-none cursor-pointer"
      >
        {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {filters.hasFilters && (
        <button
          onClick={filters.clear}
          className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[12px] font-medium text-muted transition-colors hover:bg-raised hover:text-fg"
        >
          <X size={13} />
          {t("clearFilter")}
        </button>
      )}
    </Card>
  );
}
