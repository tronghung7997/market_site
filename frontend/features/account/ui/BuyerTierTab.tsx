"use client";

/** Account › Hạng thành viên: the buyer's tier (L1–L3), the figure behind it,
 *  the next threshold, what each tier gives (cashback, API limits) and the
 *  tier history. Tiers move at the daily update (03:00). */

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import type { BuyerTierLevel, BuyerTierProgress } from "@/lib/types";
import { Button, ProgressBar, Spinner, Tag } from "@/components/ui";
import { ArrowRight } from "@/components/Icons";
import { Panel } from "./shared";

export function levelName(level: Pick<BuyerTierLevel, "name_vi" | "name_en">, locale: string): string {
  return locale === "vi" ? level.name_vi : level.name_en;
}

export function BuyerTierTab() {
  const t = useTranslations("buyerTier");
  const tier = useQuery({ queryKey: ["account", "buyer-tier"], queryFn: () => api.myBuyerTier() });
  if (tier.isPending) return <div className="grid place-items-center py-16"><Spinner /></div>;
  if (tier.isError || !tier.data) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-card p-5 text-[13px]">
        <span className="text-bad">{t("loadFailed")}</span>
        <Button size="sm" variant="secondary" onClick={() => void tier.refetch()}>{t("retry")}</Button>
      </div>
    );
  }
  const p = tier.data;
  return (
    <div className="space-y-4">
      <Current progress={p} />
      <Ladder progress={p} />
      {p.history.length > 0 && <History progress={p} />}
    </div>
  );
}

function Current({ progress: p }: { progress: BuyerTierProgress }) {
  const t = useTranslations("buyerTier");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  const money = (v: number) => formatLedgerMoney(v, locale);
  const next = p.next_tier ? p.levels.find((l) => l.tier === p.next_tier) : null;
  const criterion = t(`criterion.${p.criterion}`);
  return (
    <Panel
      title={t("title")}
      hint={t("hint", { criterion: criterion.toLowerCase() })}
      aside={<Tag tone={p.tier === "l1" ? "neutral" : "iris"}>{p.tier.toUpperCase()}</Tag>}
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          <p className="text-[12px] text-muted">{t("currentTier")}</p>
          <p className="mt-0.5 font-serif text-[22px] font-semibold text-fg">{levelName(p.current, locale)}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-[12.5px]">
            <div>
              <dt className="text-muted">{t("cashback")}</dt>
              <dd className="mt-0.5 font-mono text-[15px] font-semibold tabular text-fg">{p.current.cashback_percent}%</dd>
            </div>
            <div>
              <dt className="text-muted">{t("cashbackTotal")}</dt>
              <dd className="mt-0.5 font-mono text-[15px] font-semibold tabular text-fg">{money(p.cashback_total)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted">{t("apiLimit")}</dt>
              <dd className="mt-0.5 text-fg">
                {p.current.api_requests_per_minute == null
                  ? t("apiUnlimited")
                  : t("apiValue", { requests: p.current.api_requests_per_minute, orders: p.current.api_orders_per_minute ?? "∞" })}
              </dd>
            </div>
          </dl>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-[12px] text-muted">{criterion}</p>
          <p className="mt-0.5 font-mono text-[20px] font-semibold tabular text-fg">{money(p.value)}</p>
          {next && p.next_min_amount != null ? (
            <>
              <ProgressBar value={p.value} max={p.next_min_amount} label={t("progressLabel", { tier: levelName(next, locale) })} className="mt-3" />
              <p className="mt-1.5 text-[12px] text-muted">
                {p.value >= p.next_min_amount
                  ? t("reachedNext", { tier: levelName(next, locale) })
                  : t("toNext", { amount: money(p.next_min_amount - p.value), tier: levelName(next, locale) })}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[12px] text-muted">{t("topTier")}</p>
          )}
          <p className="mt-2 text-[11.5px] text-faint">{t("updatedDaily")}</p>
        </div>
      </div>
    </Panel>
  );
}

function Ladder({ progress: p }: { progress: BuyerTierProgress }) {
  const t = useTranslations("buyerTier");
  const locale = useLocale();
  const { formatLedgerMoney } = useMoney();
  return (
    <Panel title={t("ladderTitle")} hint={t("ladderHint")}>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-[12.5px]">
          <thead className="bg-raised/40 text-left text-[11.5px] text-muted">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">{t("colTier")}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t(`criterion.${p.criterion}`)}</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t("cashback")}</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">{t("colApi")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {p.levels.map((level) => (
              <tr key={level.tier} className={cn(level.tier === p.tier && "bg-iris-soft/50")} aria-current={level.tier === p.tier ? "true" : undefined}>
                <th scope="row" className="px-4 py-2.5 text-left font-medium text-fg">
                  <span className="font-mono text-[11.5px] text-muted">{level.tier.toUpperCase()}</span> {levelName(level, locale)}
                  {level.tier === p.tier && <span className="ml-1.5 text-[11.5px] font-normal text-iris-hi">· {t("youAreHere")}</span>}
                </th>
                <td className="px-3 py-2.5 text-right font-mono tabular">{level.min_amount > 0 ? t("fromAmount", { amount: formatLedgerMoney(level.min_amount, locale) }) : "—"}</td>
                <td className="px-3 py-2.5 text-right font-mono tabular">{level.cashback_percent > 0 ? `${level.cashback_percent}%` : "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular">
                  {level.api_requests_per_minute == null ? t("unlimitedShort") : t("perMinute", { count: level.api_requests_per_minute })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link href="/account?tab=api" className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-iris-hi hover:underline">
        {t("apiLink")} <ArrowRight size={13} />
      </Link>
    </Panel>
  );
}

function History({ progress: p }: { progress: BuyerTierProgress }) {
  const t = useTranslations("buyerTier");
  const locale = useLocale();
  const name = (tier: string) => {
    const level = p.levels.find((l) => l.tier === tier);
    return level ? levelName(level, locale) : tier.toUpperCase();
  };
  return (
    <Panel title={t("historyTitle")}>
      <ol className="-my-2 divide-y divide-line">
        {p.history.map((e, i) => (
          <li key={`${e.created_at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-[12.5px]">
            <span className="text-fg">{name(e.old_tier)} → <b className="font-medium">{name(e.new_tier)}</b></span>
            <time dateTime={e.created_at} className="text-[11.5px] text-faint">{formatDate(e.created_at, locale)}</time>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
