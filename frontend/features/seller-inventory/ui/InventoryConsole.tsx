"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useDebounce } from "@/lib/hooks/useDebounce";
import type { InventoryPackageSort, InventoryProductStatusFilter } from "@/lib/types";
import { Button, Card, Input, Pagination, Select } from "@/components/ui";
import { AlertCircle, AlertTriangle, BarChart, CheckCircle2, Download, Package, Plus, RefreshCw, Search, X } from "@/components/Icons";
import {
  DEFAULT_INVENTORY_FILTERS, hasActiveInventoryFilters, PACKAGE_PAGE_SIZE, PACKAGE_SORTS, PRODUCT_STATUS_FILTERS,
  type InventoryFilters,
} from "../model";
import { useBulkPackageStatus, useInventoryPackages } from "../useInventory";
import { CategoryTreeSelect } from "./CategoryTreeSelect";
import { InventorySummaryStrip } from "./InventorySummaryStrip";
import { PackageTable } from "./PackageTable";

export function InventoryConsoleSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5"><div className="h-6 w-40 rounded bg-raised" /><div className="h-3.5 w-64 rounded bg-raised" /></div>
        <div className="h-9 w-48 rounded-lg bg-raised" />
      </div>
      <div className="h-[84px] rounded-xl border border-line bg-raised" />
      <div className="h-96 rounded-xl border border-line bg-raised" />
    </div>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (next: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-[12.5px] text-fg">
      <span className={cn("relative inline-block h-[18px] w-[30px] rounded-full transition-colors", checked ? "bg-iris" : "bg-line-2")}>
        <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-all", checked ? "left-[14px]" : "left-0.5")} />
      </span>
      <span>{label}</span>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </button>
  );
}

export function InventoryConsole({
  filters,
  onFiltersChange,
}: {
  filters: InventoryFilters;
  onFiltersChange: (next: InventoryFilters) => void;
}) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const query = useInventoryPackages(filters);
  const bulk = useBulkPackageStatus();
  const [search, setSearch] = useState(filters.search);
  const debounced = useDebounce(search, 250);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<{ tone: "good" | "bad" | "warn"; text: string } | null>(null);

  const patch = useCallback((p: Partial<InventoryFilters>) => onFiltersChange({ ...filters, ...p }), [filters, onFiltersChange]);

  useEffect(() => { setSearch(filters.search); }, [filters.search]);
  useEffect(() => {
    if (debounced.trim() !== filters.search.trim()) patch({ search: debounced, page: 1 });
  }, [debounced, filters.search, patch]);
  useEffect(() => { setSelected(new Set()); }, [filters.page, filters.tab, filters.categoryIds, filters.productStatus]);

  const handleBulk = async (isActive: boolean) => {
    const ids = [...selected];
    try {
      const result = await bulk.mutateAsync({ ids, isActive });
      setSelected(new Set());
      const skipped = result.skipped.length;
      setNotice({
        tone: skipped ? "warn" : "good",
        text: t(isActive ? "notice.activated" : "notice.deactivated", { count: result.updated.length })
          + (skipped ? ` · ${t("notice.skipped", { count: skipped })}` : ""),
      });
    } catch (err) {
      setNotice({ tone: "bad", text: apiErrorMessage(err, t("notice.bulkFailed")) });
    }
  };

  if (query.isPending) return <InventoryConsoleSkeleton />;
  if (query.isError) {
    return (
      <Card className="p-10 text-center">
        <AlertCircle size={32} className="mx-auto mb-2 text-bad" />
        <p className="mb-1 text-[13.5px] font-medium text-fg">{t("loadFailed")}</p>
        <p className="mb-3 text-[12.5px] text-muted">{apiErrorMessage(query.error)}</p>
        <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>{t("retry")}</Button>
      </Card>
    );
  }

  const data = query.data;
  const counts = data.counts;
  const totalPages = Math.max(1, Math.ceil(data.total / PACKAGE_PAGE_SIZE));
  const refreshing = query.isFetching;
  const brandNew = counts.all === 0 && !hasActiveInventoryFilters(filters) && filters.hideInactive;
  const selectedIds = [...selected];
  // Export links carry package keys, not row ids (the export page matches either).
  const selectedRefs = selectedIds.map((id) => data.items.find((p) => p.variant_id === id)?.variant_key ?? String(id));
  const exportHref = selectedRefs.length ? `/seller/inventory/export?tab=goods&variants=${selectedRefs.join(",")}` : "/seller/inventory/export?tab=goods";
  const reportHref = selectedRefs.length ? `/seller/inventory/export?tab=report&variants=${selectedRefs.join(",")}` : "/seller/inventory/export?tab=report";

  return (
    <div className="space-y-5 animate-fade">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-[18px] font-bold tracking-tight text-fg">{t("title")}</h1>
          <p className="text-[12.5px] text-muted">
            {t("subtitle", {
              packages: counts.all.toLocaleString(locale),
              products: counts.products.toLocaleString(locale),
              available: counts.available_total.toLocaleString(locale),
              threshold: data.low_stock_threshold,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/seller/inventory/export?tab=report"><Button size="sm" variant="secondary" className="gap-1.5"><BarChart size={14} /> {t("actions.report")}</Button></Link>
          <Link href="/seller/inventory/export?tab=goods"><Button size="sm" variant="secondary" className="gap-1.5"><Download size={14} /> {t("actions.export")}</Button></Link>
          <Button size="sm" variant="secondary" onClick={() => void query.refetch()} disabled={refreshing} className="gap-1.5">
            <RefreshCw size={14} className={cn(refreshing && "animate-spin")} /> {t("refresh")}
          </Button>
        </div>
      </div>

      {brandNew ? (
        <Card className="p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl border border-line bg-raised text-faint"><Package size={24} /></div>
          <p className="mb-1 text-[14px] font-medium text-fg">{t("empty.title")}</p>
          <p className="mx-auto mb-4 max-w-sm text-[12.5px] text-muted">{t("empty.hint")}</p>
          <Link href="/seller/products/new"><Button size="md"><Plus size={15} /> {t("empty.cta")}</Button></Link>
        </Card>
      ) : (
        <>
          <InventorySummaryStrip counts={counts} threshold={data.low_stock_threshold} active={filters.tab} onSelect={(tab) => patch({ tab, page: 1 })} />

          {notice && (
            <div role="alert" className={cn(
              "flex items-start justify-between gap-2 rounded-lg border p-2.5 text-xs font-medium",
              notice.tone === "good" && "border-good/20 bg-good-soft text-good",
              notice.tone === "warn" && "border-warn/20 bg-warn-soft text-warn",
              notice.tone === "bad" && "border-bad/20 bg-bad-soft text-bad",
            )}>
              <span className="flex items-start gap-1.5">
                {notice.tone === "good" ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                {notice.text}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setNotice(null)} className="h-6 px-1.5"><X size={12} /></Button>
            </div>
          )}

          <Card className={cn("overflow-hidden p-0 transition-opacity", refreshing && "opacity-70")} aria-busy={refreshing}>
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised/30 p-3">
              <div className="relative min-w-[200px] flex-1">
                <span className="pointer-events-none absolute left-3 top-2.5 text-muted" aria-hidden><Search size={14} /></span>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("filters.searchPlaceholder")} aria-label={t("filters.searchPlaceholder")} className="h-9 rounded-lg pl-9 pr-8 text-xs" />
                {search && (
                  <Button size="sm" variant="ghost" onClick={() => setSearch("")} aria-label={t("clear")} className="absolute right-1 top-1 h-7 w-7 p-0 text-muted hover:text-fg"><X size={13} /></Button>
                )}
              </div>
              {data.categories.length > 0 && (
                <CategoryTreeSelect facet={data.categories} value={filters.categoryIds} onChange={(categoryIds) => patch({ categoryIds, page: 1 })} />
              )}
              <Select value={filters.productStatus} onChange={(e) => patch({ productStatus: e.target.value as InventoryProductStatusFilter, page: 1 })} aria-label={t("filters.productStatus")} className="h-9 w-40 rounded-lg px-2.5 text-xs">
                {PRODUCT_STATUS_FILTERS.map((s) => <option key={s} value={s}>{t(`filters.products.${s}`)}</option>)}
              </Select>
              <Select value={filters.sort} onChange={(e) => patch({ sort: e.target.value as InventoryPackageSort, page: 1 })} aria-label={t("filters.sort")} className="h-9 w-44 rounded-lg px-2.5 text-xs">
                {PACKAGE_SORTS.map((s) => <option key={s} value={s}>{t(`sort.${s}`)}</option>)}
              </Select>
              <div className="flex flex-wrap items-center gap-4 pl-1">
                <Switch checked={filters.grouped} onChange={(grouped) => patch({ grouped, page: 1 })} label={t("filters.groupByProduct")} />
                <Switch
                  checked={filters.hideInactive}
                  onChange={(hideInactive) => patch({ hideInactive, page: 1 })}
                  label={t("filters.hideInactive")}
                  hint={counts.inactive > 0 ? `· ${counts.inactive}` : undefined}
                />
              </div>
              {hasActiveInventoryFilters(filters) && (
                <Button size="sm" variant="ghost" onClick={() => { setSearch(""); onFiltersChange({ ...DEFAULT_INVENTORY_FILTERS, grouped: filters.grouped, hideInactive: filters.hideInactive }); }} className="h-9 gap-1 text-xs text-muted hover:text-fg">
                  <X size={13} /> {t("clearFilters")}
                </Button>
              )}
            </div>

            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-iris-soft/40 px-3 py-2 text-[12.5px]">
                <span className="font-semibold text-fg">{t("bulk.selected", { count: selected.size })}</span>
                <Link href={exportHref}><Button size="sm" variant="secondary" className="h-7 gap-1 text-[12px]"><Download size={12} /> {t("bulk.export")}</Button></Link>
                <Link href={reportHref}><Button size="sm" variant="secondary" className="h-7 gap-1 text-[12px]"><BarChart size={12} /> {t("bulk.report")}</Button></Link>
                <Button size="sm" variant="secondary" disabled={bulk.isPending} onClick={() => void handleBulk(false)} className="h-7 gap-1 text-[12px]"><Pause size={12} /> {t("bulk.deactivate")}</Button>
                <Button size="sm" variant="secondary" disabled={bulk.isPending} onClick={() => void handleBulk(true)} className="h-7 gap-1 text-[12px]"><Play size={12} /> {t("bulk.activate")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="h-7 text-[12px] text-muted">{t("clearSelection")}</Button>
              </div>
            )}

            {data.items.length === 0 ? (
              <div className="p-8 text-center">
                <Package size={32} className="mx-auto mb-2 text-faint" />
                <p className="mb-1 text-[13.5px] font-medium text-fg">{t("noMatch.title")}</p>
                <p className="mb-3 text-[12px] text-muted">{t("noMatch.hint")}</p>
                <Button size="sm" variant="secondary" onClick={() => { setSearch(""); onFiltersChange({ ...DEFAULT_INVENTORY_FILTERS }); }}>{t("clearFilters")}</Button>
              </div>
            ) : (
              <PackageTable
                items={data.items}
                grouped={filters.grouped}
                threshold={data.low_stock_threshold}
                sort={filters.sort}
                onSort={(sort) => patch({ sort, page: 1 })}
                selected={selected}
                onSelect={(ids, checked) => setSelected((prev) => { const next = new Set(prev); ids.forEach((id) => (checked ? next.add(id) : next.delete(id))); return next; })}
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-raised/20 p-3 text-xs">
              <span className="text-[12px] text-muted">
                {filters.grouped
                  ? t("pager.products", { from: (filters.page - 1) * PACKAGE_PAGE_SIZE + 1, to: Math.min(filters.page * PACKAGE_PAGE_SIZE, data.total), total: data.total })
                  : t("pager.packages", { from: (filters.page - 1) * PACKAGE_PAGE_SIZE + 1, to: Math.min(filters.page * PACKAGE_PAGE_SIZE, data.total), total: data.total })}
                {counts.inactive > 0 && (
                  <>
                    {" · "}
                    <button type="button" onClick={() => patch({ hideInactive: !filters.hideInactive, page: 1 })} className="text-iris hover:underline">
                      {filters.hideInactive ? t("pager.inactiveHidden", { count: counts.inactive }) : t("pager.inactiveShown", { count: counts.inactive })}
                    </button>
                  </>
                )}
              </span>
              <Pagination page={filters.page} totalPages={totalPages} onChange={(page) => patch({ page })} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
