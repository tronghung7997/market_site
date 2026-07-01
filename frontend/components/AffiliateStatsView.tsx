"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AffiliateStats } from "@/lib/types";
import { vnd, formatDate } from "@/lib/utils";
import { StatsCard } from "@/components/admin/stats-card";
import { Card } from "@/components/ui/card";
import { CardHeader } from "@/components/ui/card";
import { CardTitle } from "@/components/ui/card";
import { CardContent } from "@/components/ui/card";

export function AffiliateStatsView({ data }: { data: AffiliateStats }) {
  const { totals, timeseries, commissions, code, link } = data;

  const copyLink = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(link).catch(() => {});
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[13px] text-muted mb-1">Liên kết giới thiệu</p>
            <p className="font-mono text-[14px] text-iris-hi break-all">{link}</p>
          </div>
          <button
            onClick={copyLink}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-default bg-white px-3 py-2 text-[13px] font-medium hover:bg-raised transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Sao chép
          </button>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard label="Lượt nhấp" value={totals.clicks} tone="neutral" />
        <StatsCard label="Đăng ký" value={totals.signups} tone="good" />
        <StatsCard label="Đơn hàng" value={totals.orders} tone="good" />
        <StatsCard label="Hoa hồng" value={vnd(totals.commission)} tone="good" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Theo ngày</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeseries}>
                <defs>
                  <linearGradient id="commGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis hide />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="bg-slate-900 text-white px-3 py-2 rounded-lg text-[12px] shadow-lg">
                          <p className="font-medium">{d.date}</p>
                          <p className="text-slate-300">Nhấp: {d.clicks} · Đăng ký: {d.signups}</p>
                          <p className="text-slate-300">Đơn: {d.orders} · Hoa hồng: {vnd(d.commission)}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area type="monotone" dataKey="commission" stroke="#4f46e5" strokeWidth={2} fill="url(#commGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hoa hồng gần đây</CardTitle>
        </CardHeader>
        <CardContent>
          {commissions.length === 0 ? (
            <p className="text-[14px] text-muted py-8 text-center">Chưa có hoa hồng nào.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-muted border-b border-default">
                    <th className="py-2 pr-4 font-medium">Đơn</th>
                    <th className="py-2 pr-4 font-medium">Sản phẩm</th>
                    <th className="py-2 pr-4 font-medium">Tỷ lệ</th>
                    <th className="py-2 pr-4 font-medium">Giá trị đơn</th>
                    <th className="py-2 pr-4 font-medium text-right">Hoa hồng</th>
                    <th className="py-2 font-medium">Ngày</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.id} className="border-b border-default last:border-0">
                      <td className="py-2.5 pr-4">#{c.order_id}</td>
                      <td className="py-2.5 pr-4">{c.product_title || "—"}</td>
                      <td className="py-2.5 pr-4">{c.rate_percent}%</td>
                      <td className="py-2.5 pr-4">{c.order_total != null ? vnd(c.order_total) : "—"}</td>
                      <td className="py-2.5 pr-4 text-right font-medium text-iris-hi">{vnd(c.amount)}</td>
                      <td className="py-2. text-muted">{formatDate(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
