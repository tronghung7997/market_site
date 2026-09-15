"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money";
import type {
  InventoryExportColumn, InventoryExportMask, InventoryExportParams, InventoryReportBasis, InventoryReportGroup,
  InventoryReportMetric, InventoryReportParams, InventoryReportRow, InventoryResourceStatus,
} from "@/lib/types";
import { browserTimeZone, DashboardRangePicker, formatIsoDate, percentDelta, type DashboardRangeParams } from "@/features/seller-dashboard";
import { Button, Card, Input, Select } from "@/components/ui";
import { AlertCircle, BarChart, ChevronRight, Download, Eye, Info } from "@/components/Icons";
import {
  buildScopeTree, compactScope, DEFAULT_EXPORT_COLUMNS, DEFAULT_REPORT_METRICS, EXPORT_COLUMNS, EXPORT_MASKS, exportFileName,
  localDayStart, maskSample, REPORT_GROUPS, REPORT_METRICS, RESOURCE_STATUSES, type ExportTab,
} from "../model";
import { useAllInventoryPackages, useInventoryExportPreview, useInventoryReport } from "../useInventory";
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors", active ? "border-iris/25 bg-iris-soft text-iris-hi" : "border-line-2 bg-surface text-muted hover:text-fg")}>
      {children} <span className="text-[10px] opacity-70">{active ? "×" : "+"}</span>
    </button>
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
  const [basis, setBasis] = useState<InventoryReportBasis>("created");
  const [metrics, setMetrics] = useState<InventoryReportMetric[]>(DEFAULT_REPORT_METRICS);
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

  const fmt = (metric: InventoryReportMetric, value: number) => metric === "revenue" ? formatBrowseMoney(value, { locale }) : value.toLocaleString(locale);
  const rowLabel = (r: InventoryReportRow) => {
    if (timeGrouped) return formatIsoDate(r.key, locale);
    return r.label ?? r.key;
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <Section label={t("report.time")}>
          <DashboardRangePicker params={range} resolved={query.data?.range ?? null} onChange={setRange} />
        </Section>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <Section label={t("report.groupBy")}>
              <Seg value={groupBy} options={REPORT_GROUPS} onChange={setGroupBy} label={t("report.groupBy")} render={(g) => t(`report.group.${g}`)} />
            </Section>
            {timeGrouped && (
              <Section label={t("report.basis")}>
                <Seg value={basis} options={["created", "assigned"] as const} onChange={setBasis} label={t("report.basis")} render={(b) => t(`report.basisOption.${b}`)} />
              </Section>
            )}
            <Section label={t("report.metrics")}>
              <div className="flex flex-wrap gap-1.5">
                {REPORT_METRICS.map((m) => (
                  <Chip key={m} active={metrics.includes(m)} onClick={() => setMetrics((prev) => prev.includes(m) ? (prev.length > 1 ? prev.filter((x) => x !== m) : prev) : [...prev, m])}>{t(`report.metric.${m}`)}</Chip>
                ))}
              </div>
            </Section>
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <span className="flex items-center gap-1.5 text-[12px] text-muted"><Info size={13} /> {t("report.noContentNote")}</span>
          <Button size="sm" disabled={!reportParams} onClick={() => reportParams && downloadFile(api.inventoryReportCsvUrl(reportParams))} className="gap-1.5"><Download size={13} /> {t("report.download")}</Button>
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
            <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-line bg-raised/20 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  <th className="px-3 py-2.5">{t(`report.group.${groupBy}`)}</th>
                  {!timeGrouped && groupBy !== "category" && <th className="w-[180px] px-3 py-2.5">{t(groupBy === "variant" ? "report.group.product" : "report.group.category")}</th>}
                  {metrics.map((m) => <th key={m} className="w-[104px] px-3 py-2.5 text-right whitespace-nowrap">{t(`report.metric.${m}`)}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {query.data.rows.length === 0 && (
                  <tr><td colSpan={metrics.length + 2} className="px-3 py-8 text-center text-muted">{t("report.noRows")}</td></tr>
                )}
                {query.data.rows.map((r) => (
                  <tr key={r.key} className="hover:bg-raised/40">
                    <td className="max-w-[320px] truncate px-3 py-2 font-medium text-fg" title={rowLabel(r)}>{rowLabel(r)}</td>
                    {!timeGrouped && groupBy !== "category" && <td className="max-w-[200px] truncate px-3 py-2 text-muted" title={r.sublabel ?? undefined}>{r.sublabel ?? "—"}</td>}
                    {metrics.map((m) => {
                      const delta = showPrev && r.prev ? percentDelta(r[m], r.prev[m]) : null;
                      return (
                        <td key={m} className={cn("px-3 py-2 text-right font-mono tabular whitespace-nowrap", m === "error" && r[m] > 0 ? "text-warn" : "text-fg")}>
                          {fmt(m, r[m])}
                          {showPrev && r.prev && (
                            <span className={cn("ml-1 text-[10.5px]", delta == null ? "text-faint" : delta >= 0 ? "text-good" : "text-bad")}>
                              {delta == null ? (r.prev[m] === 0 && r[m] > 0 ? t("report.new") : "") : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}%`}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {query.data.rows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-line bg-raised/40 font-semibold">
                    <td className="px-3 py-2 text-fg" colSpan={!timeGrouped && groupBy !== "category" ? 2 : 1}>{t("report.total", { count: query.data.rows.length })}</td>
                    {metrics.map((m) => (
                      <td key={m} className="px-3 py-2 text-right font-mono tabular text-fg whitespace-nowrap">
                        {fmt(m, query.data!.totals[m])}
                        {showPrev && query.data!.prev_totals && <span className="ml-1 text-[10.5px] font-normal text-faint">/ {fmt(m, query.data!.prev_totals[m])}</span>}
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
  const exportParams: InventoryExportParams | null = empty ? null : {
    ...scope, statuses, includeArchived, createdFrom: created.from, createdTo: created.to, assignedFrom: assigned.from, assignedTo: assigned.to,
    mask, maskChar, format, columns: format === "txt" ? undefined : columns,
  };
  const preview = useInventoryExportPreview(exportParams, 20);
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
            <div className="flex flex-wrap gap-1.5">
              {EXPORT_COLUMNS.map((c) => (
                <Chip key={c} active={columns.includes(c) && !(mask === "id_only" && c === "data")} onClick={() => { if (mask === "id_only" && c === "data") return; setColumns((prev) => prev.includes(c) ? (prev.length > 1 ? prev.filter((x) => x !== c) : prev) : [...prev, c]); }}>
                  {t(`goods.column.${c}`)}
                </Chip>
              ))}
            </div>
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
                  {preview.data.columns.map((c) => <th key={c} className="px-3 py-2 whitespace-nowrap">{t(`goods.column.${c}`)}</th>)}
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
