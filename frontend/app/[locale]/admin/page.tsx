"use client";
/* Hallmark · component: admin ops-desk overview · theme: project Proxora (slate canvas · iris accent) · P4 H5 E4 S5 R4 V4 */

import * as React from "react";
import { Link } from "@/i18n/navigation";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ArrowRight, Check, ChevronDown, RotateCw } from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/admin/status-badge";
import { ALERT_SEVERITY_META, alertTypeLabel, severityRank } from "@/components/admin/alert-meta";
import { vnd } from "@/lib/utils/format";
import type { ActionItem, Alert, Order } from "@/lib/types";

const DONE = new Set(["delivered", "completed", "confirmed"]);
const FAILED = new Set(["cancelled", "refunded"]);
const IN_FLIGHT = new Set(["pending", "processing", "accepted"]);

// Backend trả nhãn tiếng Anh cho các bộ đếm — admin đọc tiếng Việt.
const QUEUE_LABELS: Record<string, string> = {
  admin_open_disputes: "Khiếu nại đang mở",
  admin_marketplace_review: "Khiếu nại chờ sàn phân xử",
  admin_pending_applications: "Đơn đăng ký bán chờ duyệt",
  admin_pending_withdrawals: "Lệnh rút chờ duyệt",
  admin_withdraw_approved: "Lệnh rút đã duyệt, chờ chi",
  admin_pending_tasks: "Tác vụ chờ xử lý",
  admin_needs_setup: "Sản phẩm chưa có nguồn hàng",
};

const ALERT_GROUPS_VISIBLE = 6;
const ALERTS_PER_GROUP = 5;

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

// 14 ngày gần nhất, mỗi ngày tách theo kết cục đơn.
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

type AlertEntry = { item: ActionItem; alert: Alert | undefined };
type AlertGroup = { type: string; severity: string; entries: AlertEntry[]; newest: string | null };

// Cảnh báo lặp theo loại (57 lần "DProxy không phản hồi") → một dòng mỗi loại,
// nặng nhất rồi nhiều nhất lên đầu. Chi tiết mở ra tại chỗ hoặc ở trang Cảnh báo.
function groupAlerts(items: ActionItem[], alerts: Alert[]): AlertGroup[] {
  const byId = new Map(alerts.map((a) => [a.id, a]));
  const groups = new Map<string, AlertGroup>();
  for (const item of items) {
    const alert = byId.get(item.alert_id!);
    const type = alert?.type ?? "other";
    const group = groups.get(type) ?? { type, severity: item.severity, entries: [], newest: null };
    group.entries.push({ item, alert });
    if (severityRank(item.severity) < severityRank(group.severity)) group.severity = item.severity;
    if (alert && (!group.newest || alert.created_at > group.newest)) group.newest = alert.created_at;
    groups.set(type, group);
  }
  for (const group of groups.values()) {
    group.entries.sort((a, b) => (b.alert?.created_at ?? "").localeCompare(a.alert?.created_at ?? ""));
  }
  return [...groups.values()].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || b.entries.length - a.entries.length,
  );
}

function SkeletonLines({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${[70, 45, 60, 52, 66][i % 5]}%` }} />
      ))}
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", ALERT_SEVERITY_META[severity]?.color ?? "bg-slate-300")} />;
}

function CardHead({ title, count, children }: { title: string; count?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-[48px] items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[14px] font-semibold text-slate-900">{title}</h2>
        {count}
      </div>
      {children}
    </div>
  );
}

function HeadLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-indigo-600 hover:text-indigo-700 hover:underline">
      {children} <ArrowRight size={13} />
    </Link>
  );
}

// ─── Dải số liệu: một bề mặt chia ô, không phải 5 thẻ rời ───
function SummaryStrip({ cells, loading }: {
  cells: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "bad" | "warn"; href?: string }[];
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 shadow-sm lg:grid-cols-5">
      {cells.map((cell) => {
        const body = (
          <>
            <p className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-slate-500">{cell.label}</p>
            {loading ? (
              <div className="mt-2 h-6 w-20 animate-pulse rounded bg-slate-100" />
            ) : (
              <p className={cn(
                "mt-1 truncate font-mono text-[18px] font-semibold tabular-nums leading-tight",
                cell.tone === "bad" ? "text-red-600" : cell.tone === "warn" ? "text-amber-700" : "text-slate-900",
              )}>
                {cell.value}
              </p>
            )}
            {cell.sub && !loading && <p className="mt-0.5 truncate text-[12px] text-slate-500">{cell.sub}</p>}
          </>
        );
        // Ô lẻ cuối cùng trên màn hẹp chiếm trọn hàng để lưới không hở.
        const cls = "block min-w-0 bg-white px-4 py-3 max-lg:last:odd:col-span-2";
        return cell.href ? (
          <Link key={cell.label} href={cell.href} className={cn(cls, "transition-colors hover:bg-slate-50")}>{body}</Link>
        ) : (
          <div key={cell.label} className={cls}>{body}</div>
        );
      })}
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
  // Chỉ để biết LOẠI của từng cảnh báo trong hàng đợi (action item không mang type).
  const alertsQ = useQuery({
    queryKey: ["admin", "alerts"],
    queryFn: () => api.adminAlerts(),
    staleTime: 30_000,
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
    queryFn: () => api.adminProducts({ status: "needs_setup", perPage: 1 }),
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

  // Việc có người phải làm (bộ đếm) tách khỏi cảnh báo hệ thống (từng sự cố).
  const tasks = React.useMemo<ActionItem[]>(() => {
    const items = (actionQ.data ?? []).filter((i) => i.alert_id == null);
    const needsSetup = productsQ.data?.counts.needs_setup ?? productsQ.data?.total ?? 0;
    if (needsSetup > 0) {
      items.push({
        key: "admin_needs_setup", severity: "warning", label: "", count: needsSetup,
        href: "/admin/products", dismissible: false, alert_id: null,
      });
    }
    const approved = (withdrawalsQ.data ?? []).filter((w) => w.status === "approved");
    if (approved.length > 0) {
      items.push({
        key: "admin_withdraw_approved", severity: "warning", label: "", count: approved.length,
        href: "/admin/withdrawals", dismissible: false, alert_id: null,
      });
    }
    return items.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  }, [actionQ.data, productsQ.data, withdrawalsQ.data]);

  const alertItems = React.useMemo(() => (actionQ.data ?? []).filter((i) => i.alert_id != null), [actionQ.data]);
  const alertGroups = React.useMemo(() => groupAlerts(alertItems, alertsQ.data ?? []), [alertItems, alertsQ.data]);
  const urgentAlerts = alertItems.filter((i) => severityRank(i.severity) <= 1).length;

  const [openGroup, setOpenGroup] = React.useState<string | null>(null);
  const [showAllGroups, setShowAllGroups] = React.useState(false);
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

  const money = React.useMemo(() => {
    const todayOrders = orders.filter((o) => isToday(o.created_at));
    const weekAgo = Date.now() - 7 * 86_400_000;
    const done7d = orders.filter((o) => DONE.has(o.status) && new Date(o.created_at).getTime() >= weekAgo);
    const approved = (withdrawalsQ.data ?? []).filter((w) => w.status === "approved");
    return {
      todayCount: todayOrders.length,
      todayValue: todayOrders.reduce((s, o) => s + o.total_amount, 0),
      revenue7d: done7d.reduce((s, o) => s + o.total_amount, 0),
      done7d: done7d.length,
      depositToday: (depositsQ.data ?? [])
        .filter((d) => d.paid_at && isToday(d.paid_at))
        .reduce((s, d) => s + (d.paid_amount ?? d.amount), 0),
      withdrawWaiting: approved.reduce((s, w) => s + w.amount, 0),
      withdrawWaitingCount: approved.length,
    };
  }, [orders, depositsQ.data, withdrawalsQ.data]);

  const chartData = React.useMemo(() => buildChartData(orders), [orders]);

  // Đơn cần chú ý: khiếu nại trước, rồi đơn kẹt lâu nhất
  const attention = React.useMemo(() => {
    const stuck = orders
      .filter((o) => IN_FLIGHT.has(o.status))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const disputed = orders.filter((o) => o.status === "disputed");
    return [...disputed, ...stuck].slice(0, 8);
  }, [orders]);

  const providers = providersQ.data ?? [];
  const activeProviders = providers.filter((p) => p.is_active);
  const rs = resourceQ.data;
  const taskTotal = tasks.reduce((s, t) => s + t.count, 0);
  const visibleGroups = showAllGroups ? alertGroups : alertGroups.slice(0, ALERT_GROUPS_VISIBLE);

  return (
    <div className="animate-rise space-y-5">
      <SummaryStrip
        loading={actionQ.isLoading || ordersQ.isLoading}
        cells={[
          {
            label: "Việc chờ xử lý", value: taskTotal, tone: taskTotal > 0 ? "warn" : undefined,
            sub: tasks.length > 0 ? `${tasks.length} nhóm việc` : "Không có gì tồn đọng",
          },
          {
            label: "Cảnh báo đang mở", value: alertItems.length, tone: urgentAlerts > 0 ? "bad" : undefined,
            sub: urgentAlerts > 0 ? `${urgentAlerts} nghiêm trọng / lỗi` : "Không có sự cố nặng",
            href: "/admin/alerts",
          },
          { label: "Đơn hôm nay", value: money.todayCount, sub: vnd(money.todayValue), href: "/admin/orders" },
          { label: "Doanh thu 7 ngày", value: vnd(money.revenue7d), sub: `${money.done7d} đơn hoàn tất` },
          {
            label: "Nạp hôm nay", value: vnd(money.depositToday), href: "/admin/deposits",
            sub: money.withdrawWaitingCount > 0
              ? <span className="text-amber-700">Rút chờ chi {vnd(money.withdrawWaiting)}</span>
              : "Không có lệnh rút chờ chi",
          },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* ══════════ Cột chính: việc phải làm ══════════ */}
        <div className="min-w-0 space-y-5">
          <Card className="p-0">
            <CardHead title="Việc cần xử lý">
              <button
                onClick={() => { actionQ.refetch(); alertsQ.refetch(); }}
                disabled={actionQ.isFetching}
                title="Trang tự làm mới mỗi phút"
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
              >
                <RotateCw size={12} className={actionQ.isFetching ? "animate-spin" : ""} />
                Làm mới
              </button>
            </CardHead>

            {actionQ.isLoading ? (
              <SkeletonLines rows={3} />
            ) : tasks.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-slate-500">Không còn việc tồn đọng — mục mới tự xuất hiện ở đây.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {tasks.map((item) => (
                  <li key={item.key}>
                    <Link href={item.href} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50">
                      <SeverityDot severity={item.severity} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">
                        {QUEUE_LABELS[item.key] ?? item.label}
                      </span>
                      <span className="font-mono text-[13px] font-semibold tabular-nums text-slate-900">{item.count}</span>
                      <ArrowRight size={14} className="shrink-0 text-slate-400 transition-colors group-hover:text-indigo-600" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {/* Cảnh báo hệ thống — gom theo loại */}
            {!actionQ.isLoading && (
              <>
                <div className="flex items-center justify-between gap-3 border-y border-slate-200 bg-slate-50/60 px-4 py-2">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                    Cảnh báo hệ thống
                    {alertItems.length > 0 && <span className="ml-1.5 tabular-nums text-slate-700">{alertItems.length}</span>}
                  </p>
                  <HeadLink href="/admin/alerts">Hộp cảnh báo</HeadLink>
                </div>
                {alertGroups.length === 0 ? (
                  <p className="px-4 py-5 text-[13px] text-slate-500">Không có cảnh báo nào đang mở.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {visibleGroups.map((group) => {
                      const open = openGroup === group.type;
                      const latest = group.entries[0];
                      return (
                        <li key={group.type}>
                          <button
                            type="button"
                            onClick={() => setOpenGroup(open ? null : group.type)}
                            aria-expanded={open}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
                          >
                            <SeverityDot severity={group.severity} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-slate-800">
                                {group.type === "other" ? "Cảnh báo khác" : alertTypeLabel(group.type)}
                              </span>
                              {!open && latest && (
                                <span className="block truncate text-[12px] text-slate-500" title={latest.item.label}>
                                  Mới nhất: {latest.item.label}
                                </span>
                              )}
                            </span>
                            {group.newest && (
                              <span className="hidden shrink-0 text-[12px] tabular-nums text-slate-500 sm:inline">{fmtAge(group.newest)}</span>
                            )}
                            <span className="min-w-[2.5rem] shrink-0 text-right font-mono text-[13px] font-semibold tabular-nums text-slate-900">
                              {group.entries.length}
                            </span>
                            <ChevronDown size={15} className={cn("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
                          </button>
                          {open && (
                            <div className="border-t border-slate-100 bg-slate-50/50 pb-2">
                              <ul>
                                {group.entries.slice(0, ALERTS_PER_GROUP).map(({ item, alert }) => (
                                  <li key={item.key} className="flex items-center gap-3 py-1.5 pl-9 pr-4">
                                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-700" title={item.label}>
                                      {item.label}
                                    </span>
                                    {alert && <span className="shrink-0 text-[11.5px] tabular-nums text-slate-500">{fmtAge(alert.created_at)}</span>}
                                    {item.dismissible && item.alert_id != null && (
                                      <button
                                        onClick={() => dismissAlertItem(item.alert_id!)}
                                        disabled={dismissing.has(item.alert_id)}
                                        title="Đánh dấu đã xử lý"
                                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11.5px] font-medium text-slate-600 transition-colors hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
                                      >
                                        <Check size={11} /> Đã xử lý
                                      </button>
                                    )}
                                    <Link href={item.href} className="shrink-0 text-[12px] font-medium text-indigo-600 hover:underline">
                                      Mở
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                              {group.type !== "other" && (
                                <div className="pl-9 pr-4 pt-1">
                                  <HeadLink href={`/admin/alerts?type=${encodeURIComponent(group.type)}`}>
                                    {group.entries.length > ALERTS_PER_GROUP
                                      ? `Xem cả ${group.entries.length} cảnh báo loại này`
                                      : "Mở trong hộp cảnh báo"}
                                  </HeadLink>
                                </div>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {alertGroups.length > ALERT_GROUPS_VISIBLE && (
                  <button
                    type="button"
                    onClick={() => setShowAllGroups((v) => !v)}
                    className="w-full border-t border-slate-100 px-4 py-2 text-left text-[12.5px] font-medium text-indigo-600 hover:bg-slate-50"
                  >
                    {showAllGroups ? "Thu gọn" : `Hiện thêm ${alertGroups.length - ALERT_GROUPS_VISIBLE} loại cảnh báo`}
                  </button>
                )}
              </>
            )}
          </Card>

          {/* Đơn cần chú ý — khiếu nại & kẹt lâu nhất lên đầu */}
          <Card className="p-0">
            <CardHead title="Đơn cần chú ý" count={attention.length > 0 ? <span className="text-[12px] tabular-nums text-slate-500">{attention.length}</span> : undefined}>
              <HeadLink href="/admin/orders">Tất cả đơn</HeadLink>
            </CardHead>
            {ordersQ.isLoading ? (
              <SkeletonLines rows={3} />
            ) : attention.length === 0 ? (
              <p className="px-4 py-5 text-[13px] text-slate-500">Không có đơn nào đang kẹt hay bị khiếu nại.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/50 text-left text-slate-500">
                      <th className="px-4 py-2 font-medium">Mã đơn</th>
                      <th className="px-4 py-2 font-medium">Sản phẩm</th>
                      <th className="px-4 py-2 font-medium">Người mua</th>
                      <th className="px-4 py-2 text-right font-medium">Giá trị</th>
                      <th className="px-4 py-2 font-medium">Trạng thái</th>
                      <th className="px-4 py-2 text-right font-medium">Đã chờ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attention.map((o) => (
                      <tr key={o.id} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <Link href={`/admin/orders?highlight=${o.id}`} className="font-mono text-indigo-600 hover:underline">
                            {o.order_code}
                          </Link>
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-2.5 font-medium">{o.product_title ?? "—"}</td>
                        <td className="max-w-[180px] truncate px-4 py-2.5 text-slate-600">{o.buyer_email ?? "—"}</td>
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
        </div>

        {/* ══════════ Cột phụ: nhịp đơn + nguồn hàng ══════════ */}
        <div className="min-w-0 space-y-5">
          <Card className="p-0">
            <CardHead title="Nhịp đơn 14 ngày" />
            <div className="px-3 pb-3 pt-2">
              {ordersQ.isLoading ? (
                <SkeletonLines rows={3} />
              ) : (
                <>
                  <div className="h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} barCategoryGap="24%">
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10.5, fill: "#64748b" }} interval={1} />
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
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11.5px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-400" /> Hoàn tất</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-indigo-300" /> Đang chạy</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-red-300" /> Huỷ / khiếu nại</span>
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Nguồn hàng: chỉ liệt kê nguồn đang chạy — nguồn đã tắt gộp thành một dòng */}
          <Card className="p-0">
            <CardHead title="Nguồn hàng">
              <HeadLink href="/admin/providers">Quản lý</HeadLink>
            </CardHead>
            {providersQ.isLoading ? (
              <SkeletonLines rows={3} />
            ) : (
              <div className="px-4 py-3">
                {providers.length === 0 ? (
                  <p className="text-[12.5px] text-slate-500">Chưa kết nối nguồn hàng nào.</p>
                ) : (
                  <>
                    <p className="text-[12.5px] text-slate-600">
                      <span className="font-semibold tabular-nums text-emerald-700">{activeProviders.length}</span> đang chạy
                      {providers.length > activeProviders.length && (
                        <>
                          <span className="text-slate-400"> · </span>
                          <span className="tabular-nums">{providers.length - activeProviders.length}</span> đã tắt
                        </>
                      )}
                    </p>
                    {activeProviders.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {activeProviders.slice(0, 6).map((p) => (
                          <li key={p.id} className="flex items-center gap-2.5 text-[13px]">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                            <span className="min-w-0 flex-1 truncate text-slate-700">{p.name}</span>
                          </li>
                        ))}
                        {activeProviders.length > 6 && (
                          <li className="pl-[18px] text-[12px] text-slate-500">và {activeProviders.length - 6} nguồn khác</li>
                        )}
                      </ul>
                    )}
                  </>
                )}

                {rs && (
                  <Link href="/admin/resources" className="group mt-3 flex items-baseline justify-between gap-2 border-t border-slate-100 pt-3 text-[12.5px]">
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
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
