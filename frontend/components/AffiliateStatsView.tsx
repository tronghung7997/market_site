"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, Coins, Copy, MousePointerClick, ShoppingBag, UserPlus } from "lucide-react";
import type { AffiliateStats } from "@/lib/types";
import { vnd, formatDate } from "@/lib/utils";
import { StatsCard } from "@/components/admin/stats-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07 } },
};
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

export function AffiliateStatsView({ data }: { data: AffiliateStats }) {
  const { totals, timeseries, commissions, code, link } = data;
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => {},
    );
  };

  return (
    <div className="space-y-6">
      {/* ─── Hero: referral link ─── */}
      <Card className="aura p-6">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <p className="text-[11px] font-medium tracking-wide uppercase text-muted mb-2">
              Liên kết giới thiệu của bạn
            </p>
            <div className="flex items-center gap-2.5 flex-wrap">
              <p className="font-mono text-[15px] text-iris-hi break-all">{link}</p>
              <span className="inline-flex items-center rounded-md bg-iris-soft px-2 py-0.5 font-mono text-[12px] font-semibold text-iris-hi">
                {code}
              </span>
            </div>
          </div>
          <button
            onClick={copyLink}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-default bg-white px-3.5 py-2 text-[13px] font-medium hover:bg-raised transition-colors"
          >
            {copied ? <Check size={15} className="text-good" /> : <Copy size={15} />}
            {copied ? "Đã sao chép" : "Sao chép liên kết"}
          </button>
        </div>
      </Card>

      {/* ─── KPI cards ─── */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <motion.div variants={item}>
          <StatsCard
            label="Lượt nhấp"
            value={totals.clicks.toLocaleString("vi-VN")}
            tone="neutral"
            icon={<MousePointerClick size={18} />}
            sub="lượt vào qua link"
          />
        </motion.div>
        <motion.div variants={item}>
          <StatsCard
            label="Đăng ký"
            value={totals.signups.toLocaleString("vi-VN")}
            tone="iris"
            icon={<UserPlus size={18} />}
            sub="tài khoản giới thiệu"
          />
        </motion.div>
        <motion.div variants={item}>
          <StatsCard
            label="Đơn hàng"
            value={totals.orders.toLocaleString("vi-VN")}
            tone="good"
            icon={<ShoppingBag size={18} />}
            sub="đơn tính hoa hồng"
          />
        </motion.div>
        <motion.div variants={item}>
          <StatsCard
            label="Hoa hồng"
            value={vnd(totals.commission)}
            tone="good"
            icon={<Coins size={18} />}
            sub="đã cộng vào ví"
          />
        </motion.div>
      </motion.div>

      {/* ─── Activity chart ─── */}
      <Card className="p-0 overflow-hidden">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Hoạt động theo ngày</CardTitle>
            <p className="text-[12px] text-muted mt-0.5">Hoa hồng phát sinh mỗi ngày</p>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeseries}>
                <defs>
                  <linearGradient id="commGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  tickFormatter={(v: string) => v.slice(5)}
                  minTickGap={24}
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

      {/* ─── Recent commissions ─── */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-default">
          <h2 className="text-[14px] font-semibold text-slate-900">Hoa hồng gần đây</h2>
        </div>
        {commissions.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-[13px] text-muted">Chưa có hoa hồng nào — chia sẻ liên kết để bắt đầu.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-muted border-b border-default">
                  <th className="px-5 py-2.5 font-medium">Đơn</th>
                  <th className="px-5 py-2.5 font-medium">Sản phẩm</th>
                  <th className="px-5 py-2.5 font-medium text-right">Tỷ lệ</th>
                  <th className="px-5 py-2.5 font-medium text-right">Giá trị đơn</th>
                  <th className="px-5 py-2.5 font-medium text-right">Hoa hồng</th>
                  <th className="px-5 py-2.5 font-medium">Ngày</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-2.5 font-mono text-slate-400">#{c.order_id}</td>
                    <td className="px-5 py-2.5">{c.product_title || "—"}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-muted">{c.rate_percent}%</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{c.order_total != null ? vnd(c.order_total) : "—"}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-good">{vnd(c.amount)}</td>
                    <td className="px-5 py-2.5 text-muted">{formatDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
