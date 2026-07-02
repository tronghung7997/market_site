"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

const METRICS = [
  { key: "clicks", label: "Nhấp", color: "#4f46e5" },
  { key: "signups", label: "Đăng ký", color: "#0ea5e9" },
  { key: "orders", label: "Đơn", color: "#16a34a" },
  { key: "commission", label: "Hoa hồng", color: "#d97706" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

export function AffiliateStatsView({ data }: { data: AffiliateStats }) {
  const { totals, timeseries, commissions, referred_users, code, link } = data;
  const showSpend = referred_users.length === 0 || referred_users[0].total_spent != null;
  const [metric, setMetric] = useState<MetricKey>("clicks");
  const activeMetric = METRICS.find((m) => m.key === metric)!;
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

      {/* ─── Referred users ─── */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-default">
          <h2 className="text-[14px] font-semibold text-slate-900">Người dùng đã đăng ký qua link</h2>
        </div>
        {referred_users.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-[13px] text-muted">Chưa có ai đăng ký qua liên kết này.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-muted border-b border-default">
                  <th className="px-5 py-2.5 font-medium">Email</th>
                  <th className="px-5 py-2.5 font-medium">Ngày đăng ký</th>
                  <th className="px-5 py-2.5 font-medium text-right">Số đơn</th>
                  {showSpend && <th className="px-5 py-2.5 font-medium text-right">Tổng chi tiêu</th>}
                </tr>
              </thead>
              <tbody>
                {referred_users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-2.5">{u.email}</td>
                    <td className="px-5 py-2.5 text-muted">{formatDate(u.created_at)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{u.order_count}</td>
                    {showSpend && (
                      <td className="px-5 py-2.5 text-right tabular-nums font-semibold">
                        {u.total_spent && u.total_spent > 0 ? vnd(u.total_spent) : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ─── Activity chart ─── */}
      <Card className="p-0 overflow-hidden">
        <CardHeader className="flex-row items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle>Hoạt động theo ngày</CardTitle>
            <p className="text-[12px] text-muted mt-0.5">{activeMetric.label} phát sinh mỗi ngày</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-default bg-slate-50 p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMetric(m.key)}
                className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
                  metric === m.key ? "bg-white text-slate-900 shadow-sm" : "text-muted hover:text-slate-700"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeseries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  tickFormatter={(v: string) => v.slice(5)}
                  minTickGap={24}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#94a3b8" }} width={40} allowDecimals={false} />
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
                <Line type="monotone" dataKey={metric} stroke={activeMetric.color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
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
