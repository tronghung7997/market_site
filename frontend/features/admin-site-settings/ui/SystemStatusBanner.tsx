"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { AlertTriangle } from "@/components/Icons";
import { Tag } from "@/components/ui";

/** Red strip on the admin overview while maintenance or a kill-switch is on — so nobody forgets to turn it off. */
export function SystemStatusBanner() {
  const t = useTranslations("adminSystem");
  const { data } = useQuery({ queryKey: queryKeys.adminSiteStatus(), queryFn: api.adminSiteStatus, refetchInterval: 60_000 });
  if (!data) return null;
  const flags = [
    data.maintenance_enabled && t("flagMaintenance"),
    data.withdrawals_frozen && t("flagWithdrawals"),
    data.deposits_frozen && t("flagDeposits"),
    data.orders_frozen && t("flagOrders"),
  ].filter(Boolean) as string[];
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-bad/25 bg-bad-soft px-4 py-3 text-[13px] text-bad" role="status">
      <AlertTriangle size={15} className="shrink-0" />
      <span className="font-semibold">{t("activeNow")}</span>
      {flags.map((f) => <Tag key={f} tone="bad">{f}</Tag>)}
      <Link href="/admin/display-settings?tab=system" className="ml-auto font-medium underline-offset-2 hover:underline">{t("openSystemTab")}</Link>
    </div>
  );
}
