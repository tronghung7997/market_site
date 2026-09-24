"use client";

import { useMemo } from "react";
import type { BusinessAnalytics } from "@/lib/types";
import { AlertTriangle, CheckCircle2, Clock, RotateCcw, X, Flag, Package } from "@/components/Icons";
import { EChart } from "../../chart/EChart";
import { SERIES_SLOT, axisCategory, axisValue, baseOption, chartTokens, tipRow, tipTitle } from "../../chart/theme";
import { STATUS_LABEL, bucketLabel, bucketTitle, compactMoney, formatMoney, formatRate } from "../../model";
import { DataTable, EmptyChart, Panel } from "../Panel";

type Props = { data: BusinessAnalytics; dimmed?: boolean };

/** Created → paid → completed, with where the rest went. */
export function OrderFunnel({ data, dimmed }: Props) {
  const t = chartTokens();
  const s = data.status;
  const created = data.totals.orders;
  const paid = data.totals.paid_orders;
  const completed = s.completed ?? 0;
  const steps = [
    { name: "Đơn tạo", value: created },
    { name: "Thanh toán thành công", value: paid },
    { name: "Hoàn tất (đã giải ngân)", value: completed },
  ];
  const option = useMemo(() => ({
    ...baseOption(t),
    tooltip: {
      ...(baseOption(t).tooltip as object), trigger: "item",
      formatter: (p: { dataIndex: number; value: number; name: string }) =>
        tipTitle(p.name) + tipRow(t.seq[4 - p.dataIndex], "đơn", p.value.toLocaleString("vi-VN"),
          `<span style="opacity:.7">· ${formatRate(created ? p.value / created : 0, 0)} đơn tạo</span>`),
    },
    series: [{
      id: "funnel", type: "funnel", left: "4%", right: "4%", top: 4, bottom: 4, minSize: "22%", gap: 3, sort: "none",
      label: { show: true, position: "inside", color: "#fff", fontSize: 12, fontWeight: 600, formatter: (p: { name: string; value: number }) => `${p.name}\n${p.value.toLocaleString("vi-VN")} · ${formatRate(created ? p.value / created : 0, 0)}` },
      itemStyle: { borderColor: t.surface, borderWidth: 0 },
      data: steps.map((st, i) => ({ ...st, itemStyle: { color: [t.seq[4], t.seq[3], t.iris][i], borderRadius: 4 } })),
    }],
  }), [t, created, paid, completed]);
  const leaks = [
    { key: "pending", icon: Clock, tone: "text-warn", value: (s.pending ?? 0) + (s.processing ?? 0), label: "Đang chờ/đang xử lý" },
    { key: "delivered", icon: Package, tone: "text-muted", value: s.delivered ?? 0, label: "Đang ký quỹ" },
    { key: "disputed", icon: Flag, tone: "text-bad", value: s.disputed ?? 0, label: "Đang khiếu nại" },
    { key: "refunded", icon: RotateCcw, tone: "text-bad", value: s.refunded ?? 0, label: "Hoàn tiền" },
    { key: "cancelled", icon: X, tone: "text-bad", value: s.cancelled ?? 0, label: "Đã huỷ" },
  ];
  return (
    <Panel title="Phễu đơn hàng" subtitle="Đơn tạo trong kỳ đi đến đâu">
      {created === 0 ? <EmptyChart height={220} /> : (
        <>
          <EChart option={option} height={210} label="Phễu đơn hàng" dimmed={dimmed} />
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {leaks.map((l) => (
              <li key={l.key} className="rounded-lg bg-raised/60 px-2.5 py-2">
                <p className={`flex items-center gap-1 text-[11px] ${l.tone}`}><l.icon size={12} /> {l.label}</p>
                <p className="mt-0.5 text-[14px] font-semibold text-fg">{l.value.toLocaleString("vi-VN")}</p>
                <p className="text-[10.5px] text-faint">{formatRate(created ? l.value / created : 0, 1)}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/** When do people buy? Weekday × hour of paid orders, in the admin's timezone. */
export function OrderHeatmap({ data, dimmed }: Props) {
  const t = chartTokens();
  const days = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  const hours = Array.from({ length: 24 }, (_, h) => `${h}h`);
  const cells = useMemo(() => data.heatmap.map((c) => [c.hour, c.dow - 1, c.orders, c.gmv]), [data.heatmap]);
  const max = Math.max(1, ...data.heatmap.map((c) => c.orders));
  const peak = data.heatmap.reduce((a, c) => (c.orders > (a?.orders ?? 0) ? c : a), data.heatmap[0]);
  const option = useMemo(() => ({
    ...baseOption(t),
    grid: { left: 8, right: 8, top: 4, bottom: 44, containLabel: true },
    tooltip: {
      ...(baseOption(t).tooltip as object), trigger: "item",
      formatter: (p: { value: number[] }) => tipTitle(`${days[p.value[1]]}, ${p.value[0]}:00–${p.value[0]}:59`)
        + tipRow(t.seq[4], "đơn", p.value[2].toLocaleString("vi-VN"))
        + tipRow(t.seq[3], "GMV", formatMoney(p.value[3])),
    },
    xAxis: axisCategory(t, hours, { splitArea: { show: false }, axisLabel: { color: t.faint, fontSize: 10, interval: 2 } }),
    yAxis: { type: "category", data: days, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 11 }, inverse: true },
    visualMap: {
      min: 0, max, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemWidth: 10, itemHeight: 140,
      inRange: { color: t.seq }, textStyle: { color: t.faint, fontSize: 10 }, text: ["nhiều", "ít"],
    },
    series: [{
      id: "heat", type: "heatmap", data: cells,
      itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
      emphasis: { itemStyle: { borderColor: t.fg, borderWidth: 1 } },
    }],
  }), [t, cells, max]);
  return (
    <Panel
      title="Giờ cao điểm mua hàng"
      subtitle={peak ? `Cao nhất: ${days[peak.dow - 1]} lúc ${peak.hour}h (${peak.orders} đơn) — lịch khuyến mãi, trực CSKH, nhập hàng nên bám khung này` : "Theo giờ địa phương của bạn"}
      table={<DataTable head={["Thứ", "Giờ", "Đơn", "GMV"]} rows={[...data.heatmap].sort((a, b) => b.orders - a.orders).map((c) => [days[c.dow - 1], `${c.hour}h`, c.orders, formatMoney(c.gmv)])} />}
    >
      {data.heatmap.length === 0 ? <EmptyChart height={260} /> : <EChart option={option} height={270} label="Bản đồ nhiệt đơn hàng theo thứ và giờ" dimmed={dimmed} />}
    </Panel>
  );
}

/** Quality rates over time — all percentages, one axis. */
export function RatesChart({ data, dimmed }: Props) {
  const t = chartTokens();
  const g = data.range.granularity;
  const lines = useMemo(() => [
    { id: "refund", name: "Hoàn tiền (theo GMV)", color: t.series[1], values: data.series.map((p) => (p.gmv ? (p.refunded / p.gmv) * 100 : 0)) },
    { id: "dispute", name: "Khiếu nại (theo đơn)", color: t.series[4], values: data.series.map((p) => (p.paid_orders ? (p.disputed_orders / p.paid_orders) * 100 : 0)) },
    { id: "cancel", name: "Huỷ (theo đơn tạo)", color: t.series[6], values: data.series.map((p) => (p.orders ? (p.cancelled / p.orders) * 100 : 0)) },
  ], [data.series, t]);
  const option = useMemo(() => ({
    ...baseOption(t),
    tooltip: {
      ...(baseOption(t).tooltip as object), trigger: "axis", axisPointer: { type: "line", lineStyle: { color: t.line } },
      formatter: (ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? 0;
        return tipTitle(bucketTitle(data.series[i], g)) + lines.map((l) => tipRow(l.color, l.name, `${l.values[i].toFixed(1)}%`)).join("");
      },
    },
    xAxis: axisCategory(t, data.series.map((p) => bucketLabel(p.date, g)), { boundaryGap: false }),
    yAxis: axisValue(t, (v) => `${v}%`),
    series: lines.map((l) => ({
      id: l.id, name: l.name, type: "line", smooth: 0.25, data: l.values.map((v) => +v.toFixed(2)),
      symbol: "circle", symbolSize: 6, showSymbol: data.series.length < 32,
      lineStyle: { width: 2, color: l.color }, itemStyle: { color: l.color, borderColor: t.surface, borderWidth: 2 },
      endLabel: { show: true, color: t.muted, fontSize: 10.5, formatter: (p: { value: number }) => `${p.value}%` },
    })),
    grid: { left: 8, right: 44, top: 16, bottom: 4, containLabel: true },
  }), [lines, data.series, g, t]);
  const worst = Math.max(...lines.flatMap((l) => l.values));
  return (
    <Panel
      title="Chất lượng giao dịch"
      subtitle="Tỷ lệ hoàn tiền, khiếu nại, huỷ đơn theo mốc — đường đi lên là tín hiệu xấu"
      legend={lines.map((l) => ({ label: l.name, color: l.color, shape: "line" as const }))}
      table={<DataTable head={["Mốc", ...lines.map((l) => l.name)]} rows={data.series.map((p, i) => [bucketTitle(p, g), ...lines.map((l) => `${l.values[i].toFixed(1)}%`)])} />}
    >
      {worst === 0 ? (
        <div className="grid h-[240px] place-items-center text-center text-[12.5px] text-good">
          <span className="flex items-center gap-1.5"><CheckCircle2 size={15} /> Không có hoàn tiền, khiếu nại hay huỷ đơn trong kỳ</span>
        </div>
      ) : <EChart option={option} height={240} label="Tỷ lệ hoàn tiền, khiếu nại và huỷ theo mốc" dimmed={dimmed} />}
    </Panel>
  );
}

/** Growth quality: GMV from first-time buyers vs returning ones. */
export function BuyerMixChart({ data, dimmed }: Props) {
  const t = chartTokens();
  const g = data.range.granularity;
  const option = useMemo(() => ({
    ...baseOption(t),
    tooltip: {
      ...(baseOption(t).tooltip as object), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(79,70,229,0.06)" } },
      formatter: (ps: { dataIndex: number }[]) => {
        const p = data.series[ps[0]?.dataIndex ?? 0];
        return tipTitle(bucketTitle(p, g))
          + tipRow(t.series[SERIES_SLOT.returning], "Khách quay lại", formatMoney(p.gmv - p.new_buyer_gmv))
          + tipRow(t.series[SERIES_SLOT.newBuyers], "Khách mới", formatMoney(p.new_buyer_gmv))
          + `<div style="margin-top:4px;opacity:.75">${p.buyers.toLocaleString("vi-VN")} người mua · ${p.new_buyers.toLocaleString("vi-VN")} mới</div>`;
      },
    },
    xAxis: axisCategory(t, data.series.map((p) => bucketLabel(p.date, g))),
    yAxis: axisValue(t, compactMoney),
    series: [
      { id: "returning", name: "Khách quay lại", type: "bar", stack: "b", barMaxWidth: 28, data: data.series.map((p) => p.gmv - p.new_buyer_gmv), itemStyle: { color: t.series[SERIES_SLOT.returning], borderColor: t.surface, borderWidth: 1 } },
      { id: "new", name: "Khách mới", type: "bar", stack: "b", barMaxWidth: 28, data: data.series.map((p) => p.new_buyer_gmv), itemStyle: { color: t.series[SERIES_SLOT.newBuyers], borderRadius: [4, 4, 0, 0], borderColor: t.surface, borderWidth: 1 } },
    ],
  }), [data.series, g, t]);
  const tot = data.totals;
  const repeatShare = tot.gmv ? (tot.gmv - tot.new_buyer_gmv) / tot.gmv : 0;
  return (
    <Panel
      title="Khách mới vs khách quay lại"
      subtitle={`${formatRate(repeatShare, 0)} GMV đến từ khách đã từng mua · ${tot.new_buyers.toLocaleString("vi-VN")} khách mới / ${tot.buyers.toLocaleString("vi-VN")} người mua`}
      legend={[
        { label: "Khách quay lại", color: t.series[SERIES_SLOT.returning] },
        { label: "Khách mới (đơn đầu tiên)", color: t.series[SERIES_SLOT.newBuyers] },
      ]}
      table={<DataTable head={["Mốc", "Quay lại", "Khách mới", "Người mua", "Mới"]} rows={data.series.map((p) => [bucketTitle(p, g), formatMoney(p.gmv - p.new_buyer_gmv), formatMoney(p.new_buyer_gmv), p.buyers, p.new_buyers])} />}
    >
      {tot.gmv === 0 ? <EmptyChart height={240} /> : <EChart option={option} height={240} label="GMV khách mới và khách quay lại theo mốc" dimmed={dimmed} />}
    </Panel>
  );
}

export function StatusBreakdown({ data }: { data: BusinessAnalytics }) {
  const order = ["completed", "delivered", "processing", "pending", "disputed", "refunded", "cancelled"];
  const total = Object.values(data.status).reduce((a, b) => a + b, 0) || 1;
  const tone: Record<string, string> = {
    completed: "bg-good", delivered: "bg-iris", processing: "bg-warn", pending: "bg-warn", disputed: "bg-bad", refunded: "bg-bad", cancelled: "bg-faint",
  };
  return (
    <Panel title="Trạng thái đơn" subtitle="Đơn tạo trong kỳ, khiếu nại đang mở tính vào “Khiếu nại”">
      <ul className="space-y-2">
        {order.map((k) => {
          const v = data.status[k] ?? 0;
          const prev = data.compare_status?.[k];
          return (
            <li key={k} className="grid grid-cols-[120px_1fr_auto] items-center gap-3 text-[12.5px]">
              <span className="flex items-center gap-1.5 text-muted">
                {k === "disputed" || k === "refunded" ? <AlertTriangle size={12} className="text-bad" /> : null}
                {STATUS_LABEL[k]}
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-raised">
                <span className={`block h-full rounded-full ${tone[k]} transition-[width] duration-700 ease-out`} style={{ width: `${(v / total) * 100}%` }} />
              </span>
              <span className="w-24 text-right font-mono tabular-nums text-fg">
                {v.toLocaleString("vi-VN")}
                {prev !== undefined && <span className="ml-1 text-[11px] text-faint">/{prev}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {data.compare_status && <p className="mt-2 text-[11px] text-faint">Số sau dấu “/” là kỳ so sánh.</p>}
    </Panel>
  );
}
