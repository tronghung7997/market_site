"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import type { BusinessAnalytics, BusinessPoint } from "@/lib/types";
import { EChart } from "../../chart/EChart";
import { axisCategory, axisValue, baseOption, chartTokens, tipRow, tipTitle } from "../../chart/theme";
import {
  METRIC, TREND_METRICS, bucketLabel, bucketTitle, delta, formatDelta, formatMetric, formatRangeLabel,
  type AnalyticsState, type MetricKey,
} from "../../model";
import { DataTable, DeltaBadge, EmptyChart, Panel } from "../Panel";

export function TrendChart({
  data, metric, onMetric, onDrill, dimmed, height = 320,
}: {
  data: BusinessAnalytics;
  metric: MetricKey;
  onMetric: (m: MetricKey) => void;
  onDrill: (patch: Partial<AnalyticsState>) => void;
  dimmed?: boolean;
  height?: number;
}) {
  const def = METRIC[metric];
  const g = data.range.granularity;
  const hasCompare = data.compare_series.length > 0;
  const { cur, cmp } = useMemo(() => ({
    cur: data.series.map((p) => def.value(p)),
    cmp: data.series.map((_, i) => (data.compare_series[i] ? def.value(data.compare_series[i]) : null)),
  }), [data, def]);
  const total = def.value(data.totals);
  const prevTotal = data.compare_totals ? def.value(data.compare_totals) : null;
  const empty = cur.every((v) => v === 0) && cmp.every((v) => !v);

  const option = useMemo(() => {
    const t = chartTokens();
    const labels = data.series.map((p) => bucketLabel(p.date, g));
    const asLine = def.kind === "rate";
    const fmtAxis = (v: number) => formatMetric(def, v, true);
    const many = labels.length > 45;
    const avg = cur.length ? cur.reduce((a, b) => a + b, 0) / cur.length : 0;
    return {
      ...baseOption(t),
      grid: { left: 8, right: 16, top: 24, bottom: many ? 44 : 4, containLabel: true },
      tooltip: {
        ...(baseOption(t).tooltip as object),
        trigger: "axis",
        axisPointer: { type: asLine ? "line" : "shadow", lineStyle: { color: t.line }, shadowStyle: { color: "rgba(79,70,229,0.06)" } },
        formatter: (params: { dataIndex: number }[]) => {
          const i = params[0]?.dataIndex ?? 0;
          const p = data.series[i];
          const c = data.compare_series[i];
          let html = tipTitle(bucketTitle(p, g) + (p.partial ? " · chưa trọn kỳ" : ""));
          html += tipRow(t.series[0], "Kỳ này", formatMetric(def, cur[i]));
          if (c) {
            html += tipRow(t.compare, `So sánh · ${bucketTitle(c, g)}`, formatMetric(def, cmp[i] ?? 0));
            const d = delta(cur[i], cmp[i], def.better);
            if (d) {
              const color = d.tone === "good" ? t.good : d.tone === "bad" ? t.bad : t.faint;
              html += `<div style="margin-top:6px;color:${color};font-weight:600">${formatDelta(def, d)}</div>`;
            }
          }
          if (def.kind === "money" && metric !== "aov") html += `<div style="margin-top:4px;opacity:.7">${p.paid_orders.toLocaleString("vi-VN")} đơn · ${p.buyers.toLocaleString("vi-VN")} người mua</div>`;
          if (g !== "day") html += `<div style="margin-top:6px;opacity:.6;font-size:11px">Bấm để xem chi tiết mốc này</div>`;
          return html;
        },
      },
      xAxis: axisCategory(t, labels, { boundaryGap: !asLine }),
      yAxis: axisValue(t, fmtAxis),
      dataZoom: many
        ? [
            { type: "inside", start: 0, end: 100 },
            { type: "slider", height: 18, bottom: 6, borderColor: t.line, fillerColor: "rgba(79,70,229,0.08)", handleStyle: { color: t.surface, borderColor: t.faint }, textStyle: { color: t.faint, fontSize: 10 }, brushSelect: false },
          ]
        : [],
      series: [
        asLine
          ? {
              id: "current", name: "Kỳ này", type: "line", data: cur, smooth: 0.25, symbol: "circle", symbolSize: 6, showSymbol: cur.length < 40,
              lineStyle: { width: 2, color: t.series[0] }, itemStyle: { color: t.series[0], borderColor: t.surface, borderWidth: 2 },
              areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(79,70,229,0.16)" }, { offset: 1, color: "rgba(79,70,229,0)" }] } },
              universalTransition: true,
            }
          : {
              id: "current", name: "Kỳ này", type: "bar", barMaxWidth: 28, barCategoryGap: "32%",
              data: data.series.map((p, i) => ({
                value: cur[i],
                itemStyle: { color: t.series[0], opacity: p.partial ? 0.45 : 1, borderRadius: [4, 4, 0, 0] },
              })),
              emphasis: { itemStyle: { color: "#4338ca" } },
              markLine: cur.length > 2 ? {
                silent: true, symbol: "none",
                lineStyle: { color: t.faint, type: "solid", width: 1, opacity: 0.5 },
                label: { formatter: `TB ${fmtAxis(avg)}`, color: t.faint, fontSize: 10, position: "insideEndTop" },
                data: [{ yAxis: avg }],
              } : undefined,
              universalTransition: true,
            },
        ...(hasCompare
          ? [{
              id: "compare", name: "Kỳ so sánh", type: "line", data: cmp, smooth: 0.25, symbol: "circle", symbolSize: 5, showSymbol: cmp.length < 40,
              lineStyle: { width: 2, color: t.compare }, itemStyle: { color: t.compare, borderColor: t.surface, borderWidth: 2 }, z: 3,
            }]
          : []),
      ],
    };
  }, [data, def, g, metric, cur, cmp, hasCompare]);

  const onEvents = useMemo(() => ({
    click: (p: unknown) => {
      const i = (p as { dataIndex?: number }).dataIndex;
      if (i === undefined || g === "day") return;
      const point: BusinessPoint = data.series[i];
      const from = point.date < data.range.from_date ? data.range.from_date : point.date;
      const to = point.end_date > data.range.to_date ? data.range.to_date : point.end_date;
      onDrill({ range: "custom", from, to, granularity: "auto" });
    },
  }), [data, g, onDrill]);

  const d = delta(total, prevTotal, def.better);
  const title = (
    <span className="flex flex-wrap items-center gap-2">
      Xu hướng · {def.label}
      <span className="font-mono text-[15px] font-semibold">{formatMetric(def, total)}</span>
      <DeltaBadge def={def} d={d} />
    </span>
  );

  return (
    <Panel
      title={title}
      subtitle={
        <span className="flex flex-col gap-2.5">
          <span title={def.hint}>
            {formatRangeLabel(data.range.from_date, data.range.to_date)}
            {data.range.compare_from_date ? ` · so với ${formatRangeLabel(data.range.compare_from_date, data.range.compare_to_date!)}` : ""}
            {g !== "day" ? " · bấm một cột để xem chi tiết mốc đó" : ""}
          </span>
          <span className="flex flex-wrap gap-1" role="tablist" aria-label="Chỉ số">
            {TREND_METRICS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={k === metric}
                onClick={() => onMetric(k)}
                title={METRIC[k].hint}
                className={cn(
                  "h-7 shrink-0 rounded-md border px-2 text-[11.5px] font-medium transition-colors",
                  k === metric ? "border-iris/30 bg-iris-soft text-iris-hi" : "border-transparent text-faint hover:bg-raised hover:text-fg",
                )}
              >
                {METRIC[k].short ?? METRIC[k].label}
              </button>
            ))}
          </span>
        </span>
      }
      legend={[
        { label: "Kỳ này", color: chartTokens().series[0], shape: def.kind === "rate" ? "line" : "bar" },
        ...(hasCompare ? [{ label: "Kỳ so sánh", color: chartTokens().compare, shape: "line" as const }] : []),
      ]}
      table={
        <DataTable
          head={["Mốc", "Kỳ này", ...(hasCompare ? ["Kỳ so sánh", "Thay đổi"] : [])]}
          rows={data.series.map((p, i) => {
            const dd = delta(cur[i], cmp[i], def.better);
            return [
              bucketTitle(p, g) + (p.partial ? " *" : ""),
              formatMetric(def, cur[i]),
              ...(hasCompare ? [cmp[i] === null ? "—" : formatMetric(def, cmp[i]!), dd ? formatDelta(def, dd) : "—"] : []),
            ];
          })}
        />
      }
    >
      {empty ? <EmptyChart height={height} /> : <EChart option={option} height={height} label={`Biểu đồ ${def.label} theo ${g}`} onEvents={onEvents} dimmed={dimmed} />}
    </Panel>
  );
}
