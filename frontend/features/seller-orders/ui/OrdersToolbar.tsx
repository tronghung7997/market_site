"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useDebounce } from "@/lib/hooks/useDebounce";
import type { SellerOrderKind, SellerOrderSort } from "@/lib/types";
import { Button, Input, Select } from "@/components/ui";
import { ListFilter, Search, X } from "@/components/Icons";
import { hasActiveOrderFilters, ORDER_KINDS, ORDER_SORTS, type SellerOrdersFilters } from "../model";

export function OrdersToolbar({
  filters,
  products,
  onChange,
  onReset,
}: {
  filters: SellerOrdersFilters;
  products: { id: number; public_key?: string | null; title: string }[];
  onChange: (patch: Partial<SellerOrdersFilters>) => void;
  onReset: () => void;
}) {
  const t = useTranslations("seller");
  const to = useTranslations("sellerOrders");
  const [search, setSearch] = useState(filters.search);
  const debounced = useDebounce(search, 300);

  // Keep the box in sync when the URL changes from outside (back button, links).
  useEffect(() => { setSearch(filters.search); }, [filters.search]);
  useEffect(() => {
    if (debounced.trim() !== filters.search.trim()) onChange({ search: debounced, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="flex flex-col gap-2.5 border-b border-line bg-raised/30 p-3 md:flex-row md:items-center md:justify-between">
      <div className="relative w-full flex-1 md:max-w-sm">
        <span className="pointer-events-none absolute left-3 top-2.5 text-faint"><Search size={13} /></span>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchOrders")}
          aria-label={t("searchOrders")}
          className="h-8.5 w-full rounded-lg bg-surface pl-8 pr-7 text-xs"
        />
        {search && (
          <Button size="sm" variant="ghost" onClick={() => setSearch("")} aria-label={t("clearFilters")} className="absolute right-1 top-1 h-6.5 w-6.5 p-0 text-faint hover:text-fg">
            <X size={12} />
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {products.length > 0 && (
          <div className="relative w-44 sm:w-52">
            <Select
              value={filters.product ?? "all"}
              onChange={(e) => onChange({ product: e.target.value === "all" ? null : e.target.value, page: 1 })}
              aria-label={t("allProducts")}
              className="h-8.5 w-full truncate rounded-lg bg-surface pl-7 pr-6 text-xs"
            >
              <option value="all">{t("allProducts")}</option>
              {products.map((p) => <option key={p.id} value={p.public_key ?? String(p.id)}>{p.title}</option>)}
            </Select>
            <ListFilter size={12} className="pointer-events-none absolute left-2.5 top-2.5 text-muted" />
          </div>
        )}
        <Select
          value={filters.kind ?? "all"}
          onChange={(e) => onChange({ kind: e.target.value === "all" ? null : (e.target.value as SellerOrderKind), page: 1 })}
          aria-label={to("kindFilter")}
          className="h-8.5 w-36 rounded-lg bg-surface px-2.5 text-xs"
        >
          <option value="all">{to("kindAll")}</option>
          {ORDER_KINDS.map((k) => <option key={k} value={k}>{to(`kind.${k}`)}</option>)}
        </Select>
        <Input
          type="date"
          value={filters.dateFrom}
          max={filters.dateTo || undefined}
          onChange={(e) => onChange({ dateFrom: e.target.value, page: 1 })}
          aria-label={to("dateFrom")}
          className="h-8.5 w-auto rounded-lg bg-surface px-2 text-xs"
        />
        <span className="text-faint">–</span>
        <Input
          type="date"
          value={filters.dateTo}
          min={filters.dateFrom || undefined}
          onChange={(e) => onChange({ dateTo: e.target.value, page: 1 })}
          aria-label={to("dateTo")}
          className="h-8.5 w-auto rounded-lg bg-surface px-2 text-xs"
        />
        <Select
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value as SellerOrderSort, page: 1 })}
          aria-label={to("sortLabel")}
          className="h-8.5 w-36 rounded-lg bg-surface px-2.5 text-xs"
        >
          {ORDER_SORTS.map((s) => <option key={s} value={s}>{to(`sort.${s}`)}</option>)}
        </Select>
        {hasActiveOrderFilters(filters) && (
          <Button size="sm" variant="ghost" onClick={onReset} className="h-8.5 gap-1 text-xs text-muted hover:text-fg">
            <X size={13} /> {t("clearFilters")}
          </Button>
        )}
      </div>
    </div>
  );
}
