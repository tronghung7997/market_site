"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth";
import { AlertTriangle } from "@/components/Icons";

/** Slim bar under the top nav for signed-in accounts that never confirmed their email. */
export function EmailVerificationBanner() {
  const t = useTranslations("auth");
  const { account } = useAuth();
  const pathname = usePathname();
  if (!account || account.email_verified !== false) return null;
  if (pathname?.includes("/verify-email")) return null;
  return (
    <div className="border-b border-warn/25 bg-warn-soft text-warn" role="status">
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px] sm:px-6">
        <AlertTriangle size={15} className="shrink-0" />
        <span className="min-w-0 flex-1">{t("bannerUnverified")}</span>
        <Link href="/verify-email" className="font-medium underline-offset-2 hover:underline">{t("bannerAction")}</Link>
      </div>
    </div>
  );
}
