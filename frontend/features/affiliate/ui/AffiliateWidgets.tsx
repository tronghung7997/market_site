"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/utils";
import type { AffiliateCommissionRow, AffiliatePromoCode, AffiliateTimeseriesPoint, AffiliateTotals, ReferredUserRow } from "@/lib/types";
import { Button, Input } from "@/components/ui";
import { ArrowRight, Check, Copy, ExternalLink } from "@/components/Icons";
import { formatRate, ratio, shareTargets, type DateRange, type RangeKey } from "../model";

export type MoneyFormatter = (amount: number) => string;

/* ------------------------------------------------------------------ Range */

const PRESETS: RangeKey[] = ["7d", "30d", "90d", "all"];

export function RangePicker({ value, custom, onChange }: {
  value: RangeKey;
  custom: DateRange;
  onChange: (key: RangeKey, custom?: DateRange) => void;
}) {
  const t = useTranslations("affiliate");
  const labels: Record<RangeKey, string> = { "7d": t("range7"), "30d": t("range30"), "90d": t("range90"), all: t("rangeAll"), custom: t("rangeCustom") };
  const [draft, setDraft] = React.useState<DateRange>(custom);
  React.useEffect(() => { setDraft(custom); }, [custom]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-line bg-surface p-0.5" role="tablist" aria-label={t("rangeLabel")}>
        {[...PRESETS, "custom" as const].map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={value === key}
            onClick={() => onChange(key, key === "custom" ? draft : undefined)}
            className={cn("rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors", value === key ? "bg-iris text-white" : "text-muted hover:text-fg")}
          >
            {labels[key]}
          </button>
        ))}
      </div>
      {value === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input type="date" value={draft.date_from ?? ""} onChange={(e) => setDraft({ ...draft, date_from: e.target.value })} className="h-9 w-auto text-[12.5px]" aria-label={t("rangeFrom")} />
          <span className="text-muted">–</span>
          <Input type="date" value={draft.date_to ?? ""} onChange={(e) => setDraft({ ...draft, date_to: e.target.value })} className="h-9 w-auto text-[12.5px]" aria-label={t("rangeTo")} />
          <Button size="sm" variant="secondary" onClick={() => onChange("custom", draft)}>{t("rangeApply")}</Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Link */

export function ReferralLinkCard({ link, code, attributionDays, className }: {
  link: string;
  code: string;
  attributionDays?: number;
  className?: string;
}) {
  const t = useTranslations("affiliate");
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }, () => {});
  };
  const pretty = link.replace(/^https?:\/\//, "");
  return (
    <section className={cn("rounded-card border border-line bg-card p-5 shadow-card", className)}>
      <h2 className="text-[13.5px] font-semibold text-fg">{t("linkTitle")}</h2>
      <div className="mt-3 flex flex-wrap items-stretch gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-line bg-surface px-3 font-mono text-[14px] text-fg">
          <span className="min-w-0 truncate" title={link}>{pretty}</span>
        </div>
        <Button onClick={copy} className="shrink-0">
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? t("copied") : t("copyLink")}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted">
        <span>{t("codeLabel")} <span className="rounded-md bg-iris-soft px-1.5 py-0.5 font-mono text-[12px] font-semibold text-iris-hi">{code}</span></span>
        <span className="inline-flex items-center gap-1.5">
          {t("shareVia")}
          {shareTargets(link, t("shareText")).map((s) => (
            <a key={s.key} href={s.href} target="_blank" rel="noopener noreferrer" className="rounded-md border border-line bg-surface px-2 py-0.5 text-[12px] font-medium text-fg transition-colors hover:border-line-2">
              {s.label}
            </a>
          ))}
        </span>
      </div>
      {attributionDays != null && (
        <p className="mt-2 text-[12px] text-faint">{t("attributionNote", { days: attributionDays })}</p>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- Funnel */

/** The five headline numbers in one segmented surface: clicks → sign-ups →
 *  orders (range), then commission still held and commission available (now). */
export function AffiliateFunnel({ totals, formatMoney, className }: { totals: AffiliateTotals; formatMoney: MoneyFormatter; className?: string }) {
  const t = useTranslations("affiliate");
  const locale = useLocale();
  const numberLocale = locale === "vi" ? "vi-VN" : "en-US";
  const n = (v: number) => v.toLocaleString(numberLocale);
  const rate = (v: number | null) => (v == null ? t("funnelRateNone") : t("funnelRate", { rate: formatRate(v, locale) }));
  const steps = [
    { label: t("funnelClicks"), value: n(totals.clicks), sub: t("funnelStart") },
    { label: t("funnelSignups"), value: n(totals.signups), sub: rate(ratio(totals.signups, totals.clicks)) },
    {
      label: t("kpiOrders"),
      value: n(totals.referred_orders),
      sub: t("kpiOrdersSub", { settled: n(totals.orders), held: n(totals.pending_orders) }),
    },
  ];
  return (
    <section aria-label={t("kpiLabel")} className={cn("overflow-hidden rounded-card border border-line bg-line shadow-card", className)}>
      <div className="grid grid-cols-2 gap-px lg:grid-cols-5">
        {steps.map((s, i) => (
          <div key={s.label} className={cn("relative bg-card px-5 py-4", i === 2 && "col-span-2 lg:col-span-1")}>
            <div className="text-[12px] text-muted">{s.label}</div>
            <div className="mt-1 font-mono text-[24px] font-semibold leading-none tabular-nums text-fg">{s.value}</div>
            <div className="mt-1.5 text-[11.5px] text-faint">{s.sub}</div>
            {i < steps.length - 1 && (
              <span aria-hidden className="absolute right-0 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 translate-x-1/2 place-items-center rounded-full border border-line bg-card text-faint lg:grid">
                <ArrowRight size={12} />
              </span>
            )}
          </div>
        ))}
        {/* Tints sit on an opaque card so the hairline grid behind never shows through. */}
        <div className="bg-card">
          <div className="h-full bg-warn-soft/40 px-5 py-4">
            <div className="text-[12px] text-muted">{t("kpiPending")}</div>
            <div className="mt-1 font-mono text-[24px] font-semibold leading-none tabular-nums text-warn">{formatMoney(totals.pending_commission)}</div>
            <div className="mt-1.5 text-[11.5px] text-faint">{t("kpiPendingSub", { count: totals.pending_orders })}</div>
          </div>
        </div>
        <div className="bg-card">
          <div className="h-full bg-good-soft/40 px-5 py-4">
            <div className="text-[12px] text-muted">{t("kpiAvailable")}</div>
            <div className="mt-1 font-mono text-[24px] font-semibold leading-none tabular-nums text-good">{formatMoney(totals.available_commission)}</div>
            <div className="mt-1.5 text-[11.5px] text-faint">{t("kpiAvailableSub", { amount: formatMoney(totals.commission) })}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ Promo codes */

function offerText(code: AffiliatePromoCode, t: ReturnType<typeof useTranslations>, formatMoney: MoneyFormatter): string {
  if (code.discount_type === "fixed") return t("offerFixed", { amount: formatMoney(code.discount_value) });
  return code.max_discount_amount
    ? t("offerPercentCap", { value: code.discount_value, cap: formatMoney(code.max_discount_amount) })
    : t("offerPercent", { value: code.discount_value });
}

/** A KOL's own promo codes and what each one brought in. Renders nothing without codes. */
export function PromoCodesPanel({ codes, formatMoney, title, hint, className }: {
  codes: AffiliatePromoCode[];
  formatMoney: MoneyFormatter;
  /** Admin views name the KOL's codes instead of "your codes". */
  title?: string;
  hint?: string;
  className?: string;
}) {
  const t = useTranslations("affiliate");
  const [copied, setCopied] = React.useState<string | null>(null);
  if (codes.length === 0) return null;
  const copy = (code: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(code).then(() => { setCopied(code); setTimeout(() => setCopied(null), 1800); }, () => {});
  };
  return (
    <Panel title={title ?? t("codesTitle")} count={codes.length} className={className}>
      <p className="border-b border-line px-5 py-2.5 text-[12px] text-muted">{hint ?? t("codesHint")}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-raised/40 text-left text-[12px] text-muted">
            <tr>
              <th className="px-5 py-2 font-medium">{t("colCode")}</th>
              <th className="px-3 py-2 font-medium">{t("colOffer")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("colCodeOrders")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("colCodeBuyers")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("colCommission")}</th>
              <th className="px-5 py-2 font-medium">{t("colStatus")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {codes.map((c) => (
              <tr key={c.code}>
                <td className="px-5 py-2.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="rounded-md bg-iris-soft px-1.5 py-0.5 font-mono text-[12.5px] font-semibold text-iris-hi">{c.code}</span>
                    <button type="button" onClick={() => copy(c.code)} aria-label={t("copyCode", { code: c.code })}
                      className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-raised hover:text-fg">
                      {copied === c.code ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-muted">{offerText(c, t, formatMoney)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{c.orders}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{c.buyers}</td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-good">{formatMoney(c.commission)}</td>
                <td className="px-5 py-2.5 whitespace-nowrap">
                  <span className={cn("rounded-md px-1.5 py-0.5 text-[12px] font-medium", c.active ? "bg-good-soft text-good" : "bg-raised text-muted")}>
                    {c.active ? t("codeActive") : t("codeInactive")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ Chart */

const METRICS = ["clicks", "signups", "orders", "commission"] as const;
type Metric = (typeof METRICS)[number];
const COLORS: Record<Metric, string> = { clicks: "#4f46e5", signups: "#0ea5e9", orders: "#12925f", commission: "#b07814" };

export function ActivityChart({ series, formatMoney, className }: { series: AffiliateTimeseriesPoint[]; formatMoney: MoneyFormatter; className?: string }) {
  const t = useTranslations("affiliate");
  const locale = useLocale();
  const [metric, setMetric] = React.useState<Metric>("clicks");
  const labels: Record<Metric, string> = { clicks: t("metricClicks"), signups: t("metricSignups"), orders: t("metricOrders"), commission: t("metricCommission") };
  const color = COLORS[metric];
  const empty = series.every((p) => p[metric] === 0);
  const fmtDay = (v: string) => new Date(v + "T00:00:00").toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", { day: "numeric", month: "short" });
  return (
    <section className={cn("rounded-card border border-line bg-card shadow-card", className)}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[13.5px] font-semibold text-fg">{t("activityTitle")}</h2>
        <div className="flex rounded-lg border border-line bg-surface p-0.5" role="tablist">
          {METRICS.map((key) => (
            <button key={key} type="button" role="tab" aria-selected={metric === key} onClick={() => setMetric(key)}
              className={cn("rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors", metric === key ? "bg-card text-fg shadow-sm" : "text-muted hover:text-fg")}>
              {labels[key]}
            </button>
          ))}
        </div>
      </header>
      <div className="relative h-64 px-2 pt-4">
        {empty && <p className="absolute inset-0 grid place-items-center text-[12.5px] text-faint">{t("chartEmpty", { metric: labels[metric] })}</p>}
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id={`aff-${metric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e8ee" />
            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#8b8f9c" }} tickFormatter={fmtDay} minTickGap={28} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#8b8f9c" }} width={metric === "commission" ? 64 : 36} allowDecimals={false}
              tickFormatter={(v: number) => (metric === "commission" ? formatMoney(v).replace(/\s?[₫đ]$/, "") : String(v))} />
            <Tooltip
              cursor={{ stroke: "#d6d9e1" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as AffiliateTimeseriesPoint;
                return (
                  <div className="rounded-lg bg-fg px-3 py-2 text-[12px] text-white shadow-lg">
                    <p className="font-medium">{fmtDay(d.date)}</p>
                    <p className="opacity-80">{t("tooltipClicks", { clicks: d.clicks })} · {t("tooltipSignups", { signups: d.signups })}</p>
                    <p className="opacity-80">{t("tooltipOrders", { orders: d.orders })} · {t("tooltipCommission", { amount: formatMoney(d.commission) })}</p>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey={metric} stroke={color} strokeWidth={2} fill={`url(#aff-${metric})`} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- Tables */

function Panel({ title, count, children, className }: { title: string; count?: number; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-card border border-line bg-card shadow-card", className)}>
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-[13.5px] font-semibold text-fg">{title}</h2>
        {count != null && count > 0 && <span className="text-[12px] text-faint">{count}</span>}
      </header>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 py-10 text-center text-[12.5px] text-muted">{text}</p>;
}

export function ReferredUsersPanel({ users, formatMoney, className }: { users: ReferredUserRow[]; formatMoney: MoneyFormatter; className?: string }) {
  const t = useTranslations("affiliate");
  const locale = useLocale();
  const showSpend = users.length > 0 && users[0].total_spent != null;
  return (
    <Panel title={t("referredUsersTitle")} count={users.length} className={className}>
      {users.length === 0 ? <Empty text={t("referredEmpty")} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-raised/40 text-left text-[12px] text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">{t("colEmail")}</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">{t("colSignedUp")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("colOrderCount")}</th>
                {showSpend && <th className="px-5 py-2 text-right font-medium">{t("colTotalSpend")}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="max-w-[260px] px-5 py-2.5 text-fg">
                    <span className="block truncate">{u.email}</span>
                    {u.via_code && <span className="mt-0.5 inline-block rounded-md bg-iris-soft px-1.5 py-0.5 font-mono text-[11px] text-iris-hi">{t("viaCode", { code: u.via_code })}</span>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted">{formatDate(u.created_at, locale)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{u.order_count > 0 ? u.order_count : <span className="text-faint">0</span>}</td>
                  {showSpend && <td className="px-5 py-2.5 text-right font-medium tabular-nums">{u.total_spent ? formatMoney(u.total_spent) : <span className="text-faint">—</span>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function CommissionsPanel({ rows, formatMoney, orderHref, className }: {
  rows: AffiliateCommissionRow[];
  formatMoney: MoneyFormatter;
  /** Admin: link each order to its console page. */
  orderHref?: (row: AffiliateCommissionRow) => string;
  className?: string;
}) {
  const t = useTranslations("affiliate");
  const locale = useLocale();
  return (
    <Panel title={t("recentCommissions")} count={rows.length} className={className}>
      {rows.length === 0 ? <Empty text={t("commissionsEmpty")} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-raised/40 text-left text-[12px] text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">{t("colProduct")}</th>
                <th className="px-3 py-2 font-medium">{t("colOrder")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("colOrderValue")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("colRate")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("colCommission")}</th>
                <th className="px-5 py-2 font-medium whitespace-nowrap">{t("colDate")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="max-w-[260px] truncate px-5 py-2.5 text-fg">{c.product_title || <span className="text-faint">—</span>}</td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-muted">
                    {c.order_code ? (
                      orderHref ? <a href={orderHref(c)} className="inline-flex items-center gap-1 text-iris-hi hover:underline">{c.order_code}<ExternalLink size={11} /></a> : c.order_code
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">{c.order_total != null ? formatMoney(c.order_total) : "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted">{c.rate_percent}%</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-good">{formatMoney(c.amount)}</td>
                  <td className="px-5 py-2.5 whitespace-nowrap text-muted">{formatDate(c.created_at, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------- How it works */

export function HowItWorks({ className, compact = false }: { className?: string; compact?: boolean }) {
  const t = useTranslations("affiliate");
  const steps = [
    [t("stepShareTitle"), t("stepShareBody")],
    [t("stepBuyTitle"), t("stepBuyBody")],
    [t("stepEarnTitle"), t("stepEarnBody")],
  ];
  return (
    <section className={cn("rounded-card border border-line bg-card p-5 shadow-card", className)}>
      {!compact && <h2 className="text-[13.5px] font-semibold text-fg">{t("howItWorks")}</h2>}
      <ol className={cn("grid gap-4 sm:grid-cols-3", !compact && "mt-3")}>
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-iris-soft font-mono text-[12.5px] font-semibold text-iris-hi">{i + 1}</span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg">{title}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
