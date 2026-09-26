"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, vnd } from "@/lib/api";
import { Banner, Card, Spinner, Tag } from "@/components/ui";
import { LedgerReconcilePanel } from "@/features/admin-ledger";
import { Activity, FileText, TrendingUp, Users } from "@/components/Icons";

export default function AdminReportsPage() {
  // Figures are SQL aggregates over every order (days in the browser's time zone).
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Ho_Chi_Minh", []);
  const overviewQ = useQuery({
    queryKey: ["admin", "orders", "overview", timeZone],
    queryFn: () => api.adminOrdersOverview({ tz: timeZone, days: 14 }),
    staleTime: 30_000,
  });
  const overview = overviewQ.data;
  const loading = overviewQ.isPending;

  const m = useMemo(() => {
    const revenue = overview?.done_value ?? 0;
    const doneCount = overview?.done_count ?? 0;
    const allCount = overview?.all_count ?? 0;
    const aov = doneCount ? Math.round(revenue / doneCount) : 0;
    const completion = allCount ? Math.round((doneCount / allCount) * 100) : 0;
    const days = (overview?.daily ?? []).map((day) => ({
      label: new Date(`${day.date}T00:00:00`).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }),
      total: day.done_value,
    }));
    const peak = Math.max(1, ...days.map((d) => d.total));

    return { revenue, aov, completion, doneCount, days, peak };
  }, [overview]);

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
      {overviewQ.isError && <Banner tone="bad">Không tải được số liệu đơn hàng. Thử tải lại trang.</Banner>}
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

      {/* Books check (A3.4) */}
      <LedgerReconcilePanel />

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
