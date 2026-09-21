"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import { useAffiliateMe } from "@/hooks/use-affiliate";
import { Spinner } from "@/components/ui";
import { ArrowRight } from "@/components/Icons";
import { AffiliateFunnel, ReferralLinkCard } from "@/features/affiliate";

/** Link + all-time funnel; the full dashboard with ranges and history is /affiliate. */
export function ReferralTab() {
  const t = useTranslations("account");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const stats = useAffiliateMe({});
  const config = useQuery({ queryKey: ["public-affiliate-config"], queryFn: api.publicAffiliateConfig, staleTime: 5 * 60_000 });
  if (stats.isPending || !stats.data) return <div className="grid place-items-center py-16"><Spinner /></div>;
  return (
    <div className="space-y-4">
      <ReferralLinkCard link={stats.data.link} code={stats.data.code} attributionDays={config.data?.attribution_days} />
      <AffiliateFunnel totals={stats.data.totals} formatMoney={(a) => formatBrowseMoney(a, { locale })} />
      <Link href="/affiliate" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-iris-hi hover:underline">
        {t("referralOpenDashboard")} <ArrowRight size={13} />
      </Link>
    </div>
  );
}
