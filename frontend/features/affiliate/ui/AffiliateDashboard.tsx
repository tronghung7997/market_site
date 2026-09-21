"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { useAffiliateMe } from "@/hooks/use-affiliate";
import { Button, Spinner } from "@/components/ui";
import { ArrowRight, Wallet } from "@/components/Icons";
import { hasAnyActivity, rangeParams, type DateRange, type RangeKey } from "../model";
import { ActivityChart, AffiliateFunnel, CommissionsPanel, HowItWorks, RangePicker, ReferralLinkCard, ReferredUsersPanel } from "./AffiliateWidgets";

/** Storefront › Giới thiệu bạn bè: link, funnel for the chosen range, activity and payouts. */
export function AffiliateDashboard() {
  const t = useTranslations("affiliate");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const formatMoney = (amount: number) => formatBrowseMoney(amount, { locale });
  const [range, setRange] = React.useState<RangeKey>("30d");
  const [custom, setCustom] = React.useState<DateRange>({});
  const params = React.useMemo(() => rangeParams(range, custom), [range, custom]);
  const stats = useAffiliateMe(params);
  const config = useQuery({ queryKey: ["public-affiliate-config"], queryFn: api.publicAffiliateConfig, staleTime: 5 * 60_000 });

  const data = stats.data;
  const fresh = data ? !hasAnyActivity(data.totals) && range === "30d" : false;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[28px] tracking-tight text-fg">{t("title")}</h1>
          <p className="mt-1 text-[13px] text-muted">{t("subtitle")}</p>
        </div>
        <RangePicker value={range} custom={custom} onChange={(key, c) => { setRange(key); if (c) setCustom(c); }} />
      </div>

      {stats.isPending || !data ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <ReferralLinkCard link={data.link} code={data.code} attributionDays={config.data?.attribution_days} />
            <section className="flex flex-col justify-between rounded-card border border-line bg-card p-5 shadow-card">
              <div>
                <h2 className="text-[13.5px] font-semibold text-fg">{t("earningsTitle")}</h2>
                <p className="mt-2 font-mono text-[28px] font-semibold leading-none tabular-nums text-fg">{formatMoney(data.totals.commission)}</p>
                <p className="mt-1.5 text-[12.5px] text-muted">
                  {t("earningsOrders", { count: data.totals.orders })}
                  {config.data && (config.data.earning_days > 0 ? ` · ${t("earningWindow", { days: config.data.earning_days })}` : ` · ${t("earningLifetime")}`)}
                </p>
              </div>
              <Link href="/wallet" className="mt-4 inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-iris-hi hover:underline">
                <Wallet size={15} /> {t("withdrawFromWallet")} <ArrowRight size={13} />
              </Link>
            </section>
          </div>

          {fresh ? (
            <section className="rounded-card border border-iris/30 bg-iris-soft/40 p-5">
              <h2 className="text-[14px] font-semibold text-fg">{t("startTitle")}</h2>
              <p className="mt-1 text-[12.5px] text-muted">{t("startBody")}</p>
              <div className="mt-4"><HowItWorks compact className="border-0 bg-transparent p-0 shadow-none" /></div>
            </section>
          ) : (
            <AffiliateFunnel totals={data.totals} formatMoney={formatMoney} />
          )}

          <ActivityChart series={data.timeseries} formatMoney={formatMoney} />

          <div className="grid gap-4 lg:grid-cols-2">
            <ReferredUsersPanel users={data.referred_users} formatMoney={formatMoney} />
            <CommissionsPanel rows={data.commissions} formatMoney={formatMoney} />
          </div>

          {!fresh && <HowItWorks />}

          {stats.isFetching && <p className="text-center text-[12px] text-faint">{t("refreshing")}</p>}
          {stats.isError && (
            <p className="text-center text-[12.5px] text-bad">{t("loadError")} <Button size="sm" variant="secondary" className="ml-2" onClick={() => void stats.refetch()}>{t("retry")}</Button></p>
          )}
        </div>
      )}
    </div>
  );
}
