"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Icons";
import { formatDateTime } from "@/lib/utils";
import { useSiteStatus } from "../data";

/**
 * Replaces the storefront with the maintenance notice while the switch is
 * on. Admins keep browsing (the backend lets their token through too), so
 * they can verify a fix before reopening.
 */
export function MaintenanceGate({ children }: { children: ReactNode }) {
  const t = useTranslations("siteStatus");
  const locale = useLocale();
  const { account } = useAuth();
  const { data } = useSiteStatus();
  const isAdmin = Boolean(account?.roles.includes("admin"));

  if (!data?.maintenance_enabled || isAdmin) return <>{children}</>;
  const message = (locale === "vi" ? data.maintenance_message_vi : data.maintenance_message_en)
    || data.maintenance_message_vi || data.maintenance_message_en;

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16 aura">
      <div className="w-full max-w-[520px] text-center">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <h1 className="font-serif text-[30px] font-semibold tracking-tight text-fg sm:text-[34px]">{t("maintenanceTitle")}</h1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-muted">{message || t("maintenanceDefault")}</p>
        {data.maintenance_until && (
          <p className="mt-4 inline-block rounded-full border border-line bg-card px-3 py-1 text-[12.5px] text-muted">
            {t("maintenanceUntil", { at: formatDateTime(data.maintenance_until, locale) })}
          </p>
        )}
        <p className="mt-6 text-[12px] text-faint">{t("maintenanceFooter")}</p>
      </div>
    </div>
  );
}
