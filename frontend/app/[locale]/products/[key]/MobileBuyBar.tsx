"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";

export default function MobileBuyBar({ visible, total, fallbackText, onGoToPanel }: {
  visible: boolean;
  total: number | null;
  fallbackText: string;
  onGoToPanel: () => void;
}) {
  const t = useTranslations("products");
  const locale = useLocale();
  const { formatCheckoutMoney } = useMoney();
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 lg:hidden flex items-center gap-3",
        "border-t border-line bg-surface/95 backdrop-blur-md",
        "px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]",
        "transition-transform duration-200",
        visible ? "translate-y-0" : "translate-y-full pointer-events-none",
      )}
    >
      <div className="min-w-0 flex-1">
        {total != null ? (
          <>
            <div className="text-[10.5px] uppercase tracking-wider text-faint">{t("mobileTotal")}</div>
            <div className="font-mono text-[16px] font-bold tabular leading-tight">{formatCheckoutMoney(total, { locale })}</div>
          </>
        ) : (
          <div className="text-[12.5px] text-muted truncate">{fallbackText}</div>
        )}
      </div>
      <Button tabIndex={visible ? 0 : -1} onClick={onGoToPanel}>{t("mobileCta")}</Button>
    </div>
  );
}
