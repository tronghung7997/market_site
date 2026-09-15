"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { useMoney } from "@/lib/money";
import type {
  InventoryExportColumn, InventoryExportMask, InventoryExportParams, InventoryReportBasis, InventoryReportGroup,
  InventoryReportMetric, InventoryReportParams, InventoryReportRow, InventoryResourceStatus,
} from "@/lib/types";
import { browserTimeZone, DashboardRangePicker, formatIsoDate, percentDelta, type DashboardRangeParams } from "@/features/seller-dashboard";
import { Button, Card, Input, Select } from "@/components/ui";
import { AlertCircle, BarChart, ChevronRight, Download, Eye, Info } from "@/components/Icons";
import {
  buildCsv, buildScopeTree, compactScope, DEFAULT_EXPORT_COLUMNS, DEFAULT_REPORT_METRICS, defaultReportColumns,
  downloadTextFile, EXPORT_COLUMNS, EXPORT_MASKS, exportFileName, groupReportRows, isMetricColumn, localDayStart,
  maskSample, REPORT_GROUPS, reportColumnsFor, reportGroupingsFor, RESOURCE_STATUSES,
  type ExportTab, type ReportColumn, type ReportGrouping,
} from "../model";
import { useAllInventoryPackages, useInventoryExportPreview, useInventoryReport } from "../useInventory";
import { ColumnPicker } from "./ColumnPicker";
import { ScopeTree } from "./ScopeTree";

export interface ExportPageParams {
  tab: ExportTab;
  variantIds: number[];
  status: InventoryResourceStatus | null;
  archived: boolean;
}

export function parseExportParams(search: URLSearchParams): ExportPageParams {
  const ids = (search.get("variants") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const status = search.get("status");
  return {
    tab: search.get("tab") === "goods" ? "goods" : "report",
    variantIds: ids,
    status: status && (RESOURCE_STATUSES as string[]).includes(status) ? (status as InventoryResourceStatus) : null,
    archived: search.get("archived") === "1",
  };
}

function Section({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">{label}</span>
      {children}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange, label, render }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string; render: (v: T) => string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5">
      {options.map((opt) => (
        <button key={opt} type="button" role="tab" aria-selected={value === opt} onClick={() => onChange(opt)} className={cn("h-7 rounded-md px-3 text-[12px] font-medium transition-colors", value === opt ? "bg-surface text-fg font-semibold shadow-xs" : "text-muted hover:text-fg")}>
          {render(opt)}
        </button>
      ))}
    </div>
  );
}

function downloadFile(href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function ExportPageSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true">
      <div className="h-3.5 w-48 rounded bg-raised" />
      <div className="h-7 w-72 rounded bg-raised" />
      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]"><div className="h-[520px] rounded-xl border border-line bg-raised" /><div className="h-[520px] rounded-xl border border-line bg-raised" /></div>
    </div>
  );
}

export function ExportPage({ params, onTabChange }: { params: ExportPageParams; onTabChange: (tab: ExportTab) => void }) {
  const t = useTranslations("sellerInventory");
  const apiErrorMessage = useApiErrorMessage();
  const all = useAllInventoryPackages();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [seeded, setSeeded] = useState(false);
  const tree = useMemo(() => buildScopeTree(all.data?.items ?? []), [all.data]);

  // Seed the selection once packages arrive: deep-linked ids, else everything active.
  useEffect(() => {
    if (!all.data || seeded) return;
    const active = all.data.items.filter((p) => p.is_active).map((p) => p.variant_id);
    if (params.variantIds.length > 0) {
      const wanted = new Set(params.variantIds);
      const hit = all.data.items.filter((p) => wanted.has(p.variant_id));
      if (hit.some((p) => !p.is_active)) setIncludeInactive(true);
      setSelected(new Set(hit.map((p) => p.variant_id)));
    } else {
      setSelected(new Set(active));
    }
    setSeeded(true);
  }, [all.data, params.variantIds, seeded]);

  const onIncludeInactive = (next: boolean) => {
    setIncludeInactive(next);
    if (!next && all.data) {
      const inactive = new Set(all.data.items.filter((p) => !p.is_active).map((p) => p.variant_id));
      setSelected((prev) => new Set([...prev].filter((id) => !inactive.has(id))));
    }
  };

  const scope = useMemo(() => compactScope(tree, selected, includeInactive), [tree, selected, includeInactive]);
  const selectedPackages = useMemo(() => (all.data?.items ?? []).filter((p) => selected.has(p.variant_id)), [all.data, selected]);

  if (all.isPending) return <ExportPageSkeleton />;
  if (all.isError) {
    return (
      <Card className="p-10 text-center">
        <AlertCircle size={32} className="mx-auto mb-2 text-bad" />
        <p className="mb-3 text-[12.5px] text-muted">{apiErrorMessage(all.error, t("loadFailed"))}</p>
        <Button size="sm" variant="secondary" onClick={() => void all.refetch()}>{t("retry")}</Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4 animate-fade">
      <nav aria-label="breadcrumb" className="flex items-center gap-1.5 text-[12px] text-muted">
        <Link href="/seller/inventory" className="text-iris hover:underline">{t("title")}</Link>
        <ChevronRight size={12} className="text-faint" />
        <span className="text-fg">{t("export.title")}</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[18px] font-bold tracking-tight text-fg">{t("export.title")}</h1>
        <div role="tablist" aria-label={t("export.tabsLabel")} className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5">
          {(["report", "goods"] as const).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={params.tab === tab} onClick={() => onTabChange(tab)} className={cn("flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors", params.tab === tab ? "bg-surface text-fg font-semibold shadow-xs" : "text-muted hover:text-fg")}>
              {tab === "report" ? <BarChart size={13} /> : <Download size={13} />} {t(`export.tab.${tab}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <ScopeTree tree={tree} selected={selected} onChange={setSelected} includeInactive={includeInactive} onIncludeInactive={onIncludeInactive} />
        {params.tab === "report"
          ? <ReportTab scope={scope} packages={selectedPackages.length} threshold={all.data.lowStockThreshold} />
          : <GoodsTab scope={scope} packages={selectedPackages} initialStatus={params.status} initialArchived={params.archived} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report tab
// ---------------------------------------------------------------------------

function ReportTab({ scope, packages, threshold }: { scope: ReturnType<typeof compactScope>; packages: number; threshold: number }) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const { formatBrowseMoney } = useMoney();
  const [range, setRange] = useState<DashboardRangeParams>({ range: "this_month" });
  const [groupBy, setGroupBy] = useState<InventoryReportGroup>("variant");
  const [grouping, setGrouping] = useState<ReportGrouping>("none");
  const [basis, setBasis] = useState<InventoryReportBasis>("created");
  const [columns, setColumns] = useState<ReportColumn[]>(() => defaultReportColumns("variant"));
  const [compare, setCompare] = useState(true);
  const [lowOnly, setLowOnly] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [noActivity, setNoActivity] = useState(false);
  const empty = packages === 0;
  const reportParams: InventoryReportParams | null = empty ? null : {
    ...scope, range: range.range, from: range.from, to: range.to, tz: browserTimeZone(),
    groupBy, basis, compare, lowOnly, hasError, noActivity,
  };
  const query = useInventoryReport(reportParams);
  const timeGrouped = groupBy === "day" || groupBy === "week";
  const showPrev = compare && !timeGrouped && Boolean(query.data?.prev_totals);
  const metrics = columns.filter(isMetricColumn);
  const blocks = useMemo(() => groupReportRows(query.data?.rows ?? [], grouping), [query.data, grouping]);
  const grouped = grouping !== "none";

  const changeGroupBy = (next: InventoryReportGroup) => {
    setGroupBy(next);
    setGrouping("none");
    // Keep the seller's metric choice; swap the entity columns for the new grouping.
    const keptMetrics = columns.filter(isMetricColumn);
    const base = defaultReportColumns(next).filter((c) => !isMetricColumn(c));
    setColumns([...base, ...(keptMetrics.length ? keptMetrics : DEFAULT_REPORT_METRICS)]);
  };

  const columnLabel = (c: ReportColumn): string => {
    if (c === "index") return t("columns.index");
    if (c === "label") return t(`report.group.${groupBy}`);
    if (c === "product") return t("report.group.product");
    if (c === "category") return t("report.group.category");
    return t(`report.metric.${c}`);
  };
  const fmt = (metric: InventoryReportMetric, value: number) => metric === "revenue" ? formatBrowseMoney(value, { locale }) : value.toLocaleString(locale);
  const rowLabel = (r: InventoryReportRow) => (timeGrouped ? formatIsoDate(r.key, locale) : (r.label ?? r.key));
  const cellText = (c: ReportColumn, r: InventoryReportRow, index: number): string | number => {
    if (c === "index") return index;
    if (c === "label") return rowLabel(r);
    if (c === "product") return r.product_title ?? "";
    if (c === "category") return r.category_name ?? "";
    return r[c];
  };

  const downloadCsv = () => {
    if (!query.data) return;
    const header = columns.map(columnLabel);
    if (showPrev) for (const m of metrics) header.push(t("report.prevColumn", { metric: t(`report.metric.${m}`) }));
    const lines: (string | number | null)[][] = [header];
    let index = 0;
    const pushTotals = (label: string, totals: Record<InventoryReportMetric, number>, prev?: Record<InventoryReportMetric, number> | null) => {
      const line = columns.map((c) => (c === "label" ? label : isMetricColumn(c) ? totals[c] : ""));
      if (showPrev) for (const m of metrics) line.push(prev ? prev[m] : "");
      lines.push(line);
    };
    for (const block of blocks) {
      if (grouped) pushTotals(`▸ ${block.label} (${t("report.groupSize", { count: block.rows.length })})`, block.totals);
      for (const r of block.rows) {
        index += 1;
        const line = columns.map((c) => cellText(c, r, index));
        if (showPrev) for (const m of metrics) line.push(r.prev ? r.prev[m] : "");
        lines.push(line);
      }
    }
    pushTotals(t("report.total", { count: query.data.rows.length }), query.data.totals, query.data.prev_totals);
    downloadTextFile(exportFileName("report", query.data.packages, query.data.range.from_date, query.data.range.to_date), buildCsv(lines));
  };

  const groupingOptions = reportGroupingsFor(groupBy);
  let runningIndex = 0;

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <Section label={t("report.time")}>
          <DashboardRangePicker params={range} resolved={query.data?.range ?? null} onChange={setRange} />
        </Section>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <Section label={t("report.groupBy")}>
              <Seg value={groupBy} options={REPORT_GROUPS} onChange={changeGroupBy} label={t("report.groupBy")} render={(g) => t(`report.group.${g}`)} />
            </Section>
            {groupingOptions.length > 1 && (
              <Section label={t("report.subgroup")}>
                <Seg value={grouping} options={groupingOptions} onChange={setGrouping} label={t("report.subgroup")} render={(g) => t(`report.subgroupOption.${g}`)} />
              </Section>
            )}
            {timeGrouped && (
              <Section label={t("report.basis")}>
                <Seg value={basis} options={["created", "assigned"] as const} onChange={setBasis} label={t("report.basis")} render={(b) => t(`report.basisOption.${b}`)} />
              </Section>
            )}
          </div>
          <div className="space-y-3">
            <Section label={t("report.filters")}>
              <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={compare} disabled={timeGrouped} onChange={(e) => setCompare(e.target.checked)} className="h-3.5 w-3.5 rounded border-line-2 text-iris" /> {t("report.compare")}</label>
              <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={lowOnly} disabled={timeGrouped} onChange={(e) => setLowOnly(e.target.checked)} className="h-3.5 w-3.5 rounded border-line-2 text-iris" /> {t("report.lowOnly", { threshold })}</label>
              <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={hasError} disabled={timeGrouped} onChange={(e) => setHasError(e.target.checked)} className="h-3.5 w-3.5 rounded border-line-2 text-iris" /> {t("report.hasError")}</label>
              <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={noActivity} disabled={timeGrouped} onChange={(e) => setNoActivity(e.target.checked)} className="h-3.5 w-3.5 rounded border-line-2 text-iris" /> {t("report.noActivity")} <span className="text-[11px] text-faint">{t("report.noActivityHint")}</span></label>
            </Section>
          </div>
        </div>
        <Section label={t("report.columns")}>
          <ColumnPicker
            active={columns}
            available={reportColumnsFor(groupBy)}
            label={t("report.columns")}
            render={columnLabel}
            onChange={(next) => setColumns(next.some(isMetricColumn) ? next : columns)}
            locked={["label"]}
          />
        </Section>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <span className="flex items-center gap-1.5 text-[12px] text-muted"><Info size={13} /> {t("report.noContentNote")}</span>
          <Button size="sm" disabled={!query.data || query.data.rows.length === 0} onClick={downloadCsv} className="gap-1.5"><Download size={13} /> {t("report.download")}</Button>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-raised/40 px-4 py-2.5 text-[12px]">
          <span className="font-semibold text-fg">
            {query.data ? t("report.previewTitle", { packages: query.data.packages, from: formatIsoDate(query.data.range.from_date, locale), to: formatIsoDate(query.data.range.to_date, locale) }) : t("report.preview")}
          </span>
          {query.data && <span className="font-mono text-[11px] text-faint">{exportFileName("report", query.data.packages, query.data.range.from_date, query.data.range.to_date)}</span>}
        </div>
        {empty ? (
          <p className="p-8 text-center text-[12.5px] text-muted">{t("export.noScope")}</p>
        ) : query.isPending ? (
          <div className="animate-pulse space-y-2 p-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-5 rounded bg-raised" />)}</div>
        ) : query.isError ? (
          <div className="p-8 text-center text-[12.5px] text-bad">{apiErrorMessage(query.error, t("loadFailed"))}</div>
        ) : (
          <div className={cn("overflow-x-auto", query.isFetching && "opacity-70")}>
            <table className="w-full table-fixed border-collapse text-left text-[12px]" style={{ minWidth: columns.reduce((w, c) => w + (c === "index" ? 52 : c === "label" ? 240 : isMetricColumn(c) ? 110 : 170), 0) }}>
              <thead>
                <tr className="border-b border-line bg-raised/20 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  {columns.map((c) => (
                    <th key={c} className={cn("px-3 py-2.5 whitespace-nowrap", c === "index" && "w-[52px]", c === "label" && "w-[240px]", isMetricColumn(c) && "w-[110px] text-right", (c === "product" || c === "category") && "w-[170px]")}>{columnLabel(c)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {query.data.rows.length === 0 && (
                  <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-muted">{t("report.noRows")}</td></tr>
                )}
                {blocks.flatMap((block) => [
                  ...(grouped ? [(
                    <tr key={`g-${block.key}`} className="bg-raised/60">
                      {columns.map((c) => (
                        <td key={c} className={cn("px-3 py-2 font-semibold text-fg whitespace-nowrap", isMetricColumn(c) && "text-right font-mono tabular")}>
                          {c === "label" ? <>{block.label} <span className="font-normal text-faint">· {t("report.groupSize", { count: block.rows.length })}</span></> : isMetricColumn(c) ? fmt(c, block.totals[c]) : ""}
                        </td>
                      ))}
                    </tr>
                  )] : []),
                  ...block.rows.map((r) => {
                    runningIndex += 1;
                    const index = runningIndex;
                    return (
                      <tr key={r.key} className="hover:bg-raised/40">
                        {columns.map((c) => {
                          if (isMetricColumn(c)) {
                            const delta = showPrev && r.prev ? percentDelta(r[c], r.prev[c]) : null;
                            return (
                              <td key={c} className={cn("px-3 py-2 text-right font-mono tabular whitespace-nowrap", c === "error" && r[c] > 0 ? "text-warn" : "text-fg")}>
                                {fmt(c, r[c])}
                                {showPrev && r.prev && (
                                  <span className={cn("ml-1 text-[10.5px]", delta == null ? "text-faint" : delta >= 0 ? "text-good" : "text-bad")}>
                                    {delta == null ? (r.prev[c] === 0 && r[c] > 0 ? t("report.new") : "") : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}%`}
                                  </span>
                                )}
                              </td>
                            );
                          }
                          const text = String(cellText(c, r, index));
                          return (
                            <td key={c} className={cn("truncate px-3 py-2", c === "index" ? "font-mono text-faint" : c === "label" ? "font-medium text-fg" : "text-muted", grouped && c === "label" && "pl-6")} title={text}>{text}</td>
                          );
                        })}
                      </tr>
                    );
                  }),
                ])}
              </tbody>
              {query.data.rows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-line bg-raised/40 font-semibold">
                    {columns.map((c) => (
                      <td key={c} className={cn("px-3 py-2 text-fg whitespace-nowrap", isMetricColumn(c) && "text-right font-mono tabular")}>
                        {c === "label" ? t("report.total", { count: query.data!.rows.length })
                          : isMetricColumn(c) ? <>{fmt(c, query.data!.totals[c])}{showPrev && query.data!.prev_totals && <span className="ml-1 text-[10.5px] font-normal text-faint">/ {fmt(c, query.data!.prev_totals[c])}</span>}</>
                          : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
// ---------------------------------------------------------------------------
// Goods tab
// ---------------------------------------------------------------------------

type GoodsDatePreset = "all" | "7d" | "30d" | "90d" | "custom";

function goodsBounds(preset: GoodsDatePreset, from: string, to: string): { from?: string; to?: string } {
  if (preset === "all") return {};
  if (preset === "custom") return from && to ? { from: localDayStart(from), to: localDayStart(to, 1) } : {};
  const days = { "7d": 7, "30d": 30, "90d": 90 }[preset];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return { from: start.toISOString() };
}

function GoodsTab({ scope, packages, initialStatus, initialArchived }: {
  scope: ReturnType<typeof compactScope>;
  packages: { available: number; assigned: number; error: number; expired: number; archived: number }[];
  initialStatus: InventoryResourceStatus | null;
  initialArchived: boolean;
}) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const apiErrorMessage = useApiErrorMessage();
  const [statuses, setStatuses] = useState<InventoryResourceStatus[]>(initialStatus ? [initialStatus] : ["available"]);
  const [includeArchived, setIncludeArchived] = useState(initialArchived);
  const [createdPreset, setCreatedPreset] = useState<GoodsDatePreset>("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [assignedPreset, setAssignedPreset] = useState<GoodsDatePreset>("all");
  const [assignedFrom, setAssignedFrom] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [mask, setMask] = useState<InventoryExportMask>("middle");
  const [maskChar, setMaskChar] = useState("•");
  const [format, setFormat] = useState<"csv" | "txt">("csv");
  const [columns, setColumns] = useState<InventoryExportColumn[]>(DEFAULT_EXPORT_COLUMNS);

  const counts = packages.reduce((acc, p) => ({
    available: acc.available + p.available, assigned: acc.assigned + p.assigned, error: acc.error + p.error, expired: acc.expired + p.expired, archived: acc.archived + p.archived,
  }), { available: 0, assigned: 0, error: 0, expired: 0, archived: 0 });
  const created = goodsBounds(createdPreset, createdFrom, createdTo);
  const assigned = goodsBounds(assignedPreset, assignedFrom, assignedTo);
  const empty = packages.length === 0;
  const exportColumns = mask === "id_only" ? columns.filter((c) => c !== "data") : columns;
  const exportParams: InventoryExportParams | null = empty ? null : {
    ...scope, statuses, includeArchived, createdFrom: created.from, createdTo: created.to, assignedFrom: assigned.from, assignedTo: assigned.to,
    mask, maskChar, format, columns: format === "txt" ? undefined : exportColumns, locale,
  };
  // Debounced so a burst of column reorders costs one preview request, not one per click.
  const debouncedParams = useDebounce(exportParams, 350);
  const preview = useInventoryExportPreview(debouncedParams, 20);
  const sample = "clone.vn.2019.0412|Pw#4a8Lk!|GH5T-LQ2A-9F0K|mail4412@hotmail.com";
  const overLimit = preview.data ? preview.data.total > preview.data.row_limit : false;

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Section label={t("goods.statuses")}>
            {RESOURCE_STATUSES.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-1.5 text-[12.5px]">
                <input type="checkbox" checked={statuses.includes(s)} onChange={(e) => setStatuses((prev) => e.target.checked ? [...prev, s] : prev.filter((x) => x !== s))} className="h-3.5 w-3.5 rounded border-line-2 text-iris" />
                {t(`resource.tab.${s}`)} <span className="font-mono text-[11px] text-faint">{counts[s].toLocaleString(locale)}</span>
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px]">
              <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} className="h-3.5 w-3.5 rounded border-line-2 text-iris" />
              {t("goods.includeArchived")} <span className="font-mono text-[11px] text-faint">{counts.archived.toLocaleString(locale)}</span>
            </label>
          </Section>
          <Section label={t("goods.time")}>
            <DateRow label={t("goods.createdAt")} preset={createdPreset} from={createdFrom} to={createdTo} onPreset={setCreatedPreset} onFrom={setCreatedFrom} onTo={setCreatedTo} />
            <DateRow label={t("goods.assignedAt")} preset={assignedPreset} from={assignedFrom} to={assignedTo} onPreset={setAssignedPreset} onFrom={setAssignedFrom} onTo={setAssignedTo} />
          </Section>
        </div>

        <Section label={t("goods.mask")}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {EXPORT_MASKS.map((m) => (
              <label key={m} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-[12.5px]", mask === m ? "border-iris bg-iris-soft/40" : "border-line bg-surface hover:border-line-2")}>
                <input type="radio" name="export-mask" checked={mask === m} onChange={() => setMask(m)} className="mt-0.5 h-3.5 w-3.5 border-line-2 text-iris" />
                <span className="flex flex-col gap-0.5"><span className="font-medium text-fg">{t(`goods.maskOption.${m}`)}</span><span className="text-[11px] text-faint">{t(`goods.maskHint.${m}`)}</span></span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-faint">{t("goods.example")}</span>
            <code className="rounded-md bg-raised px-2 py-1 font-mono text-[11.5px] text-fg">{maskSample(sample, mask, maskChar) || t("goods.noContent")}</code>
            {mask !== "none" && mask !== "id_only" && (
              <>
                <span className="text-faint">{t("goods.maskChar")}</span>
                <Select value={maskChar} onChange={(e) => setMaskChar(e.target.value)} aria-label={t("goods.maskChar")} className="h-7 w-16 px-1.5 text-center text-xs">
                  {["•", "*", "#", "x"].map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </>
            )}
          </div>
        </Section>

        <Section label={t("goods.formatColumns")}>
          <div className="flex flex-wrap items-center gap-3">
            <Seg value={format} options={["txt", "csv"] as const} onChange={setFormat} label={t("goods.format")} render={(f) => t(`goods.formatOption.${f}`)} />
          </div>
          {format === "csv" && (
            <ColumnPicker
              active={exportColumns}
              available={mask === "id_only" ? EXPORT_COLUMNS.filter((c) => c !== "data") : EXPORT_COLUMNS}
              label={t("goods.formatColumns")}
              render={(c) => t(`goods.column.${c}`)}
              onChange={(next) => setColumns(next.length ? next : columns)}
            />
          )}
        </Section>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <span className="text-[12.5px] text-fg">
            {preview.data ? (
              <>
                ≈ <b className="font-mono">{preview.data.total.toLocaleString(locale)}</b> {t("goods.rows")} · {t("goods.packages", { count: preview.data.packages })}
                <span className="text-faint"> · {t("goods.limit", { limit: preview.data.row_limit.toLocaleString(locale) })}</span>
              </>
            ) : <span className="text-muted">{t("goods.estimating")}</span>}
          </span>
          <Button size="sm" disabled={!exportParams || statuses.length === 0 || !preview.data || preview.data.total === 0} onClick={() => exportParams && downloadFile(api.inventoryExportUrl(exportParams))} className="gap-1.5">
            <Download size={13} /> {t("goods.download")}
          </Button>
        </div>
        {overLimit && (
          <p className="flex items-center gap-1.5 text-[12px] text-warn"><AlertCircle size={13} /> {t("goods.overLimit", { limit: preview.data!.row_limit.toLocaleString(locale) })}</p>
        )}
        {statuses.length === 0 && <p className="text-[12px] text-warn">{t("goods.pickStatus")}</p>}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-raised/40 px-4 py-2.5 text-[12px]">
          <span className="flex items-center gap-1.5 font-semibold text-fg"><Eye size={13} /> {t("goods.previewTitle")}</span>
          {preview.data && <span className="font-mono text-[11px] text-faint">{exportFileName("goods", preview.data.packages, undefined, undefined, format)}</span>}
        </div>
        {empty ? (
          <p className="p-8 text-center text-[12.5px] text-muted">{t("export.noScope")}</p>
        ) : preview.isPending ? (
          <div className="animate-pulse space-y-2 p-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-5 rounded bg-raised" />)}</div>
        ) : preview.isError ? (
          <div className="p-8 text-center text-[12.5px] text-bad">{apiErrorMessage(preview.error, t("loadFailed"))}</div>
        ) : preview.data.rows.length === 0 ? (
          <p className="p-8 text-center text-[12.5px] text-muted">{t("goods.previewEmpty")}</p>
        ) : (
          <div className={cn("overflow-x-auto", preview.isFetching && "opacity-70")}>
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-line bg-raised/20 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  {preview.data.columns.map((c) => <th key={c} className="px-3 py-2 whitespace-nowrap">{preview.data!.headers[c] ?? t(`goods.column.${c}`)}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.data.rows.map((row, i) => (
                  <tr key={i}>
                    {preview.data!.columns.map((c) => (
                      <td key={c} className={cn("max-w-[360px] truncate px-3 py-1.5 font-mono text-[11.5px]", c === "data" ? "text-fg" : "text-muted")} title={String(row[c] ?? "")}>{String(row[c] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function DateRow({ label, preset, from, to, onPreset, onFrom, onTo }: {
  label: string; preset: GoodsDatePreset; from: string; to: string;
  onPreset: (p: GoodsDatePreset) => void; onFrom: (v: string) => void; onTo: (v: string) => void;
}) {
  const t = useTranslations("sellerInventory");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-[12px] text-muted">{label}</span>
      <Select value={preset} onChange={(e) => onPreset(e.target.value as GoodsDatePreset)} aria-label={label} className="h-8 w-36 text-xs">
        {(["all", "7d", "30d", "90d", "custom"] as const).map((p) => <option key={p} value={p}>{t(`resource.date.${p}`)}</option>)}
      </Select>
      {preset === "custom" && (
        <span className="inline-flex items-center gap-1">
          <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)} aria-label={t("resource.from")} className="h-8 w-auto text-xs" />
          <span className="text-faint">→</span>
          <Input type="date" value={to} onChange={(e) => onTo(e.target.value)} aria-label={t("resource.to")} className="h-8 w-auto text-xs" />
        </span>
      )}
    </div>
  );
}
