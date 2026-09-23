"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { useDelayedFlag } from "@/lib/hooks/useDelayedFlag";
import type { InventoryPackageSort, InventoryProductStatusFilter } from "@/lib/types";
import { ActivityBar, Button, Card, Input, Pagination, Select, Skeleton } from "@/components/ui";
import { AlertCircle, AlertTriangle, BarChart, CheckCircle2, Download, Package, Plus, RefreshCw, Search, X } from "@/components/Icons";
import {
  DEFAULT_INVENTORY_FILTERS, hasActiveInventoryFilters, PACKAGE_PAGE_SIZE, PACKAGE_SORTS, PRODUCT_STATUS_FILTERS,
  type InventoryFilters,
} from "../model";
import { useBulkPackageStatus, useInventoryPackages } from "../useInventory";
import { CategoryTreeSelect } from "./CategoryTreeSelect";
import { InventorySummaryStrip } from "./InventorySummaryStrip";
import { PackageTable } from "./PackageTable";

/** Package rows while the first page loads: cover, title lines, numbers. */
export function PackageRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <Skeleton className="h-3.5 w-3.5 rounded" />
          <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className={cn("h-3.5", i % 3 === 0 ? "w-2/5" : i % 3 === 1 ? "w-1/2" : "w-1/3")} />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="hidden h-3.5 w-14 sm:block" />
          <Skeleton className="h-3.5 w-10" />
          <Skeleton className="hidden h-5 w-16 rounded-md md:block" />
          <Skeleton className="hidden h-7 w-24 rounded-lg lg:block" />
        </div>
      ))}
    </div>
  );
}

export function InventoryConsoleSkeleton() {
  const t = useTranslations("sellerInventory");
  return (
    <div className="space-y-5" aria-busy="true">
      <span role="status" className="sr-only">{t("loading")}</span>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="space-y-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-3.5 w-72 max-w-full" /></div>
        <div className="flex gap-2"><Skeleton className="h-8 w-24 rounded-lg" /><Skeleton className="h-8 w-24 rounded-lg" /><Skeleton className="h-8 w-24 rounded-lg" /></div>
      </div>
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2 border-line px-4 py-3 [&:not(:first-child)]:sm:border-l">
              <Skeleton className="h-3 w-16" /><Skeleton className="h-5 w-12" /><Skeleton className="h-2.5 w-20" />
            </div>
          ))}
        </div>
      </Card>
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised/30 p-3">
          <Skeleton className="h-9 min-w-[200px] flex-1 rounded-lg" /><Skeleton className="h-9 w-40 rounded-lg" /><Skeleton className="h-9 w-44 rounded-lg" />
        </div>
        <PackageRowsSkeleton />
      </Card>
    </div>
  );
}

export function Switch({ checked, onChange, label, hint, busy }: { checked: boolean; onChange: (next: boolean) => void; label: string; hint?: string; busy?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-busy={busy || undefined} disabled={busy} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-[12.5px] text-fg disabled:cursor-wait disabled:opacity-70">
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
  const [bulkAction, setBulkAction] = useState<"activate" | "deactivate" | null>(null);
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
    setBulkAction(isActive ? "activate" : "deactivate");
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
    } finally {
      setBulkAction(null);
    }
  };

  const refreshing = query.isFetching;
  const dimmed = useDelayedFlag(refreshing && !query.isPending);
  // Typed but not yet applied (debounce) or applied and still loading.
  const searching = search.trim() !== filters.search.trim() || (refreshing && filters.search.trim() !== "");

  if (query.isPending) return <InventoryConsoleSkeleton />;
  if (query.isError && !query.data) {
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
  const staleError = query.isError;
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

          {staleError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/25 bg-warn-soft px-3 py-2 text-xs font-medium text-warn">
              <span className="flex items-center gap-1.5"><AlertTriangle size={14} className="shrink-0" /> {t("staleData")} {apiErrorMessage(query.error)}</span>
              <Button size="sm" variant="secondary" loading={refreshing} onClick={() => void query.refetch()} className="h-7 text-[12px]">{t("retry")}</Button>
            </div>
          )}

          <Card className="relative overflow-hidden p-0" aria-busy={refreshing}>
            <ActivityBar active={refreshing} label={t("refreshing")} />
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raised/30 p-3">
              <div className="relative min-w-[200px] flex-1">
                <span className="pointer-events-none absolute left-3 top-2.5 text-muted" aria-hidden><Search size={14} /></span>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("filters.searchPlaceholder")} aria-label={t("filters.searchPlaceholder")} className="h-9 rounded-lg pl-9 pr-8 text-xs" />
                {searching && (
                  <span aria-hidden className="absolute right-9 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin rounded-full border-[1.5px] border-iris border-t-transparent" />
                )}
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
                <Button size="sm" variant="secondary" loading={bulkAction === "deactivate"} disabled={bulk.isPending} onClick={() => void handleBulk(false)} className="h-7 gap-1 text-[12px]">{bulkAction !== "deactivate" && <Pause size={12} />} {t("bulk.deactivate")}</Button>
                <Button size="sm" variant="secondary" loading={bulkAction === "activate"} disabled={bulk.isPending} onClick={() => void handleBulk(true)} className="h-7 gap-1 text-[12px]">{bulkAction !== "activate" && <Play size={12} />} {t("bulk.activate")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="h-7 text-[12px] text-muted">{t("clearSelection")}</Button>
              </div>
            )}

            <div className={cn("transition-opacity duration-200", dimmed && "pointer-events-none opacity-55")}>
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
            </div>

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
