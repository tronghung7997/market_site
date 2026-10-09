"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money";
import { useAffiliateMe } from "@/hooks/use-affiliate";
import { useWalletBalance } from "@/hooks/use-wallet";
import { queryKeys } from "@/lib/query-keys";
import { Button, Spinner } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowRight, Wallet } from "@/components/Icons";
import { WithdrawCard as WithdrawForm } from "@/features/wallet-withdraw";
import { hasAnyActivity, hasCustomTerms, rangeParams, type DateRange, type RangeKey } from "../model";
import type { AffiliateCustomTerms } from "@/lib/types";
import { ActivityChart, AffiliateFunnel, CommissionsPanel, HowItWorks, PromoCodesPanel, RangePicker, ReferralLinkCard, ReferredUsersPanel, type MoneyFormatter } from "./AffiliateWidgets";

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
  const apiErrorMessage = useApiErrorMessage();
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

      {stats.isError && !data ? (
        <div role="alert" className="rounded-card border border-bad/25 bg-bad-soft px-5 py-6 text-center">
          <p className="text-[13.5px] font-medium text-bad">{apiErrorMessage(stats.error, t("loadFailed"))}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => void stats.refetch()}>{t("retry")}</Button>
        </div>
      ) : stats.isPending || !data ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <ReferralLinkCard link={data.link} code={data.code} attributionDays={config.data?.attribution_days} />
            <CommissionCard
              walletAvailable={data.totals.wallet_available}
              withdrawable={data.totals.withdrawable_commission ?? 0}
              earned={data.totals.available_commission}
              commissionOnly={data.withdraw_source !== "seller_balance"}
              terms={data.custom_terms ?? null}
              earningDays={config.data?.earning_days}
              formatMoney={formatMoney}
            />
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

          <PromoCodesPanel codes={data.promo_codes ?? []} formatMoney={formatMoney} />

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

/** Where the commission went (the main wallet) and how to take it out.
 *  A seller withdraws its whole balance from the wallet page; anyone else
 *  withdraws only the commission it earned, right here in a dialog that
 *  reuses the wallet's withdrawal form. */
function CommissionCard({ walletAvailable, withdrawable, earned, commissionOnly, terms, earningDays, formatMoney }: {
  walletAvailable: number;
  withdrawable: number;
  earned: number;
  commissionOnly: boolean;
  terms: AffiliateCustomTerms | null;
  earningDays?: number;
  formatMoney: MoneyFormatter;
}) {
  const t = useTranslations("affiliate");
  const [open, setOpen] = React.useState(false);
  const custom = hasCustomTerms(terms);
  const days = custom && terms?.earning_days != null ? terms.earning_days : earningDays;
  const windowText = days == null ? null : days > 0 ? t("earningWindow", { days }) : t("earningLifetime");
  return (
    <section className="flex flex-col justify-between rounded-card border border-line bg-card p-5 shadow-card">
      <div>
        <h2 className="text-[13.5px] font-semibold text-fg">{t("withdrawTitle")}</h2>
        <p className="mt-2 text-[12px] text-muted">{commissionOnly ? t("withdrawableLabel") : t("withdrawBalance")}</p>
        <p className="mt-1 font-mono text-[28px] font-semibold leading-none tabular-nums text-fg">
          {formatMoney(commissionOnly ? withdrawable : walletAvailable)}
        </p>
        {commissionOnly && <p className="mt-1.5 text-[12px] text-faint">{t("walletBalanceLine", { amount: formatMoney(walletAvailable) })}</p>}
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{commissionOnly ? t("withdrawExplainerKol") : t("withdrawExplainer")}</p>
        {custom && terms ? (
          <p className="mt-3 rounded-lg border border-iris/25 bg-iris-soft/50 px-3 py-2 text-[12.5px] text-fg">
            {t("customTerms")}{" "}
            <span className="font-medium">
              {[terms.commission_percent_of_fee != null ? t("customRate", { rate: terms.commission_percent_of_fee }) : null, windowText]
                .filter(Boolean).join(" · ")}
            </span>
          </p>
        ) : windowText ? (
          <p className="mt-2 text-[12px] text-faint">{t("commissionWindow", { window: windowText })}</p>
        ) : null}
        {commissionOnly && withdrawable <= 0 && <p className="mt-3 text-[12px] text-muted">{t(earned > 0 ? "withdrawAllRequested" : "withdrawNothing")}</p>}
      </div>
      {commissionOnly ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button size="sm" onClick={() => setOpen(true)} disabled={withdrawable <= 0}>
            <Wallet size={15} /> {t("withdrawOpen")}
          </Button>
          <Link href="/wallet#withdraw" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-iris-hi hover:underline">
            {t("withdrawHistoryCta")} <ArrowRight size={13} />
          </Link>
          <CommissionWithdrawDialog open={open} onOpenChange={setOpen} />
        </div>
      ) : (
        <Link href="/wallet" className="mt-4 inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-iris-hi hover:underline">
          <Wallet size={15} /> {t("withdrawCta")} <ArrowRight size={13} />
        </Link>
      )}
    </section>
  );
}

/** The wallet's withdrawal form, in commission-only mode (the server caps it). */
function CommissionWithdrawDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("affiliate");
  const queryClient = useQueryClient();
  const wallet = useWalletBalance(open);
  const onChanged = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.wallet() }),
      queryClient.invalidateQueries({ queryKey: ["affiliate-me"] }),
    ]);
  }, [queryClient]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto border-line bg-card p-5 shadow-card-lg sm:rounded-card">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-[16px] font-semibold text-fg">{t("withdrawDialogTitle")}</DialogTitle>
          <DialogDescription className="text-[12.5px] text-muted">{t("withdrawDialogBody")}</DialogDescription>
        </DialogHeader>
        {wallet.isPending ? (
          <div className="grid place-items-center py-10"><Spinner /></div>
        ) : (
          <WithdrawForm bare wallet={wallet.data ?? null} onChanged={onChanged} />
        )}
      </DialogContent>
    </Dialog>
  );
}
