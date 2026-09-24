"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { Check, ChevronDown, Clock, Download, ListFilter, RotateCcw, X } from "@/components/Icons";
import type { AnalyticsCompare, BusinessAnalytics, BusinessFilterOptions } from "@/lib/types";
import {
  COMPARE_OPTIONS,
  GRANULARITIES,
  RANGE_GROUPS,
  SEGMENTS,
  SERVICE_LABEL,
  activeFilterCount,
  customRangeError,
  daysBetween,
  formatRangeLabel,
  granularityAllowed,
  localIsoDate,
  sellersCsv,
  seriesCsv,
  type AnalyticsState,
} from "../model";

const RANGE_LABEL: Record<string, string> = Object.fromEntries(
  RANGE_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label])),
);

function Popover({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={reduced ? false : { opacity: 0, y: -4, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? undefined : { opacity: 0, y: -4, scale: 0.985 }}
          transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
          className={cn(
            "absolute left-0 top-[calc(100%+6px)] z-40 origin-top-left rounded-xl border border-line bg-surface p-2 shadow-card-lg",
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Segmented<T extends string>({
  label, value, options, onChange, isDisabled,
}: {
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
  isDisabled?: (v: T) => boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex h-8 items-center rounded-lg border border-line bg-raised/70 p-0.5">
      {options.map((o) => {
        const active = o.key === value;
        const disabled = isDisabled?.(o.key) ?? false;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.key)}
            className={cn(
              "relative z-10 h-full whitespace-nowrap rounded-md px-2.5 text-[12px] font-medium transition-colors duration-150",
              active ? "text-fg" : "text-faint hover:text-fg",
              disabled && "cursor-not-allowed opacity-35 hover:text-faint",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${label}`}
                className="absolute inset-0 -z-10 rounded-md border border-line bg-surface shadow-[0_1px_2px_rgba(16,18,28,.08)]"
                transition={{ type: "spring", stiffness: 520, damping: 38 }}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function FieldSelect({ label, value, onChange, children, active }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; active?: boolean }) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-8 max-w-[220px] cursor-pointer appearance-none truncate rounded-lg border bg-surface pl-2.5 pr-7 text-[12.5px] transition-colors focus:border-iris focus:outline-none",
          active ? "border-iris/50 bg-iris-soft/60 text-iris-hi" : "border-line text-fg hover:border-line-2",
        )}
      >
        {children}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2 text-faint" />
    </label>
  );
}

function DateRangeFields({ from, to, onApply, applyLabel }: { from?: string; to?: string; onApply: (from: string, to: string) => void; applyLabel: string }) {
  const [f, setF] = useState(from ?? "");
  const [t, setT] = useState(to ?? "");
  const error = f || t ? customRangeError(f, t) : null;
  const today = localIsoDate();
  return (
    <div className="space-y-2 p-1">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11.5px] text-faint">
          Từ ngày
          <input type="date" value={f} max={today} onChange={(e) => setF(e.target.value)} className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-[12.5px] text-fg focus:border-iris focus:outline-none" />
        </label>
        <label className="text-[11.5px] text-faint">
          Đến ngày
          <input type="date" value={t} max={today} onChange={(e) => setT(e.target.value)} className="mt-1 h-8 w-full rounded-md border border-line bg-surface px-2 text-[12.5px] text-fg focus:border-iris focus:outline-none" />
        </label>
      </div>
      {error && <p className="text-[11.5px] text-bad">{error}</p>}
      <button
        type="button"
        disabled={!f || !t || !!error}
        onClick={() => onApply(f, t)}
        className="h-8 w-full rounded-md bg-iris text-[12.5px] font-medium text-white transition hover:brightness-110 disabled:opacity-40"
      >
        {applyLabel}
      </button>
    </div>
  );
}

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FilterBar({
  state, update, data, options, fetching,
}: {
  state: AnalyticsState;
  update: (patch: Partial<AnalyticsState>) => void;
  data?: BusinessAnalytics;
  options?: BusinessFilterOptions;
  fetching: boolean;
}) {
  const [periodOpen, setPeriodOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const days = data?.range.days ?? (state.from && state.to ? daysBetween(state.from, state.to) : 30);
  const periodLabel = state.range === "custom" ? "Tuỳ chọn" : RANGE_LABEL[state.range];
  const rangeText = data ? formatRangeLabel(data.range.from_date, data.range.to_date) : "";
  const compareText = data?.range.compare_from_date && data.range.compare_to_date
    ? formatRangeLabel(data.range.compare_from_date, data.range.compare_to_date)
    : null;

  const categoryOptions = useMemo(() => {
    const cats = options?.categories ?? [];
    const children = new Map<number | null, typeof cats>();
    for (const c of cats) children.set(c.parent_id, [...(children.get(c.parent_id) ?? []), c]);
    const out: { id: number; label: string }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const c of children.get(parent) ?? []) {
        out.push({ id: c.id, label: `${"  ".repeat(depth)}${depth ? "└ " : ""}${c.name}` });
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [options?.categories]);

  const filters = activeFilterCount(state);
  const stamp = data ? `${data.range.from_date}_${data.range.to_date}` : "export";

  return (
    <div className="z-30 -mx-4 md:sticky md:top-0 border-b border-line bg-base/85 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        {/* Period */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setPeriodOpen((v) => !v)}
            aria-expanded={periodOpen}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] font-medium text-fg transition-colors hover:border-line-2"
          >
            <Clock size={14} className="text-iris" />
            {periodLabel}
            {rangeText && <span className="hidden font-normal text-faint sm:inline">· {rangeText}</span>}
            <ChevronDown size={13} className={cn("text-faint transition-transform", periodOpen && "rotate-180")} />
          </button>
          <Popover open={periodOpen} onClose={() => setPeriodOpen(false)} className="w-[min(92vw,460px)]">
            <div className="grid gap-1 sm:grid-cols-3">
              {RANGE_GROUPS.map((g) => (
                <div key={g.label}>
                  <p className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-faint">{g.label}</p>
                  {g.items.map((i) => (
                    <button
                      key={i.key}
                      type="button"
                      onClick={() => { update({ range: i.key, from: undefined, to: undefined }); setPeriodOpen(false); }}
                      aria-pressed={state.range === i.key}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-raised",
                        state.range === i.key ? "bg-iris-soft/60 font-semibold text-fg" : "text-muted",
                      )}
                    >
                      <span className="grid w-3.5 shrink-0 place-items-center">{state.range === i.key && <Check size={14} strokeWidth={2.5} className="text-iris" />}</span>
                      {i.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-2 border-t border-line pt-2">
              <p className="px-1 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Khoảng tuỳ chọn</p>
              <DateRangeFields
                from={state.from ?? data?.range.from_date}
                to={state.to ?? data?.range.to_date}
                applyLabel="Áp dụng khoảng này"
                onApply={(from, to) => {
                  const d = daysBetween(from, to);
                  update({
                    range: "custom", from, to,
                    granularity: granularityAllowed(state.granularity, d) ? state.granularity : "auto",
                  });
                  setPeriodOpen(false);
                }}
              />
            </div>
          </Popover>
        </div>

        <Segmented
          label="Đơn vị thời gian"
          value={state.granularity}
          options={GRANULARITIES}
          onChange={(g) => update({ granularity: g })}
          isDisabled={(g) => !granularityAllowed(g, days)}
        />

        {/* Compare */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setCompareOpen((v) => !v)}
            aria-expanded={compareOpen}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] transition-colors",
              state.compare === "none" ? "border-line bg-surface text-faint" : "border-line bg-surface text-fg hover:border-line-2",
            )}
          >
            <span className="text-faint">So với</span>
            <span className="font-medium">{COMPARE_OPTIONS.find((o) => o.key === state.compare)?.label}</span>
            {compareText && <span className="hidden text-faint lg:inline">· {compareText}</span>}
            <ChevronDown size={13} className="text-faint" />
          </button>
          <Popover open={compareOpen} onClose={() => setCompareOpen(false)} className="w-[min(92vw,300px)]">
            {COMPARE_OPTIONS.filter((o) => o.key !== "custom").map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => { update({ compare: o.key as AnalyticsCompare, compareFrom: undefined, compareTo: undefined }); setCompareOpen(false); }}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-raised",
                  state.compare === o.key ? "font-semibold text-fg" : "text-muted",
                )}
              >
                {o.label}
                {state.compare === o.key && <Check size={14} className="text-iris" />}
              </button>
            ))}
            <div className="mt-1 border-t border-line pt-2">
              <p className="px-1 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-faint">So với mốc cụ thể</p>
              <DateRangeFields
                from={state.compareFrom ?? data?.range.compare_from_date ?? undefined}
                to={state.compareTo ?? data?.range.compare_to_date ?? undefined}
                applyLabel="So sánh với kỳ này"
                onApply={(compareFrom, compareTo) => { update({ compare: "custom", compareFrom, compareTo }); setCompareOpen(false); }}
              />
            </div>
          </Popover>
        </div>

        <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-line md:block" />

        <Segmented label="Phân khúc seller" value={state.segment} options={SEGMENTS} onChange={(segment) => update({ segment })} />

        <FieldSelect
          label="Seller"
          value={state.sellerId ? String(state.sellerId) : ""}
          active={!!state.sellerId}
          onChange={(v) => update({ sellerId: v ? Number(v) : undefined })}
        >
          <option value="">Mọi seller</option>
          {(["internal", "external"] as const).map((kind) => {
            const list = (options?.sellers ?? []).filter((s) => s.is_internal === (kind === "internal"));
            if (!list.length) return null;
            return (
              <optgroup key={kind} label={kind === "internal" ? "Seller nội bộ" : "Seller đối tác"}>
                {list.map((s) => <option key={s.id} value={s.id}>{s.name} · #{s.id}</option>)}
              </optgroup>
            );
          })}
        </FieldSelect>

        <FieldSelect
          label="Danh mục"
          value={state.categoryId ? String(state.categoryId) : ""}
          active={!!state.categoryId}
          onChange={(v) => update({ categoryId: v ? Number(v) : undefined })}
        >
          <option value="">Mọi danh mục</option>
          {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </FieldSelect>

        <FieldSelect
          label="Loại dịch vụ"
          value={state.serviceType ?? ""}
          active={!!state.serviceType}
          onChange={(v) => update({ serviceType: v || undefined })}
        >
          <option value="">Mọi loại dịch vụ</option>
          {(options?.service_types ?? []).map((s) => <option key={s} value={s}>{SERVICE_LABEL[s] ?? s}</option>)}
        </FieldSelect>

        <AnimatePresence>
          {filters > 0 && (
            <motion.button
              type="button"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              onClick={() => update({ segment: "all", sellerId: undefined, categoryId: undefined, serviceType: undefined })}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] text-muted hover:bg-raised hover:text-fg"
            >
              <X size={13} /> Bỏ {filters} bộ lọc
            </motion.button>
          )}
        </AnimatePresence>

        <div className="ml-auto flex items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5 text-[11.5px] text-faint transition-opacity", fetching ? "opacity-100" : "opacity-0")} aria-live="polite">
            <RotateCcw size={12} className="animate-spin [animation-direction:reverse]" /> Đang cập nhật
          </span>
          <div className="relative">
            <button
              type="button"
              disabled={!data}
              onClick={() => setExportOpen((v) => !v)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] text-fg transition-colors hover:border-line-2 disabled:opacity-50"
            >
              <Download size={14} /> Xuất CSV
            </button>
            <Popover open={exportOpen} onClose={() => setExportOpen(false)} className="left-auto right-0 w-56 origin-top-right">
              {data && (
                <>
                  <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted hover:bg-raised hover:text-fg"
                    onClick={() => { download(`doanh-so-theo-moc_${stamp}.csv`, seriesCsv(data)); setExportOpen(false); }}>
                    <ListFilter size={14} /> Chỉ số theo từng mốc
                  </button>
                  <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted hover:bg-raised hover:text-fg"
                    onClick={() => { download(`seller_${stamp}.csv`, sellersCsv(data)); setExportOpen(false); }}>
                    <ListFilter size={14} /> Bảng xếp hạng seller
                  </button>
                </>
              )}
            </Popover>
          </div>
        </div>
      </div>
    </div>
  );
}
