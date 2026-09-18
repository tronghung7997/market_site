"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { AlertTriangle, ArrowRight } from "@/components/Icons";

/**
 * Solid red strip across the very top of every admin page while maintenance
 * or a kill-switch is on — so nobody forgets to turn it off. Renders nothing
 * when everything is open.
 */
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-bad px-6 py-2.5 text-[13px] text-surface" role="alert">
      <AlertTriangle size={16} className="shrink-0" />
      <span className="font-semibold">{t("activeNow")}</span>
      <span className="flex flex-wrap gap-1.5">
        {flags.map((f) => <span key={f} className="rounded-full bg-surface/15 px-2.5 py-0.5 font-medium">{f}</span>)}
      </span>
      <Link href="/admin/display-settings?tab=system" className="ml-auto inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-[12.5px] font-semibold text-bad hover:bg-surface/90">
        {t("openSystemTab")}<ArrowRight size={13} />
      </Link>
    </div>
  );
}
