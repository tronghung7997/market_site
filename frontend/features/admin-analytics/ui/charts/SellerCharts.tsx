"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import type { BusinessAnalytics, BusinessSellerRow } from "@/lib/types";
import { EChart } from "../../chart/EChart";
import { SERIES_SLOT, axisCategory, axisValue, baseOption, chartTokens, esc, tipRow, tipTitle } from "../../chart/theme";
import {
  METRIC, TIER_LABEL, TIER_ORDER, compactMoney, delta, formatMoney, formatRate, type AnalyticsState,
} from "../../model";
import { AnimatedNumber } from "../KpiStrip";
import { DataTable, DeltaBadge, EmptyChart, Panel } from "../Panel";

type Props = { data: BusinessAnalytics; dimmed?: boolean; onFilter: (patch: Partial<AnalyticsState>) => void };

const sellerColor = (s: { is_internal: boolean }) => chartTokens().series[s.is_internal ? SERIES_SLOT.internal : SERIES_SLOT.external];

/** Top sellers by GMV; the grey tick is the same seller last period. */
export function SellerLeaderboard({ data, dimmed, onFilter, limit = 12 }: Props & { limit?: number }) {
  const t = chartTokens();
  const hasCompare = !!data.compare_totals;
  const rows = useMemo(() => data.top_sellers.slice(0, limit).reverse(), [data.top_sellers, limit]);
  const total = data.totals.gmv || 1;
  const option = useMemo(() => ({
    ...baseOption(t),
    grid: { left: 8, right: 64, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      ...(baseOption(t).tooltip as object), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(79,70,229,0.06)" } },
      formatter: (ps: { dataIndex: number }[]) => {
        const s = rows[ps[0]?.dataIndex ?? 0];
        return tipTitle(`${s.name} · #${s.id}`)
          + `<div style="opacity:.7;margin-bottom:2px">${s.is_internal ? "Seller nội bộ" : "Seller đối tác"} · hạng ${esc(TIER_LABEL[s.tier] ?? s.tier)}</div>`
          + tipRow(sellerColor(s), "GMV", `${formatMoney(s.gmv)} · ${formatRate(s.gmv / total, 1)}`)
          + (hasCompare ? tipRow(t.compare, "Kỳ so sánh", formatMoney(s.gmv_prev)) : "")
          + `<div style="margin-top:4px;opacity:.75">${s.paid_orders.toLocaleString("vi-VN")} đơn · doanh thu sàn ${compactMoney(s.platform_take)}</div>`
          + `<div style="opacity:.75">Hoàn ${formatRate(s.gmv ? s.refunded / s.gmv : 0)} · khiếu nại ${formatRate(s.paid_orders ? s.disputed_orders / s.paid_orders : 0)}</div>`
          + `<div style="margin-top:4px;opacity:.6;font-size:11px">Bấm để lọc seller này</div>`;
      },
    },
    xAxis: axisValue(t, compactMoney),
    yAxis: {
      type: "category", data: rows.map((s) => s.name), axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { color: t.muted, fontSize: 12, width: 130, overflow: "truncate" },
    },
    series: [
      {
        id: "gmv", type: "bar", barWidth: 14,
        data: rows.map((s) => ({ value: s.gmv, itemStyle: { color: sellerColor(s), borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: "right", color: t.muted, fontSize: 11, formatter: (p: { value: number }) => formatRate(p.value / total, 0) },
      },
      ...(hasCompare ? [{
        id: "prev", type: "scatter", symbol: "rect", symbolSize: [3, 18], z: 5,
        data: rows.map((s) => s.gmv_prev), itemStyle: { color: t.fg, opacity: 0.55 },
        tooltip: { show: false },
      }] : []),
    ],
  }), [rows, t, hasCompare, total]);
  const onEvents = useMemo(() => ({
    click: (p: unknown) => {
      const s = rows[(p as { dataIndex: number }).dataIndex];
      if (s) onFilter({ sellerId: s.id });
    },
  }), [rows, onFilter]);
  return (
    <Panel
      title="Xếp hạng seller theo GMV"
      subtitle="Nhãn bên phải = tỷ trọng GMV toàn kỳ · bấm để lọc"
      legend={[
        { label: "Seller đối tác", color: t.series[SERIES_SLOT.external] },
        { label: "Seller nội bộ", color: t.series[SERIES_SLOT.internal] },
        ...(hasCompare ? [{ label: "Kỳ so sánh", color: t.fg, shape: "line" as const }] : []),
      ]}
    >
      {rows.length === 0 ? <EmptyChart height={260} /> : <EChart option={option} height={Math.max(220, rows.length * 30 + 24)} label="Xếp hạng seller theo GMV" onEvents={onEvents} dimmed={dimmed} />}
    </Panel>
  );
}

/** Growth vs size: the bottom-right quadrant (big and shrinking) is where the
 *  business is bleeding; bubble size = orders. */
export function SellerQuadrant({ data, dimmed, onFilter }: Props) {
  const t = chartTokens();
  const hasCompare = !!data.compare_totals;
  const sellers = useMemo(() => {
    const seen = new Map<number, BusinessSellerRow>();
    for (const s of [...data.top_sellers, ...data.declining_sellers]) seen.set(s.id, s);
    return [...seen.values()].filter((s) => s.gmv > 0 || s.gmv_prev > 0);
  }, [data.top_sellers, data.declining_sellers]);
  const growth = (s: BusinessSellerRow) => (s.gmv_prev > 0 ? Math.max(-100, Math.min(300, ((s.gmv - s.gmv_prev) / s.gmv_prev) * 100)) : 100);
  const option = useMemo(() => {
    const maxOrders = Math.max(1, ...sellers.map((s) => s.paid_orders));
    const point = (s: BusinessSellerRow) => ({
      value: [Math.max(s.gmv, 1), growth(s), s.paid_orders],
      name: s.name, seller: s,
      symbolSize: 10 + Math.sqrt(s.paid_orders / maxOrders) * 26,
      itemStyle: { color: sellerColor(s), opacity: 0.78, borderColor: t.surface, borderWidth: 2 },
    });
    return {
      ...baseOption(t),
      grid: { left: 8, right: 24, top: 20, bottom: 24, containLabel: true },
      tooltip: {
        ...(baseOption(t).tooltip as object), trigger: "item",
        formatter: (p: { data: { seller: BusinessSellerRow } }) => {
          const s = p.data.seller;
          return tipTitle(`${s.name} · #${s.id}`)
            + tipRow(sellerColor(s), "GMV", formatMoney(s.gmv))
            + tipRow(t.compare, "Kỳ so sánh", formatMoney(s.gmv_prev))
            + `<div style="margin-top:4px;font-weight:600;color:${s.gmv >= s.gmv_prev ? t.good : t.bad}">${s.gmv_prev ? `${growth(s) >= 0 ? "+" : ""}${growth(s).toFixed(0)}%` : "Mới"}</div>`
            + `<div style="opacity:.7">${s.paid_orders.toLocaleString("vi-VN")} đơn</div>`;
        },
      },
      xAxis: axisValue(t, compactMoney, { type: "log", name: "GMV (thang log)", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: t.faint, fontSize: 11 } }),
      yAxis: axisValue(t, (v) => `${v}%`, { name: "Tăng trưởng", nameTextStyle: { color: t.faint, fontSize: 11, align: "left" } }),
      series: [{
        id: "sellers", type: "scatter", data: sellers.map(point),
        emphasis: { focus: "self", itemStyle: { opacity: 1, borderColor: t.fg, borderWidth: 1.5 } },
        label: { show: true, position: "right", formatter: (p: { data: { seller: BusinessSellerRow } }) => (sellers.length <= 12 || p.data.seller.gmv >= data.totals.gmv * 0.1 || p.data.seller.gmv_prev - p.data.seller.gmv >= (data.compare_totals?.gmv ?? 0) * 0.05 ? p.data.seller.name : ""), color: t.muted, fontSize: 11 },
        markLine: { silent: true, symbol: "none", lineStyle: { color: t.faint, width: 1, type: "solid", opacity: 0.6 }, label: { show: false }, data: [{ yAxis: 0 }] },
        markArea: {
          silent: true, itemStyle: { color: "rgba(207,68,68,0.05)" },
          label: { show: true, position: "insideBottomRight", color: t.bad, fontSize: 10.5, formatter: "Lớn nhưng đang giảm" },
          data: [[{ xAxis: Math.max(1, data.totals.gmv * 0.05), yAxis: -100 }, { xAxis: "max", yAxis: 0 }]],
        },
      }],
    };
  }, [sellers, t, data.totals.gmv, data.compare_totals?.gmv]);
  const onEvents = useMemo(() => ({
    click: (p: unknown) => {
      const s = (p as { data?: { seller?: BusinessSellerRow } }).data?.seller;
      if (s) onFilter({ sellerId: s.id });
    },
  }), [onFilter]);
  if (!hasCompare) {
    return <Panel title="Quy mô vs tăng trưởng seller"><EmptyChart height={300} text="Bật so sánh kỳ để xem tăng trưởng seller" /></Panel>;
  }
  return (
    <Panel
      title="Quy mô vs tăng trưởng seller"
      subtitle="Trục ngang = GMV (log), trục dọc = % thay đổi, kích thước = số đơn. Vùng đỏ: seller lớn đang sụt."
      legend={[
        { label: "Seller đối tác", color: t.series[SERIES_SLOT.external], shape: "dot" },
        { label: "Seller nội bộ", color: t.series[SERIES_SLOT.internal], shape: "dot" },
      ]}
      table={
        <DataTable
          head={["Seller", "GMV", "Kỳ trước", "Tăng trưởng", "Đơn"]}
          rows={sellers.map((s) => [s.name, formatMoney(s.gmv), formatMoney(s.gmv_prev), s.gmv_prev ? `${growth(s).toFixed(0)}%` : "mới", s.paid_orders.toLocaleString("vi-VN")])}
        />
      }
    >
      {sellers.length === 0 ? <EmptyChart height={300} /> : <EChart option={option} height={320} label="Biểu đồ quy mô và tăng trưởng seller" onEvents={onEvents} dimmed={dimmed} />}
    </Panel>
  );
}

export function TierChart({ data, dimmed }: Omit<Props, "onFilter">) {
  const t = chartTokens();
  const rows = useMemo(() => TIER_ORDER.map((tier) => data.tiers.find((r) => r.tier === tier) ?? { tier, gmv: 0, gmv_prev: 0, sellers: 0, paid_orders: 0, refunded: 0, disputed_orders: 0 }), [data.tiers]);
  // Ordered categories → ordinal ramp (one hue, light → dark), never categorical.
  const ramp = [t.seq[1], t.seq[2], t.seq[3], t.seq[4]];
  const option = useMemo(() => ({
    ...baseOption(t),
    grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
    tooltip: {
      ...(baseOption(t).tooltip as object), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(79,70,229,0.06)" } },
      formatter: (ps: { dataIndex: number }[]) => {
        const r = rows[ps[0]?.dataIndex ?? 0];
        return tipTitle(`Hạng ${TIER_LABEL[r.tier]}`)
          + tipRow(ramp[ps[0]?.dataIndex ?? 0], "GMV", formatMoney(r.gmv))
          + `<div style="opacity:.75;margin-top:4px">${r.sellers} seller có đơn · ${r.paid_orders.toLocaleString("vi-VN")} đơn</div>`
          + `<div style="opacity:.75">Hoàn ${formatRate(r.gmv ? r.refunded / r.gmv : 0)} · khiếu nại ${formatRate(r.paid_orders ? r.disputed_orders / r.paid_orders : 0)}</div>`;
      },
    },
    xAxis: axisCategory(t, rows.map((r) => TIER_LABEL[r.tier])),
    yAxis: axisValue(t, compactMoney),
    series: [{
      id: "tiers", type: "bar", barMaxWidth: 44,
      data: rows.map((r, i) => ({ value: r.gmv, itemStyle: { color: ramp[i], borderRadius: [4, 4, 0, 0] } })),
      label: { show: true, position: "top", color: t.muted, fontSize: 11, formatter: (p: { dataIndex: number }) => `${rows[p.dataIndex].sellers} seller` },
    }],
  }), [rows, t, ramp]);
  return (
    <Panel
      title="Doanh số theo hạng seller"
      subtitle="Hạng cao được giảm phí — theo dõi phần GMV đang hưởng ưu đãi"
      table={<DataTable head={["Hạng", "GMV", "Kỳ trước", "Seller", "Đơn"]} rows={rows.map((r) => [TIER_LABEL[r.tier], formatMoney(r.gmv), formatMoney(r.gmv_prev), r.sellers, r.paid_orders.toLocaleString("vi-VN")])} />}
    >
      {rows.every((r) => !r.gmv) ? <EmptyChart height={240} /> : <EChart option={option} height={240} label="GMV theo hạng seller" dimmed={dimmed} />}
    </Panel>
  );
}

export function ConcentrationCard({ data }: { data: BusinessAnalytics }) {
  const c = data.concentration;
  const p = data.compare_concentration;
  const hhiTone = c.hhi >= 2500 ? "text-bad" : c.hhi >= 1500 ? "text-warn" : "text-good";
  const hhiLabel = c.hhi >= 2500 ? "Tập trung cao" : c.hhi >= 1500 ? "Tập trung vừa" : "Phân tán tốt";
  const bars: [string, number, number | undefined][] = [["Top 1", c.top1, p?.top1], ["Top 5", c.top5, p?.top5], ["Top 10", c.top10, p?.top10]];
  return (
    <Panel title="Mức độ phụ thuộc seller" subtitle={`${c.sellers.toLocaleString("vi-VN")} seller có doanh số · ${data.new_sellers} seller có đơn đầu tiên trong kỳ`}>
      <div className="space-y-3">
        {bars.map(([label, v, prev]) => (
          <div key={label}>
            <div className="mb-1 flex items-center justify-between text-[12px]">
              <span className="text-muted">{label} seller chiếm</span>
              <span className="flex items-center gap-1.5">
                <AnimatedNumber value={v} format={(x) => formatRate(x, 0)} className="font-semibold text-fg" />
                {prev !== undefined && <DeltaBadge def={{ ...METRIC.internal_share, better: "down" }} d={delta(v, prev, "down")} />}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full bg-iris transition-[width] duration-700 ease-out" style={{ width: `${v * 100}%` }} />
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between rounded-lg bg-raised/60 px-3 py-2 text-[12px]">
          <span className="text-muted" title="Chỉ số Herfindahl–Hirschman: tổng bình phương thị phần (0–10.000). Trên 2.500 là thị trường phụ thuộc vài seller.">Chỉ số HHI</span>
          <span className={cn("font-semibold", hhiTone)}>{Math.round(c.hhi).toLocaleString("vi-VN")} · {hhiLabel}</span>
        </div>
      </div>
    </Panel>
  );
}

type SortKey = "gmv" | "growth" | "orders" | "refund" | "dispute" | "take";

export function SellerTable({ data, onFilter }: Omit<Props, "dimmed">) {
  const [sort, setSort] = useState<SortKey>("gmv");
  const [view, setView] = useState<"top" | "declining">("top");
  const hasCompare = !!data.compare_totals;
  const rows = useMemo(() => {
    const list = view === "top" ? [...data.top_sellers] : [...data.declining_sellers];
    const key: Record<SortKey, (s: BusinessSellerRow) => number> = {
      gmv: (s) => s.gmv,
      growth: (s) => (s.gmv_prev ? (s.gmv - s.gmv_prev) / s.gmv_prev : s.gmv ? 9 : 0),
      orders: (s) => s.paid_orders,
      refund: (s) => (s.gmv ? s.refunded / s.gmv : 0),
      dispute: (s) => (s.paid_orders ? s.disputed_orders / s.paid_orders : 0),
      take: (s) => s.platform_take,
    };
    return view === "declining" && sort === "gmv" ? list : list.sort((a, b) => key[sort](b) - key[sort](a));
  }, [data.top_sellers, data.declining_sellers, sort, view]);
  const max = Math.max(1, ...rows.map((s) => Math.max(s.gmv, s.gmv_prev)));
  const th = (k: SortKey, label: string) => (
    <th scope="col" className="py-2 pr-2 text-right font-medium">
      <button type="button" onClick={() => setSort(k)} className={cn("inline-flex items-center gap-0.5 hover:text-fg", sort === k && "text-fg")} aria-pressed={sort === k}>
        {label}{sort === k && <span aria-hidden className="text-[8px]">▼</span>}
      </button>
    </th>
  );
  return (
    <Panel
      title="Bảng seller"
      subtitle="Bấm tên seller để lọc toàn bộ trang theo seller đó"
      actions={
        <div className="inline-flex rounded-md border border-line p-0.5 text-[11.5px]">
          {(["top", "declining"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
              className={cn("rounded px-2 py-1 font-medium transition-colors", view === v ? "bg-iris-soft text-iris-hi" : "text-faint hover:text-fg")}>
              {v === "top" ? "Doanh số cao" : "Sụt giảm mạnh"}
            </button>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? <EmptyChart height={160} text={view === "declining" ? "Không có seller nào giảm doanh số" : undefined} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] text-faint">
                <th scope="col" className="py-2 pr-2 font-medium">Seller</th>
                {th("gmv", "GMV")}
                {hasCompare && th("growth", "Thay đổi")}
                {th("orders", "Đơn")}
                {th("take", "Doanh thu sàn")}
                {th("refund", "Hoàn tiền")}
                {th("dispute", "Khiếu nại")}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const refund = s.gmv ? s.refunded / s.gmv : 0;
                const dispute = s.paid_orders ? s.disputed_orders / s.paid_orders : 0;
                return (
                  <tr key={s.id} className="border-b border-line/70 transition-colors last:border-0 hover:bg-raised/50">
                    <td className="py-2 pr-2">
                      <button type="button" onClick={() => onFilter({ sellerId: s.id })} className="group flex min-w-0 items-center gap-2 text-left">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: sellerColor(s) }} aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-fg group-hover:text-iris-hi">{s.name}</span>
                          <span className="block text-[11px] text-faint">#{s.id} · {s.is_internal ? "Nội bộ" : "Đối tác"} · {TIER_LABEL[s.tier] ?? s.tier}</span>
                        </span>
                      </button>
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <span className="font-mono tabular-nums">{compactMoney(s.gmv)}</span>
                      <span className="mt-1 ml-auto block h-1 w-24 overflow-hidden rounded-full bg-raised">
                        <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${(s.gmv / max) * 100}%`, background: sellerColor(s) }} />
                      </span>
                    </td>
                    {hasCompare && <td className="py-2 pr-2 text-right"><DeltaBadge def={METRIC.gmv} d={delta(s.gmv, s.gmv_prev, "up")} /></td>}
                    <td className="py-2 pr-2 text-right font-mono tabular-nums">{s.paid_orders.toLocaleString("vi-VN")}</td>
                    <td className="py-2 pr-2 text-right font-mono tabular-nums">{compactMoney(s.platform_take)}</td>
                    <td className={cn("py-2 pr-2 text-right font-mono tabular-nums", refund >= 0.1 ? "font-semibold text-bad" : refund >= 0.05 ? "text-warn" : "text-faint")}>{refund ? formatRate(refund) : "—"}</td>
                    <td className={cn("py-2 text-right font-mono tabular-nums", dispute >= 0.06 ? "font-semibold text-bad" : dispute >= 0.03 ? "text-warn" : "text-faint")}>{dispute ? formatRate(dispute) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
