"use client";

/** The wallet does not cover the order: say by how much and top up exactly
 *  that, coming back to the same product afterwards. */

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useMoney } from "@/lib/money";
import { AlertCircle } from "@/components/Icons";
import { topUpHref } from "../model";

export function WalletShortfall({ shortfall, returnPath }: { shortfall: number; returnPath: string }) {
  const t = useTranslations("products");
  const locale = useLocale();
  const { formatCheckoutMoney } = useMoney();
  const amount = formatCheckoutMoney(shortfall, { locale });
  return (
    <div role="status" className="rounded-md border border-warn/25 bg-warn-soft px-3 py-2.5">
      <div className="flex items-start gap-2">
        <AlertCircle size={14} className="text-warn mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-fg">{t("shortfallTitle", { amount })}</p>
          <p className="mt-0.5 text-[12px] text-muted">{t("shortfallBody")}</p>
        </div>
      </div>
      <Link
        href={topUpHref(shortfall, returnPath)}
        className="mt-2.5 inline-flex h-9 w-full items-center justify-center rounded-lg bg-iris text-[13px] font-medium text-white hover:brightness-110 transition"
      >
        {t("topUpShortfall", { amount })}
      </Link>
    </div>
  );
}
