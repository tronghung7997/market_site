"use client";

import { useEffect, useMemo, useState } from "react";
import { api, vnd } from "@/lib/api";
import { Card, Spinner, Tag } from "@/components/ui";
import { Activity, FileText, TrendingUp, Users } from "@/components/Icons";
import type { Order } from "@/lib/types";

const DONE = new Set(["delivered", "completed", "confirmed"]);

export default function AdminReportsPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.adminOrders().then(setOrders).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const m = useMemo(() => {
    const done = orders.filter((o) => DONE.has(o.status));
    const revenue = done.reduce((s, o) => s + o.total_amount, 0);
    const aov = done.length ? Math.round(revenue / done.length) : 0;
    const completion = orders.length ? Math.round((done.length / orders.length) * 100) : 0;

    // 14-day revenue
    const days: { label: string; total: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      const total = done
        .filter((o) => {
          const t = new Date(o.created_at).getTime();
          return t >= d.getTime() && t < next.getTime();
        })
        .reduce((s, o) => s + o.total_amount, 0);
      days.push({ label: d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }), total });
    }
    const peak = Math.max(1, ...days.map((d) => d.total));

    return { revenue, aov, completion, doneCount: done.length, days, peak };
  }, [orders]);

  if (loading) return <Spinner label="Đang tổng hợp báo cáo…" />;

  const summary = [
    { label: "Tổng doanh thu", value: vnd(m.revenue), icon: TrendingUp, tone: "good" as const },
    { label: "Giá trị đơn TB", value: vnd(m.aov), icon: Activity, tone: "iris" as const },
    { label: "Tỷ lệ hoàn tất", value: `${m.completion}%`, icon: FileText, tone: "warn" as const },
    { label: "Đơn hoàn tất", value: m.doneCount.toLocaleString("vi-VN"), icon: Users, tone: "iris" as const },
  ];
  const toneText: Record<string, string> = { iris: "text-iris-hi", good: "text-good", warn: "text-warn" };
  const toneBg: Record<string, string> = { iris: "bg-iris-soft", good: "bg-good-soft", warn: "bg-warn-soft" };

  const upcoming = [
    { title: "Báo cáo nhà cung cấp", desc: "Uptime, độ trễ trung bình và tỷ lệ thành công theo từng provider." },
    { title: "Báo cáo người dùng", desc: "Tăng trưởng tài khoản, người mua/người bán hoạt động theo thời gian." },
    { title: "Xuất dữ liệu CSV", desc: "Tải toàn bộ đơn hàng & giao dịch theo khoảng thời gian tùy chọn." },
  ];

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.label} className="p-5">
            <div className="flex items-center gap-3">
              <span className={`grid place-items-center h-10 w-10 shrink-0 rounded-lg ${toneBg[s.tone]} ${toneText[s.tone]}`}>
                <s.icon size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-[12px] text-muted">{s.label}</p>
                <p className="mt-1 font-mono text-[18px] font-semibold tabular truncate">{s.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* 14-day revenue */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-[14px] font-semibold">Doanh thu 14 ngày</h2>
            <p className="text-[12px] text-muted mt-0.5">Đơn đã giao &amp; hoàn tất</p>
          </div>
          <Tag tone="good">{vnd(m.revenue)}</Tag>
        </div>
        <div className="flex items-end justify-between gap-1.5 h-44">
          {m.days.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-2 group">
              <span className="text-[10px] font-mono text-muted opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                {d.total > 0 ? vnd(d.total) : "—"}
              </span>
              <div className="w-full flex items-end justify-center" style={{ height: "130px" }}>
                <div
                  className="w-full max-w-[26px] rounded-t-md bg-good/75 hover:bg-good transition-all"
                  style={{ height: `${Math.max(3, (d.total / m.peak) * 100)}%` }}
                />
              </div>
              <span className="text-[9.5px] text-faint whitespace-nowrap">{d.label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Upcoming reports — extensibility */}
      <div>
        <h2 className="text-[14px] font-semibold mb-3">Báo cáo khác</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {upcoming.map((r) => (
            <Card key={r.title} className="p-5 border-dashed">
              <div className="flex items-center justify-between mb-2">
                <span className="grid place-items-center h-9 w-9 rounded-lg bg-raised text-faint">
                  <FileText size={17} />
                </span>
                <Tag tone="neutral">Sắp ra mắt</Tag>
              </div>
              <h3 className="text-[13.5px] font-semibold mt-2">{r.title}</h3>
              <p className="text-[12.5px] text-muted mt-1 leading-relaxed">{r.desc}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
