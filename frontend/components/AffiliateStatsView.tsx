"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
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

const METRIC_KEYS = ["clicks", "signups", "orders", "commission"] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

const METRIC_COLORS: Record<MetricKey, string> = {
  clicks: "#4f46e5",
  signups: "#0ea5e9",
  orders: "#16a34a",
  commission: "#d97706",
};

export function AffiliateStatsView({ data }: { data: AffiliateStats }) {
  const t = useTranslations("affiliate");
  const locale = useLocale();
  const numberLocale = locale === "vi" ? "vi-VN" : "en-US";
  const { totals, timeseries, commissions, referred_users, code, link } = data;
  const showSpend = referred_users.length === 0 || referred_users[0].total_spent != null;
  const [metric, setMetric] = useState<MetricKey>("clicks");
  const [copied, setCopied] = useState(false);

  const metricLabels: Record<MetricKey, string> = {
    clicks: t("metricClicks"),
    signups: t("metricSignups"),
    orders: t("metricOrders"),
    commission: t("metricCommission"),
  };
  const activeLabel = metricLabels[metric];
  const activeColor = METRIC_COLORS[metric];

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
      <Card className="aura p-6">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <p className="text-[11px] font-medium tracking-wide uppercase text-muted mb-2">{t("yourLink")}</p>
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
            {copied ? t("copied") : t("copyLink")}
          </button>
        </div>
      </Card>

      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div variants={item}>
          <StatsCard
            label={t("clicks")}
            value={totals.clicks.toLocaleString(numberLocale)}
            tone="neutral"
            icon={<MousePointerClick size={18} />}
            sub={t("clicksSub")}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatsCard
            label={t("signups")}
            value={totals.signups.toLocaleString(numberLocale)}
            tone="iris"
            icon={<UserPlus size={18} />}
            sub={t("signupsSub")}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatsCard
            label={t("orders")}
            value={totals.orders.toLocaleString(numberLocale)}
            tone="good"
            icon={<ShoppingBag size={18} />}
            sub={t("ordersSub")}
          />
        </motion.div>
        <motion.div variants={item}>
          <StatsCard
            label={t("commission")}
            value={vnd(totals.commission)}
            tone="good"
            icon={<Coins size={18} />}
            sub={t("commissionSub")}
          />
        </motion.div>
      </motion.div>

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-default">
          <h2 className="text-[14px] font-semibold text-slate-900">{t("referredUsersTitle")}</h2>
        </div>
        {referred_users.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-[13px] text-muted">{t("referredEmpty")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-muted border-b border-default">
                  <th className="px-5 py-2.5 font-medium">{t("colEmail")}</th>
                  <th className="px-5 py-2.5 font-medium">{t("colSignedUp")}</th>
                  <th className="px-5 py-2.5 font-medium text-right">{t("colOrderCount")}</th>
                  {showSpend && <th className="px-5 py-2.5 font-medium text-right">{t("colTotalSpend")}</th>}
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

      <Card className="p-0 overflow-hidden">
        <CardHeader className="flex-row items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle>{t("activityTitle")}</CardTitle>
            <p className="text-[12px] text-muted mt-0.5">{t("activitySub", { metric: activeLabel })}</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-default bg-slate-50 p-0.5">
            {METRIC_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setMetric(key)}
                className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors ${
                  metric === key ? "bg-white text-slate-900 shadow-sm" : "text-muted hover:text-slate-700"
                }`}
              >
                {metricLabels[key]}
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
                          <p className="text-slate-300">
                            {t("tooltipClicks", { clicks: d.clicks })} · {t("tooltipSignups", { signups: d.signups })}
                          </p>
                          <p className="text-slate-300">
                            {t("tooltipOrders", { orders: d.orders })} · {t("tooltipCommission", { amount: vnd(d.commission) })}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line type="monotone" dataKey={metric} stroke={activeColor} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-default">
          <h2 className="text-[14px] font-semibold text-slate-900">{t("recentCommissions")}</h2>
        </div>
        {commissions.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-[13px] text-muted">{t("commissionsEmpty")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-muted border-b border-default">
                  <th className="px-5 py-2.5 font-medium">{t("colOrder")}</th>
                  <th className="px-5 py-2.5 font-medium">{t("colProduct")}</th>
                  <th className="px-5 py-2.5 font-medium text-right">{t("colRate")}</th>
                  <th className="px-5 py-2.5 font-medium text-right">{t("colOrderValue")}</th>
                  <th className="px-5 py-2.5 font-medium text-right">{t("colCommission")}</th>
                  <th className="px-5 py-2.5 font-medium">{t("colDate")}</th>
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
