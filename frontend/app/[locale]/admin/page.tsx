"use client";
/* Hallmark · component: admin ops-desk overview · theme: project Proxora (slate canvas · iris accent) · P4 H5 E4 S5 R4 V4 */

import * as React from "react";
import { Link } from "@/i18n/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ArrowRight, Check, RotateCw } from "lucide-react";

import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/admin/status-badge";
import { vnd } from "@/lib/utils/format";
import type { ActionItem, Order } from "@/lib/types";

const DONE = new Set(["delivered", "completed", "confirmed"]);
const FAILED = new Set(["cancelled", "refunded"]);
const IN_FLIGHT = new Set(["pending", "processing", "accepted"]);

const SEVERITY_META: Record<string, { dot: string; rank: number }> = {
  critical: { dot: "bg-red-500", rank: 0 },
  warning: { dot: "bg-amber-400", rank: 1 },
  info: { dot: "bg-slate-300", rank: 2 },
};

function fmtAge(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ`;
  return `${Math.floor(h / 24)} ngày`;
}

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

// 14 ngày gần nhất, mỗi ngày tách theo kết cục đơn — nhìn là biết hôm nào
// bán được và hôm nào toàn đơn hỏng, thay vì một cột tím vô hồn.
function buildChartData(orders: Order[]) {
  const days: { label: string; fullLabel: string; done: number; active: number; failed: number; value: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    const inDay = orders.filter((o) => {
      const t = new Date(o.created_at).getTime();
      return t >= d.getTime() && t < next.getTime();
    });
    days.push({
      label: d.getDate() === 1 || i === 13 ? d.toLocaleDateString("vi-VN", { day: "numeric", month: "numeric" }) : String(d.getDate()),
      fullLabel: d.toLocaleDateString("vi-VN", { weekday: "short", day: "numeric", month: "numeric" }),
      done: inDay.filter((o) => DONE.has(o.status)).length,
      active: inDay.filter((o) => IN_FLIGHT.has(o.status)).length,
      failed: inDay.filter((o) => FAILED.has(o.status) || o.status === "disputed").length,
      value: inDay.reduce((s, o) => s + o.total_amount, 0),
    });
  }
  return days;
}

function SkeletonLines({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded bg-slate-100"
          style={{ width: `${[70, 45, 60, 52, 66][i % 5]}%` }}
        />
      ))}
    </div>
  );
}

export default function AdminOverview() {
  // Hàng đợi công việc — nguồn chính của trang, tự làm mới mỗi phút
  const actionQ = useQuery({
    queryKey: ["admin", "action-items"],
    queryFn: () => api.adminActionItems(),
    refetchInterval: 60_000,
  });
  const ordersQ = useQuery({
    queryKey: ["admin", "orders"],
    queryFn: () => api.adminOrders(),
    staleTime: 30_000,
  });
  const providersQ = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.providers(),
    staleTime: 60_000,
  });
  const resourceQ = useQuery({
    queryKey: ["admin", "resources", "summary"],
    queryFn: () => api.adminResourceSummary(),
    staleTime: 60_000,
  });
  const productsQ = useQuery({
    queryKey: ["admin", "products"],
    queryFn: () => api.adminProducts(),
    staleTime: 60_000,
  });
  const withdrawalsQ = useQuery({
    queryKey: ["admin", "withdrawals"],
    queryFn: () => api.adminWithdrawals(),
    staleTime: 30_000,
  });
  const depositsQ = useQuery({
    queryKey: ["admin", "deposits", "paid"],
    queryFn: () => api.adminDeposits("paid"),
    staleTime: 30_000,
  });

  const orders = React.useMemo(() => ordersQ.data ?? [], [ordersQ.data]);

  // Hàng đợi = backend action-items + 2 mục suy ra từ dữ liệu sẵn có
  // (sản phẩm cần thiết lập, lệnh rút đã duyệt chờ chi) — nghiêm trọng lên đầu.
  const queue = React.useMemo<ActionItem[]>(() => {
    const items: ActionItem[] = [...(actionQ.data ?? [])];
    const needsSetup = (productsQ.data ?? []).filter((p) => p.needs_setup).length;
    if (needsSetup > 0) {
      items.push({
        key: "admin_needs_setup", severity: "warning",
        label: `${needsSetup} sản phẩm cần thiết lập nguồn hàng`,
        count: needsSetup, href: "/admin/products", dismissible: false, alert_id: null,
      });
    }
    const approved = (withdrawalsQ.data ?? []).filter((w) => w.status === "approved");
    if (approved.length > 0) {
      const sum = approved.reduce((s, w) => s + w.amount, 0);
      items.push({
        key: "admin_withdraw_approved", severity: "warning",
        label: `${approved.length} lệnh rút đã duyệt — chờ chi ${vnd(sum)}`,
        count: approved.length, href: "/admin/withdrawals", dismissible: false, alert_id: null,
      });
    }
    return items.sort(
      (a, b) => (SEVERITY_META[a.severity]?.rank ?? 9) - (SEVERITY_META[b.severity]?.rank ?? 9)
    );
  }, [actionQ.data, productsQ.data, withdrawalsQ.data]);

  const [dismissing, setDismissing] = React.useState<Set<number>>(new Set());
  const dismissAlertItem = async (alertId: number) => {
    setDismissing((prev) => new Set(prev).add(alertId));
    try {
      await api.dismissAlert(alertId);
      await actionQ.refetch();
    } finally {
      setDismissing((prev) => {
        const next = new Set(prev);
        next.delete(alertId);
        return next;
      });
    }
  };

  // Sổ quỹ hôm nay — chỉ số thật, tính từ dữ liệu thật
  const money = React.useMemo(() => {
    const todayOrders = orders.filter((o) => isToday(o.created_at));
    const weekAgo = Date.now() - 7 * 86_400_000;
    return {
      todayCount: todayOrders.length,
      todayValue: todayOrders.reduce((s, o) => s + o.total_amount, 0),
      revenue7d: orders
        .filter((o) => DONE.has(o.status) && new Date(o.created_at).getTime() >= weekAgo)
        .reduce((s, o) => s + o.total_amount, 0),
      depositToday: (depositsQ.data ?? [])
        .filter((d) => d.paid_at && isToday(d.paid_at))
        .reduce((s, d) => s + (d.paid_amount ?? d.amount), 0),
      withdrawWaiting: (withdrawalsQ.data ?? [])
        .filter((w) => w.status === "approved")
        .reduce((s, w) => s + w.amount, 0),
    };
  }, [orders, depositsQ.data, withdrawalsQ.data]);

  const chartData = React.useMemo(() => buildChartData(orders), [orders]);

  // Đơn cần chú ý: kẹt lâu nhất lên đầu (pending/processing cũ nhất), rồi khiếu nại
  const attention = React.useMemo(() => {
    const stuck = orders
      .filter((o) => IN_FLIGHT.has(o.status))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const disputed = orders.filter((o) => o.status === "disputed");
    return [...disputed, ...stuck].slice(0, 8);
  }, [orders]);

  const providers = providersQ.data ?? [];
  const rs = resourceQ.data;

  return (
    <div className="animate-rise grid gap-6 lg:grid-cols-[1fr_310px]">
      {/* ══════════ Cột chính ══════════ */}
      <div className="min-w-0 space-y-6">
        {/* Đơn cần chú ý — kẹt lâu nhất lên đầu, không phải "gần đây nhất" */}
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-[14px] font-semibold text-slate-900">Đơn cần chú ý</h2>
            <Link
              href="/admin/orders"
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              Tất cả đơn <ArrowRight size={13} />
            </Link>
          </div>
          {ordersQ.isLoading ? (
            <SkeletonLines rows={4} />
          ) : attention.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-slate-500">
              Không có đơn nào đang kẹt hay bị khiếu nại.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-slate-500">
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">Sản phẩm</th>
                    <th className="px-4 py-2 font-medium">Người mua</th>
                    <th className="px-4 py-2 font-medium text-right">Giá trị</th>
                    <th className="px-4 py-2 font-medium">Trạng thái</th>
                    <th className="px-4 py-2 font-medium text-right">Đã chờ</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.map((o) => (
                    <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5">
                        <Link href={`/admin/orders?highlight=${o.id}`} className="font-mono text-indigo-600 hover:underline">
                          #{o.id}
                        </Link>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-2.5 font-medium">
                        {o.product_title ?? `Variant #${o.variant_id}`}
                      </td>
                      <td className="max-w-[160px] truncate px-4 py-2.5 text-slate-600">
                        {o.buyer_email ?? `#${o.buyer_id}`}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">{vnd(o.total_amount)}</td>
                      <td className="px-4 py-2.5"><OrderStatusBadge status={o.status} /></td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{fmtAge(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {/* Nhịp đơn 14 ngày */}
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <h2 className="text-[14px] font-semibold text-slate-900">Nhịp đơn 14 ngày</h2>
            <div className="flex items-center gap-3 text-[11.5px] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-400" /> Hoàn tất</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-indigo-300" /> Đang chạy</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-red-300" /> Huỷ / khiếu nại</span>
            </div>
          </div>
          <div className="px-4 pb-4 pt-3">
            {ordersQ.isLoading ? (
              <SkeletonLines rows={4} />
            ) : (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} barCategoryGap="28%">
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10.5, fill: "#94a3b8" }}
                      interval={1}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(148, 163, 184, 0.08)" }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="rounded-lg bg-slate-900 px-3 py-2 text-[12px] text-white shadow-lg">
                            <p className="font-medium">{d.fullLabel}</p>
                            <p className="mt-1 text-emerald-300">{d.done} hoàn tất</p>
                            {d.active > 0 && <p className="text-indigo-300">{d.active} đang chạy</p>}
                            {d.failed > 0 && <p className="text-red-300">{d.failed} huỷ / khiếu nại</p>}
                            <p className="mt-1 font-mono text-slate-300">{vnd(d.value)}</p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="done" stackId="a" fill="#34d399" />
                    <Bar dataKey="active" stackId="a" fill="#a5b4fc" />
                    <Bar dataKey="failed" stackId="a" fill="#fca5a5" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </Card>

        {/* Hàng đợi công việc */}
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-[14px] font-semibold text-slate-900">Việc cần xử lý</h2>
              {queue.length > 0 && (
                <span className="tabular-nums text-[12px] font-semibold text-red-600">{queue.length}</span>
              )}
            </div>
            <button
              onClick={() => actionQ.refetch()}
              disabled={actionQ.isFetching}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
            >
              <RotateCw size={12} className={actionQ.isFetching ? "animate-spin" : ""} />
              Làm mới
            </button>
          </div>

          {actionQ.isLoading ? (
            <SkeletonLines rows={3} />
          ) : queue.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[14px] font-medium text-slate-700">Không còn việc tồn đọng 🎉</p>
              <p className="mt-1 text-[12.5px] text-slate-500">
                Mục mới sẽ tự xuất hiện tại đây — trang tự làm mới mỗi phút.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {queue.map((item) => (
                <li key={item.key} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY_META[item.severity]?.dot ?? "bg-slate-300"}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700" title={item.label}>
                    {item.label}
                  </span>
                  {item.dismissible && item.alert_id != null && (
                    <button
                      onClick={() => dismissAlertItem(item.alert_id!)}
                      disabled={dismissing.has(item.alert_id)}
                      title="Đánh dấu đã xử lý"
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11.5px] font-medium text-slate-500 transition-colors hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
                    >
                      <Check size={11} />
                      Đã xử lý
                    </button>
                  )}
                  <Link
                    href={item.href}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-medium text-indigo-600 transition-colors hover:border-indigo-300"
                  >
                    Xử lý
                    <ArrowRight size={12} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

      </div>

      {/* ══════════ Cột phụ: sổ quỹ + nguồn hàng ══════════ */}
      <div className="min-w-0 space-y-6">
        {/* Sổ quỹ hôm nay — kiểu biên lai */}
        <Card className="p-0">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-[14px] font-semibold text-slate-900">Sổ quỹ hôm nay</h2>
          </div>
          {ordersQ.isLoading ? (
            <SkeletonLines rows={4} />
          ) : (
            <dl className="space-y-2.5 px-4 py-3.5 text-[12.5px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">Đơn mới hôm nay</dt>
                <dd className="font-semibold tabular-nums">
                  {money.todayCount}
                  <span className="ml-1.5 font-mono text-slate-500">{vnd(money.todayValue)}</span>
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">Nạp PayOS hôm nay</dt>
                <dd className="font-mono font-semibold tabular-nums text-emerald-700">{vnd(money.depositToday)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">
                  <Link href="/admin/withdrawals" className="hover:text-indigo-600 hover:underline">
                    Rút chờ chi
                  </Link>
                </dt>
                <dd className={`font-mono font-semibold tabular-nums ${money.withdrawWaiting > 0 ? "text-amber-700" : ""}`}>
                  {vnd(money.withdrawWaiting)}
                </dd>
              </div>
              <div className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-dashed border-slate-300 pt-2.5">
                <dt className="text-slate-500">Doanh thu 7 ngày</dt>
                <dd className="font-mono text-[13px] font-semibold tabular-nums">{vnd(money.revenue7d)}</dd>
              </div>
            </dl>
          )}
        </Card>

        {/* Nguồn hàng & tồn kho */}
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-[14px] font-semibold text-slate-900">Nguồn hàng</h2>
            <Link
              href="/admin/providers"
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              Quản lý <ArrowRight size={13} />
            </Link>
          </div>
          {providersQ.isLoading ? (
            <SkeletonLines rows={3} />
          ) : (
            <div className="px-4 py-3">
              {providers.length === 0 ? (
                <p className="py-2 text-[12.5px] text-slate-500">Chưa kết nối nguồn hàng nào.</p>
              ) : (
                <ul className="space-y-2">
                  {providers.map((p) => (
                    <li key={p.id} className="flex items-center gap-2.5 text-[13px]">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${p.is_active ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span className="min-w-0 flex-1 truncate text-slate-700">{p.name}</span>
                      <span className={`text-[11.5px] font-medium ${p.is_active ? "text-emerald-600" : "text-red-600"}`}>
                        {p.is_active ? "Hoạt động" : "Đã tắt"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {rs && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <Link href="/admin/resources" className="group flex items-baseline justify-between text-[12.5px]">
                    <span className="text-slate-500 group-hover:text-indigo-600 group-hover:underline">Kho tài nguyên</span>
                    <span className="tabular-nums">
                      <span className="font-semibold text-emerald-700">{rs.available}</span>
                      <span className="text-slate-400"> sẵn sàng · </span>
                      <span className="font-semibold">{rs.assigned}</span>
                      <span className="text-slate-400"> đang cấp</span>
                      {rs.error > 0 && (
                        <>
                          <span className="text-slate-400"> · </span>
                          <span className="font-semibold text-red-600">{rs.error} lỗi</span>
                        </>
                      )}
                    </span>
                  </Link>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
