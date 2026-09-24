"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ArrowLeftRight } from "@/components/Icons";
import type { BusinessAnalytics, BusinessPoint } from "@/lib/types";
import { EChart } from "../chart/EChart";
import { baseOption, chartTokens, tipRow, tipTitle } from "../chart/theme";
import {
  METRIC, MILESTONE_METRICS, bucketTitle, delta, formatDelta, formatMetric, milestoneRows, type MetricKey,
} from "../model";
import { DeltaBadge, Panel } from "./Panel";

type Basis = "prev_bucket" | "compare";

/** Every bucket as a row: value + change vs the bucket before (MoM/QoQ/YoY
 *  depending on the unit) or vs the aligned bucket of the comparison period. */
function MilestoneTable({ data }: { data: BusinessAnalytics }) {
  const [basis, setBasis] = useState<Basis>("prev_bucket");
  const rows = useMemo(() => milestoneRows(data).reverse(), [data]);
  const g = data.range.granularity;
  const unit = { day: "ngày", week: "tuần", month: "tháng", quarter: "quý", year: "năm" }[g];
  const hasCompare = data.compare_series.length > 0;
  // Heat tint per column so the best/worst periods pop without reading numbers.
  const extremes = useMemo(() => Object.fromEntries(MILESTONE_METRICS.map((k) => {
    const vs = rows.map((r) => r.values[k]);
    return [k, [Math.min(...vs), Math.max(...vs)]];
  })) as Record<MetricKey, [number, number]>, [rows]);
  return (
    <Panel
      title={`Chỉ số theo từng ${unit}`}
      subtitle={basis === "prev_bucket" ? `Thay đổi so với ${unit} liền trước` : "Thay đổi so với mốc tương ứng của kỳ so sánh"}
      actions={
        <div className="inline-flex rounded-md border border-line p-0.5 text-[11.5px]">
          {([["prev_bucket", `So với ${unit} trước`], ["compare", "So với kỳ so sánh"]] as const).map(([k, label]) => (
            <button key={k} type="button" disabled={k === "compare" && !hasCompare} onClick={() => setBasis(k)} aria-pressed={basis === k}
              className={cn("rounded px-2 py-1 font-medium transition-colors disabled:opacity-40", basis === k ? "bg-iris-soft text-iris-hi" : "text-faint hover:text-fg")}>
              {label}
            </button>
          ))}
        </div>
      }
    >
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[980px] border-collapse text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-line text-[11.5px] text-faint">
              <th scope="col" className="sticky left-0 bg-card py-2 pr-3 text-left font-medium">Mốc</th>
              {MILESTONE_METRICS.map((k) => <th key={k} scope="col" className="px-2 py-2 text-right font-medium" title={METRIC[k].hint}>{METRIC[k].label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const base = basis === "prev_bucket" ? r.prevBucket : r.compareValues;
              return (
                <tr key={r.point.date} className="border-b border-line/70 last:border-0 hover:bg-raised/40">
                  <th scope="row" className="sticky left-0 bg-card py-2 pr-3 text-left font-medium text-fg">
                    {bucketTitle(r.point, g)}
                    {r.point.partial && <span className="ml-1.5 rounded bg-warn-soft px-1 py-px text-[10px] font-medium text-warn">chưa trọn</span>}
                    {basis === "compare" && r.compare && <span className="block text-[10.5px] font-normal text-faint">vs {bucketTitle(r.compare, g)}</span>}
                  </th>
                  {MILESTONE_METRICS.map((k) => {
                    const def = METRIC[k];
                    const v = r.values[k];
                    const [lo, hi] = extremes[k];
                    const heat = hi > lo ? (v - lo) / (hi - lo) : 0;
                    const good = def.better === "down" ? 1 - heat : heat;
                    return (
                      <td key={k} className="px-2 py-1.5 text-right align-top">
                        <span
                          className="inline-block rounded px-1 font-mono tabular-nums text-fg"
                          style={{ background: def.better === "neutral" ? undefined : `color-mix(in srgb, var(--color-iris) ${Math.round(good * 14)}%, transparent)` }}
                        >
                          {formatMetric(def, v, def.kind === "money")}
                        </span>
                        <span className="mt-0.5 block">
                          <DeltaBadge def={def} d={base ? delta(v, base[k], def.better) : null} className="text-[10.5px]" />
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** Pick any two milestones (from this period or the comparison period) and
 *  see every metric side by side, with the % change as a diverging bar. */
function HeadToHead({ data }: { data: BusinessAnalytics }) {
  const g = data.range.granularity;
  const options = useMemo(() => {
    const cur = data.series.map((p, i) => ({ id: `c${i}`, label: bucketTitle(p, g), point: p }));
    const cmp = data.compare_series.map((p, i) => ({ id: `p${i}`, label: `${bucketTitle(p, g)} (kỳ so sánh)`, point: p }));
    return [...cur, ...cmp];
  }, [data, g]);
  const [aId, setA] = useState<string | null>(null);
  const [bId, setB] = useState<string | null>(null);
  const lastFull = [...data.series].map((p, i) => ({ p, i })).filter(({ p }) => !p.partial).map(({ i }) => i);
  const defaultB = `c${lastFull.at(-1) ?? data.series.length - 1}`;
  const defaultA = lastFull.length > 1 ? `c${lastFull.at(-2)}` : data.compare_series.length ? "p0" : "c0";
  const a = options.find((o) => o.id === (aId ?? defaultA));
  const b = options.find((o) => o.id === (bId ?? defaultB));

  const metrics: MetricKey[] = ["gmv", "platform_revenue", "net_gmv", "paid_orders", "aov", "buyers", "new_buyers", "take_rate", "refund_rate", "dispute_rate", "cancel_rate", "internal_share"];
  const t = chartTokens();
  const rows = metrics.map((k) => {
    const def = METRIC[k];
    const va = a ? def.value(a.point as BusinessPoint) : 0;
    const vb = b ? def.value(b.point as BusinessPoint) : 0;
    const d = delta(vb, va, def.better);
    return { k, def, va, vb, d };
  });
  const option = useMemo(() => {
    const vis = [...rows].reverse();
    const pct = (r: (typeof rows)[number]) => {
      if (!r.d) return 0;
      if (r.def.kind === "rate") return +(r.d.diff * 100).toFixed(2);
      return r.d.pct === null ? (r.vb > 0 ? 100 : 0) : Math.max(-100, Math.min(200, +(r.d.pct * 100).toFixed(1)));
    };
    return {
      ...baseOption(t),
      grid: { left: 8, right: 48, top: 4, bottom: 4, containLabel: true },
      tooltip: {
        ...(baseOption(t).tooltip as object), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(79,70,229,0.06)" } },
        formatter: (ps: { dataIndex: number }[]) => {
          const r = vis[ps[0]?.dataIndex ?? 0];
          return tipTitle(r.def.label) + tipRow(t.compare, a?.label ?? "A", formatMetric(r.def, r.va)) + tipRow(t.series[0], b?.label ?? "B", formatMetric(r.def, r.vb))
            + (r.d ? `<div style="margin-top:4px;font-weight:600;color:${r.d.tone === "good" ? t.good : r.d.tone === "bad" ? t.bad : t.faint}">${formatDelta(r.def, r.d)}</div>` : "");
        },
      },
      xAxis: { type: "value", axisLabel: { formatter: (v: number) => `${v}%`, color: t.faint, fontSize: 10.5 }, splitLine: { lineStyle: { color: t.line } } },
      yAxis: { type: "category", data: vis.map((r) => r.def.label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11.5 } },
      series: [{
        id: "diff", type: "bar", barWidth: 12,
        data: vis.map((r) => ({
          value: pct(r),
          itemStyle: { color: r.d?.tone === "good" ? t.pos : r.d?.tone === "bad" ? t.neg : t.compare, borderRadius: pct(r) >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] },
        })),
        label: { show: true, position: "right", fontSize: 10.5, color: t.muted, formatter: (p: { dataIndex: number }) => (vis[p.dataIndex].d ? formatDelta(vis[p.dataIndex].def, vis[p.dataIndex].d!) : "") },
      }],
    };
  }, [rows, t, a?.label, b?.label]);

  const select = (value: string | undefined, onChange: (v: string) => void, label: string) => (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11.5px] text-faint">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2.5 text-[12.5px] text-fg focus:border-iris focus:outline-none">
        <optgroup label="Kỳ đang xem">{options.filter((o) => o.id.startsWith("c")).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>
        {data.compare_series.length > 0 && <optgroup label="Kỳ so sánh">{options.filter((o) => o.id.startsWith("p")).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>}
      </select>
    </label>
  );

  return (
    <Panel title="So sánh hai cột mốc" subtitle="Chọn mốc gốc (A) và mốc cần so (B) — thanh xanh là cải thiện, đỏ là xấu đi">
      <div className="mb-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
        {select(a?.id, setA, "Mốc gốc (A)")}
        <button type="button" onClick={() => { setA(b?.id ?? null); setB(a?.id ?? null); }} className="grid h-9 w-9 shrink-0 place-items-center self-center rounded-lg border border-line text-faint transition-colors hover:bg-raised hover:text-fg sm:self-end" aria-label="Đổi chỗ hai mốc">
          <ArrowLeftRight size={15} />
        </button>
        {select(b?.id, setB, "Mốc so sánh (B)")}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-[11.5px] text-faint">
              <th className="py-1.5 text-left font-medium">Chỉ số</th>
              <th className="py-1.5 text-right font-medium">A</th>
              <th className="py-1.5 text-right font-medium">B</th>
              <th className="py-1.5 text-right font-medium">B so với A</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k} className="border-b border-line/70 last:border-0">
                <td className="py-1.5 text-muted">{r.def.label}</td>
                <td className="py-1.5 text-right font-mono tabular-nums text-faint">{formatMetric(r.def, r.va, r.def.kind === "money")}</td>
                <td className="py-1.5 text-right font-mono tabular-nums text-fg">{formatMetric(r.def, r.vb, r.def.kind === "money")}</td>
                <td className="py-1.5 text-right"><DeltaBadge def={r.def} d={r.d} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <EChart option={option} height={rows.length * 28 + 12} label="Thay đổi từng chỉ số giữa hai mốc" />
      </div>
    </Panel>
  );
}

export function MilestonesView({ data }: { data: BusinessAnalytics }) {
  return (
    <div className="space-y-4">
      <HeadToHead data={data} />
      <MilestoneTable data={data} />
    </div>
  );
}
