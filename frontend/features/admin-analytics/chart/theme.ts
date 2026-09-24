"use client";

import type { EChartsCoreOption } from "echarts/core";

/** Chart colours resolved from the design tokens in globals.css (ECharts
 *  needs concrete colours to derive hover shades and gradients). */
export interface ChartTokens {
  series: string[];
  compare: string;
  seq: string[];
  neg: string;
  mid: string;
  pos: string;
  fg: string;
  muted: string;
  faint: string;
  line: string;
  surface: string;
  good: string;
  warn: string;
  bad: string;
  iris: string;
  font: string;
  mono: string;
}

const FALLBACK: ChartTokens = {
  series: ["#4f46e5", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#2a78d6", "#e34948"],
  compare: "#9aa0ad",
  seq: ["#eef0fe", "#c9ccfa", "#9d9cf2", "#6f66e8", "#3f35c4"],
  neg: "#d24a4a", mid: "#e4e5ea", pos: "#2a78d6",
  fg: "#14161d", muted: "#22242c", faint: "#454954", line: "#e7e8ee", surface: "#ffffff",
  good: "#12925f", warn: "#b07814", bad: "#cf4444", iris: "#4f46e5",
  font: "system-ui, sans-serif", mono: "ui-monospace, monospace",
};

let cached: ChartTokens | null = null;

export function chartTokens(): ChartTokens {
  if (cached) return cached;
  if (typeof window === "undefined") return FALLBACK;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  cached = {
    series: FALLBACK.series.map((c, i) => v(`--color-chart-${i + 1}`, c)),
    compare: v("--color-chart-compare", FALLBACK.compare),
    seq: FALLBACK.seq.map((c, i) => v(`--color-chart-seq-${i + 1}`, c)),
    neg: v("--color-chart-neg", FALLBACK.neg),
    mid: v("--color-chart-mid", FALLBACK.mid),
    pos: v("--color-chart-pos", FALLBACK.pos),
    fg: v("--color-fg", FALLBACK.fg),
    muted: v("--color-muted", FALLBACK.muted),
    faint: v("--color-faint", FALLBACK.faint),
    line: v("--color-line", FALLBACK.line),
    surface: v("--color-surface", FALLBACK.surface),
    good: v("--color-good", FALLBACK.good),
    warn: v("--color-warn", FALLBACK.warn),
    bad: v("--color-bad", FALLBACK.bad),
    iris: v("--color-iris", FALLBACK.iris),
    font: getComputedStyle(document.body).fontFamily || FALLBACK.font,
    mono: v("--font-mono", FALLBACK.mono),
  };
  return cached;
}

/** Series identity is fixed per entity — never by rank. */
export const SERIES_SLOT = {
  external: 0,
  internal: 1,
  fee: 0,
  internalSales: 1,
  affiliate: 4,
  newBuyers: 2,
  returning: 0,
  deposits: 2,
  withdrawals: 1,
} as const;

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Tooltip row: short line key in the series colour, value first. */
export function tipRow(color: string, label: string, value: string, extra = ""): string {
  return `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">`
    + `<span style="width:10px;height:2px;border-radius:2px;background:${color};flex:none"></span>`
    + `<span style="font-weight:600;font-variant-numeric:tabular-nums">${esc(value)}</span>`
    + `<span style="opacity:.72">${esc(label)}</span>${extra}</div>`;
}

export function tipTitle(text: string): string {
  return `<div style="font-weight:600;margin-bottom:2px">${esc(text)}</div>`;
}

/** Shared chrome: hairline grid, recessive axes, one tooltip style. */
export function baseOption(t: ChartTokens): EChartsCoreOption {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: t.font, color: t.faint, fontSize: 11 },
    animationDuration: 650,
    animationEasing: "cubicOut",
    animationDurationUpdate: 450,
    animationEasingUpdate: "cubicInOut",
    aria: { enabled: true, decal: { show: false } },
    tooltip: {
      confine: true,
      backgroundColor: t.surface,
      borderColor: t.line,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.fg, fontSize: 12, fontFamily: t.font },
      extraCssText: "border-radius:10px;box-shadow:0 12px 32px -12px rgba(16,18,28,.25);",
    },
    grid: { left: 8, right: 12, top: 16, bottom: 4, containLabel: true },
  };
}

export function axisCategory(t: ChartTokens, labels: string[], extra: Record<string, unknown> = {}) {
  return {
    type: "category",
    data: labels,
    axisLine: { lineStyle: { color: t.line } },
    axisTick: { show: false },
    axisLabel: { color: t.faint, fontSize: 11, hideOverlap: true },
    ...extra,
  };
}

export function axisValue(t: ChartTokens, formatter: (v: number) => string, extra: Record<string, unknown> = {}) {
  return {
    type: "value",
    splitLine: { lineStyle: { color: t.line, type: "solid" } },
    axisLabel: { color: t.faint, fontSize: 11, formatter },
    ...extra,
  };
}
