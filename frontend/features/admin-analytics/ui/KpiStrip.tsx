"use client";

import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { Info } from "@/components/Icons";
import type { BusinessAnalytics } from "@/lib/types";
import { METRIC, delta, formatMetric, type MetricDef, type MetricKey } from "../model";
import { chartTokens } from "../chart/theme";
import { DeltaBadge } from "./Panel";

/** Counts from the previous value to the next one — the change is the story. */
export function AnimatedNumber({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(value);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = last.current;
    last.current = value;
    if (reduced || from === value) {
      el.textContent = format(value);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.6,
      ease: [0.22, 0.61, 0.36, 1],
      onUpdate: (v) => { el.textContent = format(v); },
    });
    return () => controls.stop();
  }, [value, format, reduced]);
  return <span ref={ref} className={className}>{format(value)}</span>;
}

function Sparkline({ values, compare, def }: { values: number[]; compare: number[]; def: MetricDef }) {
  const t = chartTokens();
  const w = 120;
  const h = 32;
  const all = [...values, ...compare];
  const max = Math.max(...all, def.kind === "rate" ? 0.0001 : 1);
  const min = Math.min(0, ...all);
  const x = (i: number, n: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => h - 2 - ((v - min) / (max - min || 1)) * (h - 4);
  const path = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i, vs.length).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  if (values.length < 2) return <div className="h-8" />;
  const area = `${path(values)} L${w},${h} L0,${h} Z`;
  const gid = `spark-${def.key}`;
  const clip = `spark-clip-${def.key}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-8 w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={t.iris} stopOpacity="0.18" />
          <stop offset="100%" stopColor={t.iris} stopOpacity="0" />
        </linearGradient>
        <clipPath id={clip}><rect x="0" y="-4" width={w} height={h + 8} className="spark-reveal" /></clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
      {compare.length > 1 && <path d={path(compare.slice(0, values.length))} fill="none" stroke={t.compare} strokeWidth="1.25" vectorEffect="non-scaling-stroke" />}
      <path d={area} fill={`url(#${gid})`} />
      <path d={path(values)} fill="none" stroke={t.iris} strokeWidth="1.75" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

const KPIS: MetricKey[] = ["gmv", "platform_revenue", "paid_orders", "aov", "buyers", "take_rate", "refund_rate", "dispute_rate"];

export function KpiStrip({
  data, active, onSelect,
}: {
  data: BusinessAnalytics;
  active: MetricKey;
  onSelect: (m: MetricKey) => void;
}) {
  const prev = data.compare_totals;
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 2xl:grid-cols-8">
      {KPIS.map((key) => {
        const def = METRIC[key];
        const value = def.value(data.totals);
        const d = prev ? delta(value, def.value(prev), def.better) : null;
        const selected = key === active;
        const sub = key === "buyers"
          ? `${data.totals.new_buyers.toLocaleString("vi-VN")} mới`
          : key === "platform_revenue"
            ? `phí ${formatMetric(METRIC.platform_fee, data.totals.platform_fee, true)} · nội bộ ${formatMetric(METRIC.internal_sales, data.totals.internal_sales, true)}`
            : key === "paid_orders"
              ? `${data.totals.orders.toLocaleString("vi-VN")} đơn tạo`
              : prev ? `kỳ trước ${formatMetric(def, def.value(prev), true)}` : "";
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-pressed={selected}
            title={def.hint}
            className={cn(
              "group relative flex min-w-0 flex-col rounded-card border bg-card p-3 text-left transition-[border-color,box-shadow,transform] duration-200",
              "hover:-translate-y-px hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/40",
              selected ? "border-iris/60 shadow-card ring-1 ring-iris/20" : "border-line",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1 truncate text-[11.5px] font-medium text-faint">
                {def.label}
                <Info size={11} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
              </span>
              <DeltaBadge def={def} d={d} />
            </span>
            <AnimatedNumber
              value={value}
              format={(v) => formatMetric(def, v, def.kind === "money")}
              className="mt-1.5 truncate text-[19px] font-semibold leading-tight text-fg"
            />
            <span className="mt-0.5 truncate text-[11px] text-faint">{sub || " "}</span>
            <div className="mt-1.5">
              <Sparkline
                def={def}
                values={data.series.map((p) => def.value(p))}
                compare={data.compare_series.map((p) => def.value(p))}
              />
            </div>
            {selected && <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-iris" />}
          </button>
        );
      })}
    </div>
  );
}
