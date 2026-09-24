"use client";

import { useMemo } from "react";
import type { BusinessAnalytics } from "@/lib/types";
import { EChart } from "../../chart/EChart";
import { axisValue, baseOption, chartTokens, esc, tipRow, tipTitle, type ChartTokens } from "../../chart/theme";
import { METRIC, SERVICE_LABEL, compactMoney, delta, formatDelta, formatMoney, formatRate, type AnalyticsState } from "../../model";
import { DataTable, DeltaBadge, EmptyChart, Panel } from "../Panel";

type Props = { data: BusinessAnalytics; dimmed?: boolean; onFilter: (patch: Partial<AnalyticsState>) => void };

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, k: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * k);
  return `rgb(${c(r1, r2)},${c(g1, g2)},${c(b1, b2)})`;
}

/** Diverging colour for growth: decline ↔ neutral grey ↔ growth, clamped at ±50%. */
export function growthColor(t: ChartTokens, cur: number, prev: number, hasCompare: boolean): string {
  if (!hasCompare) return t.series[0];
  if (prev <= 0) return cur > 0 ? t.pos : t.mid;
  const g = Math.max(-1, Math.min(1, (cur - prev) / prev / 0.5));
  return g >= 0 ? mix(t.mid, t.pos, g) : mix(t.mid, t.neg, -g);
}

interface TreeNode {
  id: number | null;
  name: string;
  value: number;
  prev: number;
  orders: number;
  refunded: number;
  children: TreeNode[];
}

/** Treemap: area = GMV, colour = growth vs the comparison period. The
 *  shrinking categories jump out in red. */
export function CategoryTreemap({ data, dimmed, onFilter, height = 340 }: Props & { height?: number }) {
  const t = chartTokens();
  const hasCompare = !!data.compare_totals;
  const roots = useMemo(() => {
    const nodes = new Map<number | null, TreeNode>();
    const parentOf = new Map<number, number | null>();
    for (const c of data.category_tree) {
      nodes.set(c.id, { id: c.id, name: c.name, value: 0, prev: 0, orders: 0, refunded: 0, children: [] });
      parentOf.set(c.id, c.parent_id);
    }
    const leaves: TreeNode[] = [];
    for (const r of data.categories) {
      if (r.gmv <= 0 && r.gmv_prev <= 0) continue;
      const leaf: TreeNode = { id: r.id, name: r.name, value: r.gmv, prev: r.gmv_prev, orders: r.paid_orders, refunded: r.refunded, children: [] };
      if (r.id !== null) parentOf.set(r.id, r.parent_id);
      if (r.id !== null && nodes.has(r.id)) {
        // A branch category that also sells directly: keep its own sales as a child tile.
        nodes.get(r.id)!.children.push({ ...leaf, name: `${r.name} (trực tiếp)` });
      } else {
        leaves.push(leaf);
      }
    }
    const top: TreeNode[] = [];
    const attach = (n: TreeNode, parent: number | null | undefined) => {
      if (parent != null && nodes.has(parent)) nodes.get(parent)!.children.push(n);
      else top.push(n);
    };
    for (const leaf of leaves) attach(leaf, leaf.id === null ? null : parentOf.get(leaf.id));
    for (const [id, n] of nodes) attach(n, parentOf.get(id as number));
    const sum = (n: TreeNode): TreeNode => {
      if (n.children.length) {
        n.children = n.children.map(sum).filter((c) => c.value > 0 || c.prev > 0);
        n.value = n.children.reduce((a, c) => a + c.value, 0);
        n.prev = n.children.reduce((a, c) => a + c.prev, 0);
        n.orders = n.children.reduce((a, c) => a + c.orders, 0);
        n.refunded = n.children.reduce((a, c) => a + c.refunded, 0);
      }
      return n;
    };
    return top.map(sum).filter((n) => n.value > 0 || n.prev > 0).sort((a, b) => b.value - a.value);
  }, [data.categories, data.category_tree]);

  const option = useMemo(() => {
    const toEchart = (n: TreeNode): Record<string, unknown> => ({
      name: n.name,
      value: Math.max(n.value, 0.0001),
      id: String(n.id ?? "none"),
      catId: n.id,
      cur: n.value, prev: n.prev, orders: n.orders, refunded: n.refunded,
      itemStyle: { color: growthColor(t, n.value, n.prev, hasCompare) },
      // Saturated tiles (strong growth or decline) take light text.
      ...(hasCompare && (n.prev <= 0 ? n.value > 0 : Math.abs((n.value - n.prev) / n.prev) >= 0.3)
        ? { label: { rich: { n: { color: "#fff" }, v: { color: "rgba(255,255,255,.9)" }, d: { color: "rgba(255,255,255,.8)" } } } }
        : {}),
      children: n.children.length ? n.children.map(toEchart) : undefined,
    });
    const total = roots.reduce((a, n) => a + n.value, 0) || 1;
    return {
      ...baseOption(t),
      tooltip: {
        ...(baseOption(t).tooltip as object),
        formatter: (p: { data: { name: string; cur: number; prev: number; orders: number; refunded: number } }) => {
          const d = p.data;
          const dd = delta(d.cur, d.prev, "up");
          return tipTitle(d.name)
            + tipRow(t.series[0], "GMV kỳ này", `${formatMoney(d.cur)} · ${formatRate(d.cur / total, 0)}`)
            + (hasCompare ? tipRow(t.compare, "Kỳ so sánh", formatMoney(d.prev)) : "")
            + (dd && hasCompare ? `<div style="margin-top:4px;font-weight:600;color:${dd.tone === "bad" ? t.bad : dd.tone === "good" ? t.good : t.faint}">${esc(formatDelta(METRIC.gmv, dd))}</div>` : "")
            + `<div style="margin-top:4px;opacity:.7">${d.orders.toLocaleString("vi-VN")} đơn · hoàn ${compactMoney(d.refunded)}</div>`
            + `<div style="margin-top:4px;opacity:.6;font-size:11px">Bấm để lọc theo danh mục</div>`;
        },
      },
      series: [{
        id: "tree", type: "treemap", roam: false, nodeClick: false, breadcrumb: { show: false },
        top: 0, left: 0, right: 0, bottom: 0, squareRatio: 1.2,
        leafDepth: 2,
        label: {
          show: true, overflow: "truncate", fontSize: 11.5, color: t.fg, lineHeight: 15,
          formatter: (p: { data: { name: string; cur: number; prev: number } }) => {
            const d = delta(p.data.cur, p.data.prev, "up");
            return `{n|${p.data.name}}\n{v|${compactMoney(p.data.cur)}}${hasCompare && d ? `  {d|${formatDelta(METRIC.gmv, d)}}` : ""}`;
          },
          rich: { n: { fontSize: 11.5, fontWeight: 600, color: t.fg }, v: { fontSize: 11, color: t.muted }, d: { fontSize: 10.5, color: t.faint } },
        },
        upperLabel: {
          show: true, height: 20, color: t.fg, fontSize: 11, fontWeight: 600, backgroundColor: "transparent", overflow: "truncate",
          formatter: (p: { data: { name: string; cur: number } }) => `${p.data.name} · ${compactMoney(p.data.cur)}`,
        },
        itemStyle: { borderColor: t.surface, borderWidth: 2, gapWidth: 2, borderRadius: 4 },
        levels: [
          { itemStyle: { borderColor: t.surface, borderWidth: 3, gapWidth: 3 }, upperLabel: { show: false } },
          { itemStyle: { borderColor: t.surface, gapWidth: 2, borderWidth: 2 } },
          { itemStyle: { gapWidth: 1 } },
        ],
        emphasis: { itemStyle: { borderColor: t.fg, borderWidth: 1 }, upperLabel: { show: true } },
        animationDurationUpdate: 600,
        data: roots.map(toEchart),
      }],
    };
  }, [roots, t, hasCompare]);

  const onEvents = useMemo(() => ({
    click: (p: unknown) => {
      const id = (p as { data?: { catId?: number | null } }).data?.catId;
      if (id) onFilter({ categoryId: id });
    },
  }), [onFilter]);

  const flat = data.categories.filter((r) => r.gmv > 0 || r.gmv_prev > 0);
  return (
    <Panel
      title="Bản đồ danh mục"
      subtitle={hasCompare ? "Diện tích = GMV · màu = tăng trưởng so với kỳ so sánh (đỏ giảm, xanh tăng)" : "Diện tích = GMV"}
      legend={hasCompare ? [
        { label: "Giảm ≥ 50%", color: t.neg },
        { label: "Đi ngang", color: t.mid },
        { label: "Tăng ≥ 50%", color: t.pos },
      ] : undefined}
      table={
        <DataTable
          head={["Danh mục", "GMV", "Kỳ trước", "Thay đổi", "Đơn", "Hoàn tiền", "Doanh thu sàn"]}
          rows={flat.map((r) => {
            const d = delta(r.gmv, r.gmv_prev, "up");
            return [r.name, formatMoney(r.gmv), formatMoney(r.gmv_prev), d ? formatDelta(METRIC.gmv, d) : "—", r.paid_orders.toLocaleString("vi-VN"), formatMoney(r.refunded), formatMoney(r.platform_take)];
          })}
        />
      }
    >
      {roots.length === 0 ? <EmptyChart height={height} /> : <EChart option={option} height={height} label="Bản đồ GMV theo danh mục" onEvents={onEvents} dimmed={dimmed} />}
    </Panel>
  );
}

export function ServiceTypeChart({ data, dimmed, onFilter }: Props) {
  const t = chartTokens();
  const hasCompare = !!data.compare_totals;
  const rows = useMemo(() => data.service_types.filter((r) => r.gmv > 0 || r.gmv_prev > 0).slice(0, 8).reverse(), [data.service_types]);
  const option = useMemo(() => ({
    ...baseOption(t),
    grid: { left: 8, right: 56, top: 8, bottom: 4, containLabel: true },
    tooltip: {
      ...(baseOption(t).tooltip as object), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(79,70,229,0.06)" } },
      formatter: (ps: { dataIndex: number }[]) => {
        const r = rows[ps[0]?.dataIndex ?? 0];
        return tipTitle(SERVICE_LABEL[r.service_type] ?? r.service_type)
          + tipRow(t.series[0], "Kỳ này", formatMoney(r.gmv))
          + (hasCompare ? tipRow(t.compare, "Kỳ so sánh", formatMoney(r.gmv_prev)) : "")
          + `<div style="margin-top:4px;opacity:.7">${r.paid_orders.toLocaleString("vi-VN")} đơn · doanh thu sàn ${compactMoney(r.platform_take)}</div>`;
      },
    },
    xAxis: axisValue(t, compactMoney),
    yAxis: { type: "category", data: rows.map((r) => SERVICE_LABEL[r.service_type] ?? r.service_type), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 12 } },
    series: [
      ...(hasCompare ? [{ id: "prev", name: "Kỳ so sánh", type: "bar", barWidth: 6, data: rows.map((r) => r.gmv_prev), itemStyle: { color: t.compare, borderRadius: [0, 3, 3, 0] }, barGap: "30%" }] : []),
      {
        id: "cur", name: "Kỳ này", type: "bar", barWidth: 12, data: rows.map((r) => r.gmv), itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: t.muted, fontSize: 11, formatter: (p: { value: number }) => compactMoney(p.value) },
      },
    ],
  }), [rows, t, hasCompare]);
  const onEvents = useMemo(() => ({
    click: (p: unknown) => {
      const r = rows[(p as { dataIndex: number }).dataIndex];
      if (r) onFilter({ serviceType: r.service_type });
    },
  }), [rows, onFilter]);
  return (
    <Panel
      title="Theo loại dịch vụ"
      subtitle="Bấm một thanh để lọc"
      legend={[{ label: "Kỳ này", color: t.series[0] }, ...(hasCompare ? [{ label: "Kỳ so sánh", color: t.compare }] : [])]}
      table={
        <DataTable
          head={["Loại", "GMV", "Kỳ trước", "Đơn", "Doanh thu sàn"]}
          rows={[...rows].reverse().map((r) => [SERVICE_LABEL[r.service_type] ?? r.service_type, formatMoney(r.gmv), formatMoney(r.gmv_prev), r.paid_orders.toLocaleString("vi-VN"), formatMoney(r.platform_take)])}
        />
      }
    >
      {rows.length === 0 ? <EmptyChart height={240} /> : <EChart option={option} height={Math.max(200, rows.length * 38 + 30)} label="GMV theo loại dịch vụ" onEvents={onEvents} dimmed={dimmed} />}
    </Panel>
  );
}

export function ProductsTable({ data }: { data: BusinessAnalytics }) {
  const max = Math.max(1, ...data.top_products.map((p) => p.gmv));
  const hasCompare = !!data.compare_totals;
  return (
    <Panel title="Sản phẩm bán chạy" subtitle={`Top ${data.top_products.length} theo GMV trong kỳ`}>
      {data.top_products.length === 0 ? <EmptyChart height={200} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] text-faint">
                <th className="w-8 py-2 pr-2 font-medium">#</th>
                <th className="py-2 pr-2 font-medium">Sản phẩm</th>
                <th className="py-2 pr-2 text-right font-medium">GMV</th>
                {hasCompare && <th className="py-2 pr-2 text-right font-medium">Thay đổi</th>}
                <th className="py-2 pr-2 text-right font-medium">Đơn</th>
                <th className="py-2 text-right font-medium">Hoàn tiền</th>
              </tr>
            </thead>
            <tbody>
              {data.top_products.map((p, i) => (
                <tr key={p.id ?? i} className="border-b border-line/70 last:border-0">
                  <td className="py-2 pr-2 font-mono text-faint">{i + 1}</td>
                  <td className="max-w-[280px] py-2 pr-2">
                    <p className="truncate font-medium text-fg" title={p.title}>{p.title}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="h-1 overflow-hidden rounded-full bg-raised" style={{ width: 120 }}>
                        <span className="block h-full rounded-full bg-iris transition-[width] duration-700" style={{ width: `${(p.gmv / max) * 100}%` }} />
                      </span>
                      <span className="text-[11px] text-faint">{SERVICE_LABEL[p.service_type] ?? p.service_type}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-right font-mono tabular-nums">{compactMoney(p.gmv)}</td>
                  {hasCompare && <td className="py-2 pr-2 text-right"><DeltaBadge def={METRIC.gmv} d={delta(p.gmv, p.gmv_prev, "up")} /></td>}
                  <td className="py-2 pr-2 text-right font-mono tabular-nums">{p.paid_orders.toLocaleString("vi-VN")}</td>
                  <td className={`py-2 text-right font-mono tabular-nums ${p.gmv && p.refunded / p.gmv >= 0.05 ? "text-bad" : "text-faint"}`}>
                    {p.refunded ? formatRate(p.refunded / Math.max(1, p.gmv)) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
