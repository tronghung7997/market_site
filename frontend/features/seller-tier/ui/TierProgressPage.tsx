"use client";

/** Seller › Tier & trust: where the shop stands, what the next tier asks for,
 *  where the trust score comes from and what the next tier unlocks. Tiers
 *  move at the daily review (03:00) unless an admin locked the tier; the page
 *  also shows the platform fee the shop pays now and any fee promo. */

import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import type { SellerTierName, SellerTierProgress, SellerTierRule, TrustCriterion } from "@/lib/types";
import { Button, Card, ProgressBar, Skeleton, Tag } from "@/components/ui";
import { AlertTriangle, Check, X } from "@/components/Icons";
import { CRITERION_UNIT, criterionProgress, formatPct, missingCriteria, scoreBand, TIER_STEPS } from "../model";
import { useHoldLabel } from "@/lib/hold";
import { SellerTierBadge } from "@/components/SellerTierBadge";
import { formatDate } from "@/lib/utils/format";

export function TierProgressPage() {
  const t = useTranslations("seller.tier");
  const progress = useQuery({ queryKey: ["seller", "tier-progress"], queryFn: () => api.sellerTierProgress() });
  const tiers = useQuery({ queryKey: ["seller-tiers"], queryFn: () => api.sellerTiers(), staleTime: 5 * 60_000 });

  if (progress.isPending) {
    return <div className="space-y-4" aria-hidden><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  }
  if (progress.isError || !progress.data) {
    return (
      <Card className="flex items-center justify-between gap-3 p-5 text-[13px]">
        <span className="text-bad">{t("loadFailed")}</span>
        <Button size="sm" variant="secondary" onClick={() => progress.refetch()}>{t("retry")}</Button>
      </Card>
    );
  }
  const p = progress.data;
  const missing = missingCriteria(p.criteria);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-[24px] font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-0.5 text-[12.5px] text-muted">{t("subtitle")}</p>
      </div>

      <FeeAndStatus progress={p} />
      {p.at_risk.length > 0 && !p.locked && <AtRisk progress={p} />}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12px] text-muted">{t("currentTier")}</p>
            <p className="mt-0.5 flex items-center gap-2 font-serif text-[22px] font-semibold">
              {t(`tiers.${p.tier}`)}
              <SellerTierBadge tier={p.tier} image={p.current_rule?.badge} className="font-sans" />
            </p>
            <p className="mt-1 text-[13px] text-muted">
              {!p.next_tier
                ? t("topTier")
                : !p.next_tier_promotable
                  ? t("inviteOnly", { tier: t(`tiers.${p.next_tier}`) })
                  : p.eligible
                    ? t(p.locked || !p.auto_enabled ? "eligibleManual" : "eligible", { tier: t(`tiers.${p.next_tier}`) })
                    : t("missing", { count: missing.length, tier: t(`tiers.${p.next_tier}`) })}
            </p>
          </div>
          <ScoreGauge progress={p} />
        </div>
        <TierLadder current={p.tier} rules={tiers.data?.tiers ?? []} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {p.next_tier && p.next_tier_promotable ? (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
              <h2 className="text-[14px] font-semibold">{t("criteriaTitle", { tier: t(`tiers.${p.next_tier}`) })}</h2>
              <span className="font-mono text-[12px] text-muted">{t("metCount", { met: p.met, total: p.criteria.length })}</span>
            </div>
            <ul className="divide-y divide-line">
              {p.criteria.map((row) => <CriterionItem key={row.key} row={row} windowDays={p.window_days} />)}
            </ul>
          </Card>
        ) : (
          <Card className="p-5 text-[13px] text-muted">{p.next_tier ? t("inviteOnlyBody") : t("topTierBody")}</Card>
        )}

        <div className="space-y-5">
          <ScoreBreakdown progress={p} />
          {p.next_rule && p.current_rule && <Benefits current={p.current_rule} next={p.next_rule} />}
        </div>
      </div>

      <p className="text-[12px] leading-relaxed text-faint">
        {t("howItWorks", { days: p.window_days, min: p.min_orders_for_score, grace: p.grace_days, orders: p.dispute_min_orders })}{" "}
        <Link href="/sell#fees" className="font-medium text-iris-hi hover:underline">{t("tiersLink")}</Link>
      </p>
    </div>
  );
}

function ScoreGauge({ progress: p }: { progress: SellerTierProgress }) {
  const t = useTranslations("seller.tier");
  const need = p.criteria.find((row) => row.key === "min_score")?.target;
  if (p.score == null) {
    return (
      <div className="w-full max-w-[260px]">
        <p className="text-[12px] text-muted">{t("score")}</p>
        <p className="mt-0.5 text-[13px] font-medium">{t("notEnoughData")}</p>
        <ProgressBar value={p.metrics.completed_window} max={p.min_orders_for_score} label={t("score")} className="mt-2" />
        <p className="mt-1 text-[11.5px] text-faint">
          {t("notEnoughDataHint", { done: p.metrics.completed_window, min: p.min_orders_for_score, days: p.window_days })}
        </p>
      </div>
    );
  }
  return (
    <div className="w-full max-w-[260px]">
      <p className="text-[12px] text-muted">{t("score")}</p>
      <p className="mt-0.5 flex items-baseline gap-1.5">
        <span className="font-mono text-[30px] font-semibold tabular leading-none">{p.score}</span>
        <span className="text-[12px] text-muted">/ 100 · {t(`bands.${scoreBand(p.score)}`)}</span>
      </p>
      <div className="relative mt-2">
        <ProgressBar value={p.score} max={100} label={t("score")} />
        {need != null && (
          <span aria-hidden className="absolute -top-1 h-3.5 w-0.5 rounded bg-fg" style={{ left: `calc(${need}% - 1px)` }} />
        )}
      </div>
      {need != null && <p className="mt-1 text-[11.5px] text-faint">{t("scoreNeed", { need })}</p>}
    </div>
  );
}

function TierLadder({ current, rules }: { current: SellerTierName; rules: SellerTierRule[] }) {
  const t = useTranslations("seller.tier");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const index = TIER_STEPS.indexOf(current);
  return (
    <ol className="mt-5 grid gap-2 sm:grid-cols-4">
      {TIER_STEPS.map((tier, i) => {
        const rule = rules.find((r) => r.tier === tier);
        const here = i === index;
        return (
          <li
            key={tier}
            aria-current={here ? "step" : undefined}
            className={cn(
              "rounded-lg border px-3 py-2.5",
              here ? "border-iris bg-iris-soft" : i < index ? "border-line bg-raised/40" : "border-line bg-surface",
            )}
          >
            <p className={cn("text-[13px] font-medium", here && "text-iris-hi")}>
              {t(`tiers.${tier}`)}{here && <span className="ml-1 text-[11.5px] font-normal">· {t("youAreHere")}</span>}
            </p>
            {rule && (
              <p className="mt-0.5 text-[11.5px] text-muted">
                {rule.max_active_products == null ? t("unlimitedProducts") : t("products", { count: rule.max_active_products })}
                {" · "}
                {rule.withdraw_limit_per_request == null ? t("unlimitedWithdraw") : t("withdraw", { amount: formatLedgerMoney(rule.withdraw_limit_per_request, locale) })}
              </p>
            )}
            {tier === "enterprise" && <p className="mt-0.5 text-[11px] text-faint">{t("byInvitation")}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function CriterionItem({ row, windowDays }: { row: TrustCriterion; windowDays: number }) {
  const t = useTranslations("seller.tier");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const unit = CRITERION_UNIT[row.key];
  const show = (value: number | null) => {
    if (value == null) return "—";
    if (unit === "money") return formatLedgerMoney(value, locale);
    if (unit === "pct") return formatPct(value, locale);
    if (unit === "days") return t("daysValue", { count: value });
    return value.toLocaleString(locale === "vi" ? "vi-VN" : "en-US");
  };
  const atMost = row.key.startsWith("max_");
  return (
    <li className="px-5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-medium">
            {row.met === true ? <Check size={14} className="text-good" /> : row.met === false ? <X size={14} className="text-bad" /> : <span className="h-3.5 w-3.5 rounded-full border border-line-2" />}
            {t(`criteria.${row.key}`)}
          </p>
          <p className="mt-0.5 pl-5 text-[11.5px] text-faint">
            {row.key.startsWith("max_") || row.key === "min_score" ? t("scopeWindow", { days: windowDays }) : t("scopeLifetime")}
            {row.keep && ` · ${t("keepCheck")}`}
          </p>
        </div>
        <p className="shrink-0 text-right font-mono text-[12.5px] tabular">
          {show(row.value)} <span className="text-faint">/ {atMost ? "≤" : "≥"} {show(row.target)}</span>
        </p>
      </div>
      {row.met === null ? (
        <p className="mt-1.5 pl-5 text-[11.5px] text-faint">{t("scoreSkipped")}</p>
      ) : (
        <div className="mt-2 pl-5">
          <ProgressBar value={Math.round(criterionProgress(row) * 100)} max={100} label={t(`criteria.${row.key}`)} />
        </div>
      )}
    </li>
  );
}

function ScoreBreakdown({ progress: p }: { progress: SellerTierProgress }) {
  const t = useTranslations("seller.tier");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const m = p.metrics;
  const disputePct = m.orders_window ? (100 * m.disputes_window) / m.orders_window : 0;
  const oneStarPct = m.reviews_window ? (100 * m.one_star_window) / m.reviews_window : 0;
  const parts = [
    { key: "dispute" as const, note: t("partDisputeNote", { pct: formatPct(disputePct, locale), disputes: m.disputes_window, orders: m.orders_window }) },
    { key: "one_star" as const, note: t("partOneStarNote", { pct: formatPct(oneStarPct, locale), count: m.one_star_window, reviews: m.reviews_window }) },
    { key: "gmv" as const, note: t("partGmvNote", { amount: formatLedgerMoney(m.gmv_window, locale) }) },
  ];
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-5 py-3.5">
        <h2 className="text-[14px] font-semibold">{t("breakdownTitle")}</h2>
        <p className="mt-0.5 text-[12px] text-muted">{t("breakdownScope", { days: p.window_days, orders: m.completed_window, reviews: m.reviews_window })}</p>
      </div>
      <ul className="divide-y divide-line">
        {parts.map((part) => (
          <li key={part.key} className="flex items-start justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">{t(`parts.${part.key}`)}</p>
              <p className="mt-0.5 text-[11.5px] text-faint">{part.note}</p>
            </div>
            <p className="shrink-0 font-mono text-[13px] font-semibold tabular">
              {p.score_parts ? p.score_parts[part.key] : "—"}<span className="font-normal text-faint"> / {p.score_points[part.key]}</span>
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Benefits({ current, next }: { current: SellerTierRule; next: SellerTierRule }) {
  const t = useTranslations("seller.tier");
  const holdLabel = useHoldLabel();
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const rows = [
    { key: "products", a: current.max_active_products, b: next.max_active_products, fmt: (v: number | null) => (v == null ? t("unlimited") : String(v)) },
    { key: "withdraw", a: current.withdraw_limit_per_request, b: next.withdraw_limit_per_request, fmt: (v: number | null) => (v == null ? t("unlimited") : formatLedgerMoney(v, locale)) },
    { key: "fee", a: current.fee_percent, b: next.fee_percent, fmt: (v: number | null) => (v == null ? t("feeDefault") : t("feeValue", { value: formatPct(v, locale) })) },
    { key: "escrow", a: current.escrow_reduction_hours, b: next.escrow_reduction_hours, fmt: (v: number | null) => (v ? t("escrowValue", { hold: holdLabel(v) }) : "—") },
  // A perk neither tier has (both "—") says nothing; leave the row out.
  ].filter((row) => row.a || row.b || row.key === "products" || row.key === "withdraw" || (row.key === "fee" && (row.a != null || row.b != null)));
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-5 py-3.5">
        <h2 className="text-[14px] font-semibold">{t("benefitsTitle", { tier: t(`tiers.${next.tier}`) })}</h2>
      </div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[11.5px] text-muted">
            <th className="px-5 py-2 font-medium">{t("benefit")}</th>
            <th className="px-3 py-2 text-right font-medium">{t(`tiers.${current.tier}`)}</th>
            <th className="px-5 py-2 text-right font-medium text-iris-hi">{t(`tiers.${next.tier}`)}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line border-t border-line">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="px-5 py-2 text-muted">{t(`benefits.${row.key}`)}</td>
              <td className="px-3 py-2 text-right font-mono tabular">{row.fmt(row.a)}</td>
              <td className="px-5 py-2 text-right font-mono font-semibold tabular">{row.fmt(row.b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function AtRisk({ progress: p }: { progress: SellerTierProgress }) {
  const t = useTranslations("seller.tier");
  const locale = useLocale();
  return (
    <div role="status" className="rounded-card border border-warn/30 bg-warn-soft px-5 py-4">
      <p className="flex items-center gap-2 text-[14px] font-medium">
        <AlertTriangle size={16} className="text-warn" /> {t("atRiskTitle", { tier: t(`tiers.${p.tier}`) })}
      </p>
      <ul className="mt-2 space-y-1 text-[13px]">
        {p.at_risk.map((row) => (
          <li key={row.key} className="flex flex-wrap items-baseline gap-x-2">
            <span>{t(`criteria.${row.key}`)}</span>
            <Tag tone="bad">{row.key === "min_score" ? row.value : formatPct(row.value ?? 0, locale)}</Tag>
            <span className="text-muted">{t("atRiskLimit", { limit: row.key === "min_score" ? String(row.target) : formatPct(row.target, locale) })}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12.5px] text-fg/80">
        {p.at_risk.some((row) => row.key === "max_dispute_pct")
          ? t("atRiskDispute")
          : p.at_risk_since
            ? t("atRiskDeadline", { date: formatDate(new Date(new Date(p.at_risk_since).getTime() + p.grace_days * 86_400_000), locale) })
            : t("atRiskBody", { days: p.grace_days })}
      </p>
    </div>
  );
}

/** What the shop pays now (and why), and whether the daily review can move it. */
function FeeAndStatus({ progress: p }: { progress: SellerTierProgress }) {
  const t = useTranslations("seller.tier");
  const locale = useLocale();
  const promo = p.fee_promo?.active ? p.fee_promo : null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card className="p-4">
        <p className="text-[12px] text-muted">{t("feeNow")}</p>
        <p className="mt-0.5 font-mono text-[22px] font-semibold tabular">{formatPct(p.fee_percent, locale)}</p>
        <p className="mt-1 text-[12px] text-muted">
          {promo
            ? promo.ends_at
              ? t("feePromo", { fee: formatPct(promo.fee_percent, locale), date: formatDate(promo.ends_at, locale) })
              : t("feePromoOpen", { fee: formatPct(promo.fee_percent, locale) })
            : t("feeNowHint")}
        </p>
        {promo?.badge_tier && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted">
            <SellerTierBadge tier={promo.badge_tier} size="xs" />{" "}
            {promo.ends_at ? t("feePromoBadge", { date: formatDate(promo.ends_at, locale) }) : t("feePromoBadgeOpen")}
          </p>
        )}
      </Card>
      <Card className="p-4">
        <p className="text-[12px] text-muted">{t("reviewTitle")}</p>
        <p className="mt-0.5 text-[13.5px] font-medium">
          {p.locked ? t("reviewLocked") : p.auto_enabled ? t("reviewAuto") : t("reviewPaused")}
        </p>
        <p className="mt-1 text-[12px] text-muted">
          {p.locked ? t("reviewLockedHint") : t("reviewAutoHint", { orders: p.dispute_min_orders, grace: p.grace_days })}
        </p>
      </Card>
    </div>
  );
}
