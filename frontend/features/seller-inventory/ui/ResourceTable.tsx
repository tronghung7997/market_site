"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { formatDateTime } from "@/lib/utils";
import type { InventoryPackageDetail, Resource, ResourceSort, ResourceStatusFilter } from "@/lib/types";
import { Button, Input, Pagination, Select } from "@/components/ui";
import { AlertCircle, Copy, Check, Download, Eye, EyeOff, Package, RotateCcw, Search, X } from "@/components/Icons";
import {
  hasOrderValue, maskResourceData, RESOURCE_DATE_PRESETS, RESOURCE_PAGE_SIZES, RESOURCE_STATUS_TABS, resourceDateBounds,
  type ResourceDatePreset, type ResourceFilters, type ResourceOrderFilter,
} from "../model";
import { useBulkResourceAction, useInventoryResources } from "../useInventory";
import { ConfirmDialog } from "./ConfirmDialog";
import { ResourceDetailDialog, resourceStatusTone } from "./ResourceDetailDialog";

function tabCount(pkg: InventoryPackageDetail, tab: ResourceStatusFilter): number {
  switch (tab) {
    case "all": return pkg.available + pkg.assigned + pkg.error + pkg.expired;
    case "available": return pkg.available;
    case "assigned": return pkg.assigned;
    case "error": return pkg.error;
    case "expired": return pkg.expired;
    case "archived": return pkg.archived;
  }
}

function shortDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function ResourceTable({
  pkg,
  filters,
  onFiltersChange,
  onNotice,
}: {
  pkg: InventoryPackageDetail;
  filters: ResourceFilters;
  onFiltersChange: (next: ResourceFilters) => void;
  onNotice: (tone: "good" | "bad" | "warn", text: string) => void;
}) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const [search, setSearch] = useState(filters.search);
  const debounced = useDebounce(search, 250);
  const [masked, setMasked] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [detail, setDetail] = useState<Resource | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ action: "archive" | "restore"; count: number } | null>(null);
  const [jump, setJump] = useState("");
  const bulk = useBulkResourceAction(pkg.variant_id);

  const patch = (p: Partial<ResourceFilters>) => onFiltersChange({ ...filters, ...p });
  useEffect(() => { setSearch(filters.search); }, [filters.search]);
  useEffect(() => {
    if (debounced.trim() !== filters.search.trim()) patch({ search: debounced, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => { setSelected(new Set()); setAllMatching(false); }, [filters.status, filters.search, filters.datePreset, filters.from, filters.to, filters.order, filters.page, filters.perPage]);

  const bounds = resourceDateBounds(filters);
  const queryParams = {
    page: filters.page, perPage: filters.perPage, status: filters.status, search: filters.search.trim(),
    createdFrom: bounds.createdFrom, createdTo: bounds.createdTo, hasOrder: hasOrderValue(filters.order), sort: filters.sort,
  };
  const query = useInventoryResources(pkg.variant_id, queryParams);
  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / filters.perPage));
  const pageSelected = rows.filter((r) => selected.has(r.id)).length;
  const allPageSelected = rows.length > 0 && pageSelected === rows.length;
  const effectiveCount = allMatching ? total : selected.size;

  const copy = async (r: Resource) => {
    try {
      await navigator.clipboard.writeText(r.data);
      setCopiedId(r.id);
      setTimeout(() => setCopiedId((c) => (c === r.id ? null : c)), 1600);
    } catch {
      onNotice("bad", t("resource.copyFailed"));
    }
  };

  const runBulk = async () => {
    if (!confirm) return;
    try {
      const result = await bulk.mutateAsync(
        allMatching
          ? { action: confirm.action, allMatching: true, status: filters.status, search: filters.search, createdFrom: bounds.createdFrom, createdTo: bounds.createdTo, hasOrder: hasOrderValue(filters.order) }
          : { action: confirm.action, resourceIds: [...selected] },
      );
      onNotice("good", t(confirm.action === "archive" ? "bulk.archived" : "bulk.restored", { count: result.count }));
      setSelected(new Set());
      setAllMatching(false);
    } catch (err) {
      onNotice("bad", apiErrorMessage(err, t("bulk.failed")));
    } finally {
      setConfirm(null);
    }
  };

  const exportHref = `/seller/inventory/export?tab=goods&variants=${pkg.variant_id}${filters.status !== "all" && filters.status !== "archived" ? `&status=${filters.status}` : ""}${filters.status === "archived" ? "&archived=1" : ""}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label={t("resource.tabsLabel")} className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-raised p-0.5">
          {RESOURCE_STATUS_TABS.map((tab) => {
            const active = filters.status === tab;
            const count = tabCount(pkg, tab);
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => patch({ status: tab, page: 1 })}
                className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors", active ? "bg-surface text-fg shadow-xs" : "text-muted hover:text-fg")}
              >
                {t(`resource.tab.${tab}`)}
                <span className={cn("rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none", tab === "available" ? "bg-good-soft text-good" : tab === "error" ? "bg-warn-soft text-warn" : "bg-raised text-muted")}>
                  {count.toLocaleString(locale)}
                </span>
              </button>
            );
          })}
        </div>
        <Link href={exportHref}><Button size="sm" variant="secondary" className="h-8 gap-1.5 text-xs"><Download size={13} /> {t("resource.export")}</Button></Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-raised/40 px-2.5 py-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("resource.searchPlaceholder")} aria-label={t("resource.searchPlaceholder")} className="h-8 bg-surface pl-8 pr-7 text-xs" />
          {search && <button type="button" onClick={() => setSearch("")} aria-label={t("clear")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-fg"><X size={12} /></button>}
        </div>
        <Select value={filters.datePreset} onChange={(e) => patch({ datePreset: e.target.value as ResourceDatePreset, page: 1, ...(e.target.value !== "custom" ? { from: "", to: "" } : {}) })} aria-label={t("resource.dateLabel")} className="h-8 w-40 bg-surface text-xs">
          {RESOURCE_DATE_PRESETS.map((p) => <option key={p} value={p}>{t(`resource.date.${p}`)}</option>)}
        </Select>
        {filters.datePreset === "custom" && (
          <span className="inline-flex items-center gap-1">
            <Input type="date" value={filters.from} onChange={(e) => patch({ from: e.target.value, page: 1 })} aria-label={t("resource.from")} className="h-8 w-auto bg-surface text-xs" />
            <span className="text-faint">→</span>
            <Input type="date" value={filters.to} onChange={(e) => patch({ to: e.target.value, page: 1 })} aria-label={t("resource.to")} className="h-8 w-auto bg-surface text-xs" />
          </span>
        )}
        <Select value={filters.order} onChange={(e) => patch({ order: e.target.value as ResourceOrderFilter, page: 1 })} aria-label={t("resource.orderLabel")} className="h-8 w-40 bg-surface text-xs">
          <option value="all">{t("resource.order.all")}</option>
          <option value="with">{t("resource.order.with")}</option>
          <option value="without">{t("resource.order.without")}</option>
        </Select>
        <Select value={filters.sort} onChange={(e) => patch({ sort: e.target.value as ResourceSort, page: 1 })} aria-label={t("resource.sortLabel")} className="h-8 w-36 bg-surface text-xs">
          <option value="newest">{t("resource.sort.newest")}</option>
          <option value="oldest">{t("resource.sort.oldest")}</option>
        </Select>
        <Button size="sm" variant="secondary" onClick={() => setMasked((m) => !m)} aria-pressed={masked} className="ml-auto h-8 gap-1.5 text-xs">
          {masked ? <Eye size={13} /> : <EyeOff size={13} />} {masked ? t("resource.reveal") : t("resource.mask")}
        </Button>
      </div>

      {(selected.size > 0 || allMatching) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-iris/30 bg-iris-soft/20 px-3 py-2 text-[12.5px]">
          <span className="font-semibold text-iris-hi">
            {allMatching ? t("bulk.allMatching", { count: total.toLocaleString(locale) }) : t("bulk.selectedRows", { count: selected.size })}
          </span>
          {!allMatching && total > rows.length && (
            <button type="button" onClick={() => setAllMatching(true)} className="font-medium text-iris hover:underline">{t("bulk.selectAllMatching", { count: total.toLocaleString(locale) })}</button>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {filters.status === "archived" ? (
              <Button size="sm" onClick={() => setConfirm({ action: "restore", count: effectiveCount })} disabled={bulk.isPending} className="h-7 gap-1 text-xs"><RotateCcw size={12} /> {t("bulk.restore", { count: effectiveCount.toLocaleString(locale) })}</Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setConfirm({ action: "archive", count: effectiveCount })} disabled={bulk.isPending} className="h-7 gap-1 text-xs text-muted hover:text-bad"><EyeOff size={12} /> {t("bulk.archive", { count: effectiveCount.toLocaleString(locale) })}</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => { setSelected(new Set()); setAllMatching(false); }} className="h-7 text-xs text-muted">{t("clearSelection")}</Button>
          </span>
        </div>
      )}

      <div className={cn("relative overflow-hidden rounded-xl border border-line bg-surface", query.isFetching && "opacity-80")} aria-busy={query.isFetching}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] table-fixed border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-raised/40 text-[11px] font-semibold uppercase tracking-wider text-faint">
                <th className="w-9 px-3 py-2.5">
                  <input type="checkbox" aria-label={t("resource.selectPage")} checked={allPageSelected} disabled={rows.length === 0} ref={(el) => { if (el) el.indeterminate = pageSelected > 0 && !allPageSelected; }} onChange={(e) => setSelected((prev) => { const next = new Set(prev); rows.forEach((r) => (e.target.checked ? next.add(r.id) : next.delete(r.id))); return next; })} className="h-3.5 w-3.5 rounded border-line-2 text-iris" />
                </th>
                <th className="w-[72px] px-2 py-2.5">ID</th>
                <th className="w-[120px] px-2 py-2.5">{t("resource.colStatus")}</th>
                <th className="px-2 py-2.5">{t("resource.colData")}</th>
                <th className="w-[72px] px-2 py-2.5">{t("resource.colOrder")}</th>
                <th className="w-[104px] px-2 py-2.5">{t("resource.colCreated")}</th>
                <th className="w-[104px] px-2 py-2.5">{t("resource.colAssigned")}</th>
                <th className="w-[44px] px-2 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-[12px]">
              {query.isPending ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-3 py-2.5"><div className="h-3.5 w-3.5 rounded bg-raised" /></td>
                    <td className="px-2 py-2.5"><div className="h-3.5 w-10 rounded bg-raised" /></td>
                    <td className="px-2 py-2.5"><div className="h-4 w-16 rounded bg-raised" /></td>
                    <td className="px-2 py-2.5"><div className="h-3.5 w-3/4 rounded bg-raised" /></td>
                    <td className="px-2 py-2.5"><div className="h-3.5 w-8 rounded bg-raised" /></td>
                    <td className="px-2 py-2.5"><div className="h-3.5 w-16 rounded bg-raised" /></td>
                    <td className="px-2 py-2.5"><div className="h-3.5 w-16 rounded bg-raised" /></td>
                    <td />
                  </tr>
                ))
              ) : query.isError ? (
                <tr><td colSpan={8} className="py-10 text-center text-bad">
                  <AlertCircle size={22} className="mx-auto mb-1" />
                  <p className="mb-2">{apiErrorMessage(query.error, t("resource.loadFailed"))}</p>
                  <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>{t("retry")}</Button>
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-muted">
                  <Package size={26} className="mx-auto mb-2 text-faint" />
                  <p className="font-medium text-fg">{t("resource.empty")}</p>
                  <p className="text-[11px] text-faint">{t("resource.emptyHint")}</p>
                </td></tr>
              ) : rows.map((r) => {
                const st = resourceStatusTone(r);
                const isSelected = selected.has(r.id) || allMatching;
                return (
                  <tr key={r.id} onClick={() => setDetail(r)} className={cn("cursor-pointer transition-colors hover:bg-raised/40", isSelected && "bg-iris-soft/20")}>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={t("resource.selectRow", { id: r.id })} checked={isSelected} disabled={allMatching} onChange={() => setSelected((prev) => { const next = new Set(prev); if (next.has(r.id)) next.delete(r.id); else next.add(r.id); return next; })} className="h-3.5 w-3.5 rounded border-line-2 text-iris" />
                    </td>
                    <td className="px-2 py-2 font-mono text-[11.5px] text-faint">{r.id}</td>
                    <td className="px-2 py-2">
                      <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium leading-none", st.tone === "good" && "border-good/25 bg-good-soft text-good", st.tone === "bad" && "border-bad/25 bg-bad-soft text-bad", st.tone === "warn" && "border-warn/25 bg-warn-soft text-warn", st.tone === "neutral" && "border-line-2 bg-surface text-muted")}>
                        {t(`resource.status.${st.key}`)}
                      </span>
                      {st.key === "returned" && <div className="mt-0.5 text-[10.5px] text-warn-hi">{t("resource.returnedShort", { id: r.order_id ?? 0 })}</div>}
                    </td>
                    <td className="px-2 py-2 font-mono text-[12px] text-fg">
                      <div className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate" title={masked ? undefined : r.data}>{masked ? maskResourceData(r.data) : r.data}</span>
                        <button type="button" onClick={(e) => { e.stopPropagation(); void copy(r); }} aria-label={t("resource.copy")} className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded", copiedId === r.id ? "bg-good-soft text-good" : "text-faint hover:bg-raised hover:text-iris")}>
                          {copiedId === r.id ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      {r.order_id ? <Link href={`/seller/orders/${r.order_id}`} className="font-mono text-[11.5px] text-iris hover:underline">#{r.order_id}</Link> : <span className="text-faint">—</span>}
                    </td>
                    <td className="px-2 py-2 font-mono text-[11px] text-muted whitespace-nowrap" title={formatDateTime(r.created_at, locale)}>{shortDateTime(r.created_at, locale)}</td>
                    <td className="px-2 py-2 font-mono text-[11px] text-muted whitespace-nowrap" title={r.assigned_at ? formatDateTime(r.assigned_at, locale) : undefined}>{shortDateTime(r.assigned_at, locale)}</td>
                    <td className="px-2 py-2 text-right">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setDetail(r); }} aria-label={t("resource.detailTitle")} className="inline-flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-raised hover:text-fg">⋯</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-raised/20 px-3 py-2 text-[12px] text-muted">
          <span>
            {total > 0
              ? t("resource.pager", { from: ((filters.page - 1) * filters.perPage + 1).toLocaleString(locale), to: Math.min(filters.page * filters.perPage, total).toLocaleString(locale), total: total.toLocaleString(locale) })
              : t("resource.pagerEmpty")}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Pagination page={filters.page} totalPages={totalPages} onChange={(page) => patch({ page })} />
            {totalPages > 1 && (
              <form onSubmit={(e) => { e.preventDefault(); const n = Number(jump); if (Number.isInteger(n) && n >= 1 && n <= totalPages) { patch({ page: n }); setJump(""); } }} className="inline-flex items-center gap-1">
                <span>{t("resource.jumpTo")}</span>
                <Input value={jump} onChange={(e) => setJump(e.target.value)} inputMode="numeric" aria-label={t("resource.jumpTo")} className="h-7 w-14 px-1.5 text-center text-xs" />
              </form>
            )}
            <Select value={String(filters.perPage)} onChange={(e) => patch({ perPage: Number(e.target.value) as ResourceFilters["perPage"], page: 1 })} aria-label={t("resource.perPage")} className="h-7 w-24 px-1.5 text-xs">
              {RESOURCE_PAGE_SIZES.map((n) => <option key={n} value={n}>{t("resource.perPageOption", { count: n })}</option>)}
            </Select>
          </span>
        </div>
      </div>

      <ResourceDetailDialog resource={detail} variantId={pkg.variant_id} onClose={() => setDetail(null)} onNotice={onNotice} />
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.action === "restore" ? t("bulk.confirmRestoreTitle", { count: confirm.count.toLocaleString(locale) }) : t("bulk.confirmArchiveTitle", { count: (confirm?.count ?? 0).toLocaleString(locale) })}
        description={confirm?.action === "restore" ? t("bulk.confirmRestoreHint") : t("bulk.confirmArchiveHint")}
        confirmLabel={confirm?.action === "restore" ? t("bulk.restoreShort") : t("bulk.archiveShort")}
        cancelLabel={t("restock.cancel")}
        tone={confirm?.action === "archive" ? "danger" : "primary"}
        pending={bulk.isPending}
        onConfirm={() => void runBulk()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
