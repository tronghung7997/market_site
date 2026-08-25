"use client";

import type { ChecklistItem } from "./index.ts";
import { cn } from "@/lib/cn";
import { useTranslations } from "next-intl";

export function SellerSellableChecklist({
  checks,
  isSellable,
  passCount,
  totalCount,
}: {
  checks: ChecklistItem[];
  isSellable: boolean;
  passCount: number;
  totalCount: number;
}) {
  const t = useTranslations("seller.workbench");

  return (
    <div className="bg-card p-5 rounded-xl border border-line shadow-card space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[12px] font-bold uppercase tracking-wider text-fg flex items-center gap-1.5">
          <span>{t("checklistTitle")}</span>
        </h4>
        <span
          className={cn(
            "text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full border",
            isSellable
              ? "text-good bg-good-soft border-good/25"
              : "text-bad bg-bad-soft border-bad/25",
          )}
        >
          {t("passedCount", { passed: passCount, total: totalCount })}
        </span>
      </div>

      <div className="space-y-2 text-[12.5px]">
        {checks.map((c) => (
          <div
            key={c.key}
            className={cn(
              "flex items-center gap-2.5",
              c.pass ? "text-good font-medium" : "text-faint",
            )}
          >
            <span
              className={cn(
                "w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                c.pass ? "bg-good text-panel" : "bg-raised text-faint",
              )}
            >
              {c.pass ? "✓" : "—"}
            </span>
            <span className={c.pass ? "text-fg" : "text-muted"}>{t(c.labelKey)}</span>
          </div>
        ))}
      </div>

      <div className="pt-3 border-t border-line flex items-center justify-between">
        <span className="text-[12px] text-muted">{t("saleStatus")}</span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold",
            isSellable
              ? "bg-good text-panel shadow-xs"
              : "bg-raised text-muted border border-line",
          )}
        >
          {isSellable ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-panel animate-pulse" />
              {t("readyToPublish")}
            </>
          ) : (
            t("notReady")
          )}
        </span>
      </div>
    </div>
  );
}
