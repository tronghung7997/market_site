"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { cn } from "@/lib/cn";
import { Button, Input, Select } from "@/components/ui";
import { ListFilter, Search, X } from "@/components/Icons";
import {
  activeDatePreset,
  DATE_PRESETS,
  datePresetRange,
  hasActiveOrderFilters,
  isExactOrderRefSearch,
  ORDER_SORTS,
  type BuyerOrderSort,
  type BuyerOrdersFilters,
} from "../model";

export function OrdersToolbar({
  filters,
  onChange,
  onReset,
}: {
  filters: BuyerOrdersFilters;
  onChange: (patch: Partial<BuyerOrdersFilters>) => void;
  onReset: () => void;
}) {
  const t = useTranslations("buyerOrders");
  const to = useTranslations("orders");
  const [search, setSearch] = useState(filters.search);
  const debounced = useDebounce(search, 300);

  // Keep the box in sync when the URL changes from outside (back button, links).
  useEffect(() => { setSearch(filters.search); }, [filters.search]);
  useEffect(() => {
    if (debounced.trim() !== filters.search.trim()) onChange({ search: debounced, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const preset = activeDatePreset(filters);
  const exact = isExactOrderRefSearch(search);
  const active = hasActiveOrderFilters(filters);

  return (
    <div className="flex flex-col gap-2.5 border-b border-line bg-raised/30 p-3">
      <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full flex-1 md:max-w-md">
          <span className="pointer-events-none absolute left-3 top-2.5 text-faint"><Search size={13} /></span>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={to("searchFullPlaceholder")}
            aria-label={to("searchFullPlaceholder")}
            className={cn("h-8.5 w-full rounded-lg bg-surface pl-8 text-xs", exact ? "pr-32" : "pr-7")}
          />
          <div className="absolute right-1 top-1 flex items-center gap-1">
            {exact && (
              <span className="hidden sm:inline-flex items-center rounded bg-iris/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-iris">
                {to("exactIdMatch")}
              </span>
            )}
            {search && (
              <Button size="sm" variant="ghost" onClick={() => setSearch("")} aria-label={to("clearSearch")} className="h-6.5 w-6.5 p-0 text-faint hover:text-fg">
                <X size={12} />
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div role="group" aria-label={t("dateRange")} className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
            {DATE_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={preset === p}
                onClick={() => onChange({ ...datePresetRange(p), page: 1 })}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
                  preset === p ? "bg-iris text-white" : "text-muted hover:bg-raised hover:text-fg",
                )}
              >
                {t(`preset.${p}`)}
              </button>
            ))}
          </div>
          <Input
            type="date"
            value={filters.dateFrom}
            max={filters.dateTo || undefined}
            onChange={(e) => onChange({ dateFrom: e.target.value, page: 1 })}
            aria-label={to("filterDateFrom")}
            className="h-8.5 w-auto rounded-lg bg-surface px-2 text-xs"
          />
          <span className="text-faint">–</span>
          <Input
            type="date"
            value={filters.dateTo}
            min={filters.dateFrom || undefined}
            onChange={(e) => onChange({ dateTo: e.target.value, page: 1 })}
            aria-label={to("filterDateTo")}
            className="h-8.5 w-auto rounded-lg bg-surface px-2 text-xs"
          />
          <div className="relative">
            <Select
              value={filters.sort}
              onChange={(e) => onChange({ sort: e.target.value as BuyerOrderSort, page: 1 })}
              aria-label={t("sortLabel")}
              className="h-8.5 w-40 rounded-lg bg-surface pl-7 pr-6 text-xs"
            >
              {ORDER_SORTS.map((s) => <option key={s} value={s}>{t(`sort.${s}`)}</option>)}
            </Select>
            <ListFilter size={12} className="pointer-events-none absolute left-2.5 top-2.5 text-muted" />
          </div>
          {active && (
            <Button size="sm" variant="ghost" onClick={onReset} className="h-8.5 gap-1 text-xs text-muted hover:text-fg">
              <X size={13} /> {to("clearFilters")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
