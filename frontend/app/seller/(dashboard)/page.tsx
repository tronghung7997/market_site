"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, vnd } from "@/lib/api";
import type { Order, SellerStats } from "@/lib/types";
import { Button, Card, Spinner } from "@/components/ui";
import { BarChart as BarIcon, Check, Clock, Inbox, Package, Plus } from "@/components/Icons";

const DONE = new Set(["delivered", "completed", "confirmed"]);

/* Real revenue for the last 7 days, from delivered/completed orders */
function build7DayRevenue(orders: Order[]) {
  const days: { label: string; full: string; value: number }[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    const value = orders
      .filter((o) => {
        if (!DONE.has(o.status)) return false;
        const t = new Date(o.created_at).getTime();
        return t >= d.getTime() && t < next.getTime();
      })
      .reduce((s, o) => s + o.total_amount, 0);
    days.push({
      label: d.toLocaleDateString("vi-VN", { weekday: "short" }),
      full: d.toLocaleDateString("vi-VN", { day: "numeric", month: "short" }),
      value,
    });
  }
  return days;
}

export default function SellerDashboard() {
  const [stats, setStats] = useState<SellerStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([api.sellerStats(), api.sellerOrders()])
      .then(([s, o]) => {
        if (s.status === "fulfilled") setStats(s.value);
        if (o.status === "fulfilled") setOrders(o.value);
      })
      .finally(() => setLoading(false));
  }, []);

  const revenue = useMemo(() => build7DayRevenue(orders), [orders]);
  const peak = useMemo(() => Math.max(1, ...revenue.map((d) => d.value)), [revenue]);

  // Real order-status breakdown from the orders list
  const breakdown = useMemo(() => {
    const count = (s: string) => orders.filter((o) => o.status === s).length;
    return {
      pending: count("pending"),
      processing: count("processing"),
      delivered: count("delivered"),
      completed: count("completed"),
    };
  }, [orders]);

  if (loading) return <Spinner />;

  const total = stats?.total_orders ?? 0;
  const pending = stats?.pending_orders ?? 0;
  const completed = Math.max(0, total - pending);
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Quick actions */}
      <div className="flex flex-wrap justify-end gap-3">
        <Link href="/seller/products/new">
          <Button><Plus size={15} /> Tạo sản phẩm mới</Button>
        </Link>
        <Link href="/seller/orders">
          <Button variant="secondary"><Inbox size={15} /> Xem đơn hàng</Button>
        </Link>
        <Link href="/seller/products">
          <Button variant="secondary"><Package size={15} /> Quản lý sản phẩm</Button>
        </Link>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Package} label="Tổng sản phẩm" value={String(stats?.product_count ?? 0)} sub={`${stats?.active_count ?? 0} đang bán`} />
        <StatCard icon={Inbox} label="Tổng đơn hàng" value={String(total)} sub={pending ? `${pending} chờ xử lý` : "Không có đơn chờ"} tone={pending ? "warn" : undefined} />
        <StatCard icon={BarIcon} label="Doanh thu" value={vnd(stats?.total_revenue ?? 0)} sub="Tổng doanh thu đã giao" />
        <StatCard icon={Check} label="Tỷ lệ hoàn thành" value={`${completionRate}%`} sub={`${completed}/${total} đơn`} tone={completionRate < 50 && total > 0 ? "warn" : undefined} />
      </div>

      {/* Revenue chart + Order breakdown */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-[13px] font-semibold mb-4 flex items-center gap-2">
            <BarIcon size={14} className="text-faint" /> Doanh thu 7 ngày
          </h3>
          <div className="h-[180px]">
            {revenue.every((d) => d.value === 0) ? (
              <div className="h-full grid place-items-center text-[13px] text-muted">
                Chưa có doanh thu trong 7 ngày qua.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenue} barCategoryGap="28%">
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ fill: "rgba(79,70,229,0.06)" }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const d = payload[0].payload;
                        return (
                          <div className="bg-slate-900 text-white px-3 py-2 rounded-lg text-[12px] shadow-lg">
                            <p className="font-medium">{d.full}</p>
                            <p className="text-slate-300">{vnd(d.value)}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {revenue.map((entry, i) => (
                      <Cell key={i} fill={entry.value === peak ? "#4f46e5" : "#c7d2fe"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Order status breakdown */}
        <Card className="p-5">
          <h3 className="text-[13px] font-semibold mb-4 flex items-center gap-2">
            <Clock size={14} className="text-faint" /> Đơn hàng theo trạng thái
          </h3>
          <OrderBreakdown {...breakdown} total={orders.length} />
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, tone }: {
  icon: typeof Package; label: string; value: string; sub: string; tone?: "warn";
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-[12px] text-faint mb-3">
        <Icon size={14} /> {label}
      </div>
      <div className="font-mono text-[24px] font-semibold tabular">{value}</div>
      <div className={`text-[12px] mt-1 ${tone === "warn" ? "text-warn font-medium" : "text-muted"}`}>{sub}</div>
    </Card>
  );
}

/* Order status breakdown — real counts */
function OrderBreakdown({ pending, processing, delivered, completed, total }: {
  pending: number; processing: number; delivered: number; completed: number; total: number;
}) {
  const items = [
    { label: "Chờ xử lý", count: pending, color: "var(--color-warn)" },
    { label: "Đang xử lý", count: processing, color: "var(--color-iris-hi)" },
    { label: "Đã giao", count: delivered, color: "var(--color-good)" },
    { label: "Hoàn thành", count: completed, color: "var(--color-good)" },
  ];
  const shown = total > 0 ? total : items.reduce((s, it) => s + it.count, 0);

  return (
    <div className="space-y-4">
      {shown > 0 ? (
        <div className="flex h-[10px] rounded-full overflow-hidden bg-raised">
          {items.map((it, i) =>
            it.count > 0 ? (
              <div key={i} style={{ width: `${(it.count / shown) * 100}%`, background: it.color }} className="transition-all" />
            ) : null,
          )}
        </div>
      ) : (
        <div className="text-[13px] text-muted">Chưa có đơn hàng nào.</div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: it.color }} />
            <span className="text-[12px] text-muted">{it.label}</span>
            <span className="text-[13px] font-mono font-semibold ml-auto tabular">{it.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
