"use client";

import { useMemo } from "react";
import type { BusinessAnalytics } from "@/lib/types";
import { EChart } from "../../chart/EChart";
import { SERIES_SLOT, axisCategory, axisValue, baseOption, chartTokens, tipRow, tipTitle } from "../../chart/theme";
import { METRIC, bucketLabel, bucketTitle, compactMoney, delta, formatMoney, formatRate } from "../../model";
import { AnimatedNumber } from "../KpiStrip";
import { DataTable, DeltaBadge, EmptyChart, Panel } from "../Panel";

type Props = { data: BusinessAnalytics; dimmed?: boolean };

/** Where platform money comes from: partner fees vs internal sales, minus
 *  affiliate payouts (drawn below zero). One money axis. */
export function RevenueMixChart({ data, dimmed }: Props) {
  const t = chartTokens();
  const g = data.range.granularity;
  const option = useMemo(() => {
    const labels = data.series.map((p) => bucketLabel(p.date, g));
    const stackBar = (id: string, name: string, slot: number, values: number[], top: boolean) => ({
      id, name, type: "bar", stack: "rev", barMaxWidth: 28, data: values,
      itemStyle: { color: t.series[slot], borderColor: t.surface, borderWidth: 1, borderRadius: top ? [4, 4, 0, 0] : 0 },
      emphasis: { focus: "series" },
    });
    return {
      ...baseOption(t),
      tooltip: {
        ...(baseOption(t).tooltip as object), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(79,70,229,0.06)" } },
        formatter: (ps: { dataIndex: number }[]) => {
          const p = data.series[ps[0]?.dataIndex ?? 0];
          return tipTitle(bucketTitle(p, g))
            + tipRow(t.fg, "Doanh thu sàn", formatMoney(p.platform_revenue))
            + tipRow(t.series[SERIES_SLOT.fee], "Phí sàn", formatMoney(p.platform_fee))
            + tipRow(t.series[SERIES_SLOT.internalSales], "Doanh số nội bộ", formatMoney(p.internal_sales))
            + (p.affiliate_cost ? tipRow(t.series[SERIES_SLOT.affiliate], "Hoa hồng affiliate", `−${formatMoney(p.affiliate_cost)}`) : "")
            + `<div style="margin-top:6px;opacity:.7">Take rate ${formatRate(p.gmv ? p.platform_revenue / p.gmv : 0)}</div>`;
        },
      },
      xAxis: axisCategory(t, labels),
      yAxis: axisValue(t, compactMoney),
      series: [
        stackBar("fee", "Phí sàn", SERIES_SLOT.fee, data.series.map((p) => p.platform_fee), false),
        stackBar("internal", "Doanh số nội bộ", SERIES_SLOT.internalSales, data.series.map((p) => p.internal_sales), true),
        {
          id: "affiliate", name: "Hoa hồng affiliate", type: "bar", stack: "cost", barMaxWidth: 28, barGap: "-100%",
          data: data.series.map((p) => -p.affiliate_cost),
          itemStyle: { color: t.series[SERIES_SLOT.affiliate], borderRadius: [0, 0, 4, 4] },
        },
      ],
    };
  }, [data, g, t]);
  const empty = data.series.every((p) => !p.platform_fee && !p.internal_sales && !p.affiliate_cost);
  const tot = data.totals;
  return (
    <Panel
      title="Cơ cấu doanh thu sàn"
      subtitle="Theo thời điểm giải ngân ký quỹ. Hoa hồng affiliate là chi phí, vẽ dưới trục 0."
      legend={[
        { label: "Phí sàn (seller đối tác)", color: t.series[SERIES_SLOT.fee] },
        { label: "Doanh số seller nội bộ", color: t.series[SERIES_SLOT.internalSales] },
        { label: "Hoa hồng affiliate", color: t.series[SERIES_SLOT.affiliate] },
      ]}
      table={
        <DataTable
          head={["Mốc", "Phí sàn", "Nội bộ", "Affiliate", "Doanh thu sàn", "Take rate"]}
          rows={data.series.map((p) => [
            bucketTitle(p, g), formatMoney(p.platform_fee), formatMoney(p.internal_sales), formatMoney(p.affiliate_cost),
            formatMoney(p.platform_revenue), formatRate(p.gmv ? p.platform_revenue / p.gmv : 0),
          ])}
        />
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Doanh thu sàn", tot.platform_revenue, data.compare_totals?.platform_revenue],
          ["Phí sàn", tot.platform_fee, data.compare_totals?.platform_fee],
          ["Doanh số nội bộ", tot.internal_sales, data.compare_totals?.internal_sales],
          ["Phí rút tiền", tot.withdraw_fees, data.compare_totals?.withdraw_fees],
        ].map(([label, v, p]) => (
          <div key={label as string} className="rounded-lg bg-raised/60 px-3 py-2">
            <p className="text-[11px] text-faint">{label}</p>
            <p className="mt-0.5 flex items-center gap-1.5">
              <AnimatedNumber value={v as number} format={compactMoney} className="text-[15px] font-semibold text-fg" />
              <DeltaBadge def={METRIC.platform_revenue} d={delta(v as number, p as number | undefined, "up")} />
            </p>
          </div>
        ))}
      </div>
      {empty ? <EmptyChart height={260} text="Chưa có khoản giải ngân nào trong kỳ" /> : <EChart option={option} height={260} label="Cơ cấu doanh thu sàn theo mốc" dimmed={dimmed} />}
    </Panel>
  );
}

/** Internal vs partner sellers: share of GMV over time + the headline split. */
export function SegmentChart({ data, dimmed, compact }: Props & { compact?: boolean }) {
  const t = chartTokens();
  const g = data.range.granularity;
  const seg = (k: "internal" | "external") => data.segments.find((s) => s.segment === k);
  const internal = seg("internal");
  const external = seg("external");
  const total = (internal?.gmv ?? 0) + (external?.gmv ?? 0);
  const option = useMemo(() => {
    const labels = data.series.map((p) => bucketLabel(p.date, g));
    const share = (p: (typeof data.series)[number], k: "internal" | "external") => {
      if (!p.gmv) return 0;
      const v = k === "internal" ? p.internal_gmv : p.gmv - p.internal_gmv;
      return +(v / p.gmv * 100).toFixed(2);
    };
    const area = (k: "internal" | "external", name: string) => ({
      id: k, name, type: "line", stack: "share", smooth: 0.3, symbol: "none",
      lineStyle: { width: 1.5, color: t.series[SERIES_SLOT[k]] },
      areaStyle: { color: t.series[SERIES_SLOT[k]], opacity: 0.22 },
      data: data.series.map((p) => share(p, k)),
    });
    return {
      ...baseOption(t),
      tooltip: {
        ...(baseOption(t).tooltip as object), trigger: "axis",
        formatter: (ps: { dataIndex: number }[]) => {
          const p = data.series[ps[0]?.dataIndex ?? 0];
          return tipTitle(bucketTitle(p, g))
            + tipRow(t.series[SERIES_SLOT.external], "Seller đối tác", `${compactMoney(p.gmv - p.internal_gmv)} · ${share(p, "external")}%`)
            + tipRow(t.series[SERIES_SLOT.internal], "Seller nội bộ", `${compactMoney(p.internal_gmv)} · ${share(p, "internal")}%`);
        },
      },
      xAxis: axisCategory(t, labels, { boundaryGap: false }),
      yAxis: axisValue(t, (v) => `${v}%`, { max: 100 }),
      series: [area("external", "Seller đối tác"), area("internal", "Seller nội bộ")],
    };
  }, [data, g, t]);

  const rows = [
    { key: "external" as const, label: "Seller đối tác", row: external },
    { key: "internal" as const, label: "Seller nội bộ", row: internal },
  ];
  return (
    <Panel
      title="Seller nội bộ vs đối tác"
      subtitle="Tỷ trọng GMV theo mốc — nội bộ bán ở 0% phí, toàn bộ doanh số là của sàn."
      legend={[
        { label: "Seller đối tác", color: t.series[SERIES_SLOT.external] },
        { label: "Seller nội bộ", color: t.series[SERIES_SLOT.internal] },
      ]}
      table={
        <DataTable
          head={["Phân khúc", "GMV", "Kỳ trước", "Tỷ trọng", "Đơn", "Doanh thu sàn", "Hoàn tiền"]}
          rows={rows.map(({ label, row }) => [
            label, formatMoney(row?.gmv ?? 0), formatMoney(row?.gmv_prev ?? 0), formatRate(total ? (row?.gmv ?? 0) / total : 0),
            (row?.paid_orders ?? 0).toLocaleString("vi-VN"), formatMoney(row?.platform_take ?? 0), formatMoney(row?.refunded ?? 0),
          ])}
        />
      }
    >
      {/* Headline split as a single share bar (a 2-slice pie hides the gap). */}
      <div className="mb-3">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-raised" role="img" aria-label="Tỷ trọng GMV nội bộ và đối tác">
          {rows.map(({ key, row }) => (
            <div
              key={key}
              className="h-full transition-[width] duration-700 ease-out first:rounded-l-full last:rounded-r-full [&+&]:border-l-2 [&+&]:border-surface"
              style={{ width: `${total ? ((row?.gmv ?? 0) / total) * 100 : 0}%`, background: t.series[SERIES_SLOT[key]] }}
            />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {rows.map(({ key, label, row }) => (
            <div key={key} className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11.5px] text-faint">
                <span className="h-2 w-2 rounded-[3px]" style={{ background: t.series[SERIES_SLOT[key]] }} /> {label}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[15px] font-semibold text-fg">{compactMoney(row?.gmv ?? 0)}</span>
                <span className="text-[12px] text-faint">{formatRate(total ? (row?.gmv ?? 0) / total : 0, 0)}</span>
                <DeltaBadge def={METRIC.gmv} d={data.compare_totals ? delta(row?.gmv ?? 0, row?.gmv_prev ?? 0, "up") : null} />
              </p>
              {!compact && (
                <p className="mt-0.5 text-[11.5px] text-faint">
                  {(row?.paid_orders ?? 0).toLocaleString("vi-VN")} đơn · doanh thu sàn {compactMoney(row?.platform_take ?? 0)}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
      {total === 0 ? <EmptyChart height={compact ? 150 : 220} /> : <EChart option={option} height={compact ? 150 : 220} label="Tỷ trọng GMV nội bộ và đối tác theo mốc" dimmed={dimmed} />}
    </Panel>
  );
}

/** Money in (gateway deposits) vs money out (paid withdrawals), mirrored. */
export function CashflowChart({ data, dimmed }: Props) {
  const t = chartTokens();
  const g = data.range.granularity;
  const option = useMemo(() => {
    const labels = data.series.map((p) => bucketLabel(p.date, g));
    return {
      ...baseOption(t),
      tooltip: {
        ...(baseOption(t).tooltip as object), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(79,70,229,0.06)" } },
        formatter: (ps: { dataIndex: number }[]) => {
          const p = data.series[ps[0]?.dataIndex ?? 0];
          const net = p.deposits - p.withdrawals_paid;
          return tipTitle(bucketTitle(p, g))
            + tipRow(t.series[SERIES_SLOT.deposits], "Tiền nạp", formatMoney(p.deposits))
            + tipRow(t.series[SERIES_SLOT.withdrawals], "Tiền rút đã chi", formatMoney(p.withdrawals_paid))
            + `<div style="margin-top:6px;font-weight:600;color:${net >= 0 ? t.good : t.bad}">Ròng ${net >= 0 ? "+" : "−"}${formatMoney(Math.abs(net))}</div>`
            + `<div style="opacity:.7">${p.signups.toLocaleString("vi-VN")} đăng ký mới</div>`;
        },
      },
      xAxis: axisCategory(t, labels),
      yAxis: axisValue(t, compactMoney),
      series: [
        { id: "in", name: "Tiền nạp", type: "bar", stack: "cash", barMaxWidth: 26, data: data.series.map((p) => p.deposits), itemStyle: { color: t.series[SERIES_SLOT.deposits], borderRadius: [4, 4, 0, 0] } },
        { id: "out", name: "Tiền rút", type: "bar", stack: "cash", barMaxWidth: 26, data: data.series.map((p) => -p.withdrawals_paid), itemStyle: { color: t.series[SERIES_SLOT.withdrawals], borderRadius: [0, 0, 4, 4] } },
      ],
    };
  }, [data, g, t]);
  const empty = data.series.every((p) => !p.deposits && !p.withdrawals_paid);
  const net = data.totals.deposits - data.totals.withdrawals_paid;
  return (
    <Panel
      title="Dòng tiền nạp / rút"
      subtitle={`Toàn sàn, không theo bộ lọc seller/danh mục · ròng ${net >= 0 ? "+" : "−"}${compactMoney(Math.abs(net))}`}
      legend={[
        { label: "Tiền nạp (cổng thanh toán)", color: t.series[SERIES_SLOT.deposits] },
        { label: "Tiền rút đã chi", color: t.series[SERIES_SLOT.withdrawals] },
      ]}
      table={
        <DataTable
          head={["Mốc", "Nạp", "Rút đã chi", "Ròng", "Đăng ký"]}
          rows={data.series.map((p) => [bucketTitle(p, g), formatMoney(p.deposits), formatMoney(p.withdrawals_paid), formatMoney(p.deposits - p.withdrawals_paid), p.signups.toLocaleString("vi-VN")])}
        />
      }
    >
      {empty ? <EmptyChart height={240} /> : <EChart option={option} height={240} label="Dòng tiền nạp và rút theo mốc" dimmed={dimmed} />}
    </Panel>
  );
}
