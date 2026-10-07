"use client";

/** "Còn 1.234" with the count in green mono, so a buyer reads how much is
 *  ready at a glance; a running-low offer adds an amber "Sắp hết". */

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

export function StockCount({ count, low = false, className }: { count: number; low?: boolean; className?: string }) {
  const t = useTranslations("common");
  const locale = useLocale();
  return (
    <span className={cn("whitespace-nowrap", className)}>
      {t.rich("stockLeft", {
        count: count.toLocaleString(locale === "vi" ? "vi-VN" : "en-US"),
        n: (chunks) => <span className="font-mono tabular font-semibold text-good">{chunks}</span>,
      })}
      {low && <span className="ml-1.5 font-medium text-warn">{t("stockLow")}</span>}
    </span>
  );
}
