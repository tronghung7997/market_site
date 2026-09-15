"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useDebounce } from "@/lib/hooks/useDebounce";
import type { SellerProduct, SellerProductBulkStatusResult, SellerProductSort, SellerProductTab } from "@/lib/types";
import { CategoryTreeSelect, nextSellerProductStatus } from "@/features/seller-inventory";
import { Button, Card, Input, Pagination, Select } from "@/components/ui";
import { AlertCircle, AlertTriangle, CheckCircle2, ListFilter, Package, Plus, Search, X } from "@/components/Icons";
import { DEFAULT_PRODUCT_FILTERS, hasActiveProductFilters, PAGE_SIZE, PRODUCT_SORTS, PRODUCT_TABS, type SellerProductsFilters } from "../model";
import { useBulkProductStatus, useSellerProducts, useToggleProductStatus } from "../useSellerProducts";
import { RestockDialog } from "./RestockDialog";
import { SellerProductsTable } from "./SellerProductsTable";

const TAB_TONE: Record<SellerProductTab, "neutral" | "good" | "warn" | "bad"> = {
  all: "neutral", active: "good", low_stock: "warn", out_of_stock: "bad", paused: "neutral", draft: "neutral",
};
const TONE_TEXT = { neutral: "text-fg", good: "text-good", warn: "text-warn", bad: "text-bad" } as const;
const TONE_RING = { neutral: "ring-line-2", good: "ring-good/40", warn: "ring-warn/40", bad: "ring-bad/40" } as const;

export function SellerProductsSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5"><div className="h-6 w-40 rounded bg-raised" /><div className="h-3.5 w-24 rounded bg-raised" /></div>
        <div className="h-9 w-28 rounded-lg bg-raised" />
      </div>
      <div className="h-[84px] rounded-xl border border-line bg-raised" />
      <div className="h-80 rounded-xl border border-line bg-raised" />
    </div>
  );
}

export function SellerProductsConsole({
  filters,
  onFiltersChange,
}: {
  filters: SellerProductsFilters;
  onFiltersChange: (next: SellerProductsFilters) => void;
}) {
  const t = useTranslations("seller");
  const tp = useTranslations("sellerProducts");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const query = useSellerProducts(filters);
  const toggle = useToggleProductStatus();
  const bulk = useBulkProductStatus();
  const [search, setSearch] = useState(filters.search);
  const debounced = useDebounce(search, 250);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [restockProduct, setRestockProduct] = useState<SellerProduct | null>(null);
  const [notice, setNotice] = useState<{ tone: "good" | "bad" | "warn"; text: string } | null>(null);

  const patch = useCallback((p: Partial<SellerProductsFilters>) => onFiltersChange({ ...filters, ...p }), [filters, onFiltersChange]);

  useEffect(() => { setSearch(filters.search); }, [filters.search]);
  useEffect(() => {
    if (debounced.trim() !== filters.search.trim()) patch({ search: debounced, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  // Selection is per result set: a new filter/page starts clean.
  useEffect(() => { setSelected(new Set()); }, [filters.tab, filters.search, filters.categoryIds, filters.serviceType, filters.page, filters.sort]);

  const handleToggleStatus = async (product: SellerProduct) => {
    const status = nextSellerProductStatus(product.status);
    if (!status) return;
    setNotice(null);
    try {
      await toggle.mutateAsync({ id: product.id, status });
    } catch (err: unknown) {
      setNotice({ tone: "bad", text: apiErrorMessage(err, tp("statusFailed")) });
    }
  };

  const describeBulk = (result: SellerProductBulkStatusResult, status: "active" | "paused") => {
    const done = tp(status === "active" ? "bulkActivated" : "bulkPaused", { count: result.updated.length });
    if (result.skipped.length === 0) return { tone: "good" as const, text: done };
    const reasons = result.skipped.map((s) => `#${s.id} (${tp(`skip.${s.reason}`)})`).join(", ");
    return { tone: "warn" as const, text: `${done} · ${tp("bulkSkipped", { count: result.skipped.length })}: ${reasons}` };
  };

  const handleBulk = async (status: "active" | "paused") => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setNotice(null);
    try {
      const result = await bulk.mutateAsync({ ids, status });
      setNotice(describeBulk(result, status));
      setSelected(new Set());
    } catch (err: unknown) {
      setNotice({ tone: "bad", text: apiErrorMessage(err, tp("bulkFailed")) });
    }
  };

  if (query.isPending) return <SellerProductsSkeleton />;
  if (query.isError && !query.data) {
    return (
      <Card className="p-10 text-center">
        <AlertCircle size={32} className="mx-auto mb-2 text-bad" />
        <p className="mb-1 text-[13.5px] font-medium text-fg">{t("productsLoadFailed")}</p>
        <p className="mb-3 text-[12.5px] text-muted">{apiErrorMessage(query.error)}</p>
        <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>{t("retry")}</Button>
      </Card>
    );
  }

  const data = query.data;
  const counts = data.counts;
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const refreshing = query.isFetching;
  const brandNew = counts.all === 0 && !hasActiveProductFilters(filters);

  return (
    <div className="space-y-5 animate-fade">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-[18px] font-bold tracking-tight text-fg">{t("yourProducts")}</h1>
          <p className="text-[12.5px] text-muted">
            {t("productCount", { count: counts.all })} · {tp("stockSummary", { count: counts.total_stock.toLocaleString(locale) })}
            {counts.suspended > 0 && <span className="text-bad"> · {tp("suspendedNote", { count: counts.suspended })}</span>}
          </p>
        </div>
        <Link href="/seller/products/new">
          <Button size="md" className="gap-1.5 shadow-sm"><Plus size={15} /> {t("createNew")}</Button>
        </Link>
      </div>

      {brandNew ? (
        <Card className="p-10 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl border border-line bg-raised text-faint"><Package size={24} /></div>
          <p className="mb-1 text-[14px] font-medium text-fg">{t("noProductsYet")}</p>
          <p className="mx-auto mb-4 max-w-sm text-[12.5px] text-muted">{t("productsPageFirstDescription")}</p>
          <Link href="/seller/products/new"><Button size="md"><Plus size={15} /> {t("createFirstProduct")}</Button></Link>
        </Card>
      ) : (
        <>
          {/* Segmented summary = tab bar */}
          <Card className="overflow-hidden p-0">
            <div role="tablist" aria-label={tp("tabsLabel")} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
              {PRODUCT_TABS.map((tab, i) => {
                const active = filters.tab === tab;
                const count = counts[tab];
                const tone = TAB_TONE[tab];
                const muted = count === 0 && tab !== "all";
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => patch({ tab: active && tab !== "all" ? "all" : tab, page: 1 })}
                    className={cn(
                      "flex flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-raised/60",
                      i > 0 && "border-t border-line sm:border-t-0 lg:border-l",
                      i % 2 === 1 && "border-l border-line sm:border-l-0",
                      i % 3 !== 0 && "sm:border-l sm:border-line",
                      i >= 3 && "sm:border-t sm:border-line lg:border-t-0",
                      active && cn("bg-raised/50 ring-2 ring-inset", TONE_RING[tone]),
                    )}
                  >
                    <span className={cn("text-[11.5px] font-medium", muted ? "text-faint" : TONE_TEXT[tone])}>{tp(`tab.${tab}`)}</span>
                    <span className={cn("font-mono text-[20px] font-semibold leading-none tabular", muted ? "text-faint" : "text-fg")}>{count.toLocaleString(locale)}</span>
                    <span className="text-[11px] text-faint">
                      {tab === "low_stock" ? tp("hint.low_stock", { threshold: counts.low_stock_threshold }) : tp(`hint.${tab}`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

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
              {data.category_facet.length > 0 && (
                <CategoryTreeSelect facet={data.category_facet} value={filters.categoryIds} onChange={(next) => patch({ categoryIds: next, page: 1 })} />
              )}
              {data.service_types.length > 0 && (
                <div className="relative">
                  <Select value={filters.serviceType ?? "all"} onChange={(e) => patch({ serviceType: e.target.value === "all" ? null : e.target.value, page: 1 })} aria-label={t("allServiceTypes")} className="h-9 min-w-[140px] rounded-lg pl-8 pr-7 text-xs">
                    <option value="all">{t("allServiceTypes")}</option>
                    {data.service_types.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                  <ListFilter size={13} className="pointer-events-none absolute left-2.5 top-3 text-muted" />
                </div>
              )}
              <Select value={filters.sort} onChange={(e) => patch({ sort: e.target.value as SellerProductSort, page: 1 })} aria-label={tp("sortLabel")} className="h-9 w-44 rounded-lg px-2.5 text-xs">
                {PRODUCT_SORTS.map((s) => <option key={s} value={s}>{tp(`sort.${s}`)}</option>)}
              </Select>
              <div className="relative min-w-[200px] flex-1">
                <span className="pointer-events-none absolute left-3 top-2.5 text-muted" aria-hidden><Search size={14} /></span>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("searchProductsPlaceholder")} aria-label={t("searchProductsPlaceholder")} className="h-9 rounded-lg pl-9 pr-8 text-xs" />
                {search && (
                  <Button size="sm" variant="ghost" onClick={() => setSearch("")} aria-label={t("clearFilters")} className="absolute right-1 top-1 h-7 w-7 p-0 text-muted hover:text-fg"><X size={13} /></Button>
                )}
              </div>
              {hasActiveProductFilters(filters) && (
                <Button size="sm" variant="ghost" onClick={() => { setSearch(""); onFiltersChange({ ...DEFAULT_PRODUCT_FILTERS }); }} className="h-9 gap-1 text-xs text-muted hover:text-fg">
                  <X size={13} /> {t("clearFilters")}
                </Button>
              )}
            </div>

            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-iris-soft/40 px-3 py-2 text-[12.5px]">
                <span className="font-semibold text-fg">{tp("selectedCount", { count: selected.size })}</span>
                <Button size="sm" variant="secondary" disabled={bulk.isPending} onClick={() => handleBulk("active")} className="h-7 text-[12px]">{t("activate")}</Button>
                <Button size="sm" variant="secondary" disabled={bulk.isPending} onClick={() => handleBulk("paused")} className="h-7 text-[12px]">{t("pause")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="h-7 text-[12px] text-muted">{tp("clearSelection")}</Button>
              </div>
            )}

            {data.items.length === 0 ? (
              <div className="p-8 text-center">
                <Package size={32} className="mx-auto mb-2 text-faint" />
                <p className="mb-1 text-[13.5px] font-medium text-fg">{t("noMatchingProducts")}</p>
                <p className="mb-3 text-[12px] text-muted">{t("productsPageNoMatchHint")}</p>
                <Button size="sm" variant="secondary" onClick={() => { setSearch(""); onFiltersChange({ ...DEFAULT_PRODUCT_FILTERS }); }}>{t("clearFilters")}</Button>
              </div>
            ) : (
              <SellerProductsTable
                products={data.items}
                lowStockThreshold={counts.low_stock_threshold}
                sort={filters.sort}
                onSort={(sort) => patch({ sort, page: 1 })}
                selected={selected}
                onToggleSelect={(id) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })}
                onToggleAll={(ids, checked) => setSelected((prev) => { const next = new Set(prev); ids.forEach((id) => (checked ? next.add(id) : next.delete(id))); return next; })}
                togglingId={toggle.isPending ? toggle.variables?.id ?? null : null}
                onToggleStatus={handleToggleStatus}
                onRestock={setRestockProduct}
              />
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-line bg-raised/20 p-3 text-xs">
                <span className="text-[12px] text-muted">
                  {t("paginationProducts", { from: (filters.page - 1) * PAGE_SIZE + 1, to: Math.min(filters.page * PAGE_SIZE, data.total), total: data.total })}
                </span>
                <Pagination page={filters.page} totalPages={totalPages} onChange={(page) => patch({ page })} />
              </div>
            )}
          </Card>
        </>
      )}

      <RestockDialog product={restockProduct} onClose={() => setRestockProduct(null)} />
    </div>
  );
}
