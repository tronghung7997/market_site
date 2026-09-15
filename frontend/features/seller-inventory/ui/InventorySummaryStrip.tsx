"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { InventoryPackageCounts, InventoryStockTab } from "@/lib/types";
import { Card } from "@/components/ui";
import { STOCK_TABS } from "../model";

const TONE: Record<InventoryStockTab, "neutral" | "warn" | "bad" | "muted"> = {
  all: "neutral", low: "warn", out: "bad", error: "bad", inactive: "muted",
};
const TONE_TEXT = { neutral: "text-fg", warn: "text-warn", bad: "text-bad", muted: "text-faint" } as const;
const TONE_RING = { neutral: "ring-iris/40", warn: "ring-warn/40", bad: "ring-bad/40", muted: "ring-line-2" } as const;

/** One segmented summary = tab bar (DESIGN.md §10): every cell is a filter. */
export function InventorySummaryStrip({
  counts,
  threshold,
  active,
  onSelect,
}: {
  counts: InventoryPackageCounts;
  threshold: number;
  active: InventoryStockTab;
  onSelect: (tab: InventoryStockTab) => void;
}) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const cells: { key: InventoryStockTab; value: number; hint: string }[] = [
    { key: "all", value: counts.all, hint: t("strip.allHint", { count: counts.available_total.toLocaleString(locale) }) },
    { key: "low", value: counts.low, hint: t("strip.lowHint", { threshold }) },
    { key: "out", value: counts.out, hint: t("strip.outHint") },
    { key: "error", value: counts.error, hint: t("strip.errorHint") },
    { key: "inactive", value: counts.inactive, hint: t("strip.inactiveHint") },
  ];
  return (
    <Card className="overflow-hidden p-0">
      <div role="tablist" aria-label={t("strip.label")} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {cells.map((cell, i) => {
          const selected = active === cell.key;
          const tone = TONE[cell.key];
          const muted = cell.value === 0 && cell.key !== "all";
          return (
            <button
              key={cell.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(selected && cell.key !== "all" ? "all" : cell.key)}
              className={cn(
                "flex flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-raised/60",
                i > 0 && "border-t border-line sm:border-t-0 lg:border-l",
                i % 2 === 1 && "border-l border-line sm:border-l-0",
                i % 3 !== 0 && "sm:border-l sm:border-line",
                i >= 3 && "sm:border-t sm:border-line lg:border-t-0",
                selected && cn("bg-raised/50 ring-2 ring-inset", TONE_RING[tone]),
              )}
            >
              <span className={cn("text-[11.5px] font-medium", muted ? "text-faint" : TONE_TEXT[tone])}>{t(`strip.${cell.key}`)}</span>
              <span className={cn("font-mono text-[20px] font-semibold leading-none tabular", muted ? "text-faint" : "text-fg")}>
                {cell.value.toLocaleString(locale)}
              </span>
              <span className="text-[11px] text-faint">{cell.hint}</span>
            </button>
          );
        })}
        <div className={cn(STOCK_TABS.length % 2 === 1 && "border-t border-line sm:border-t-0", "flex flex-col gap-1 border-line px-4 py-3 sm:border-l lg:border-t-0")}>
          <span className="text-[11.5px] font-medium text-good">{t("strip.sold")}</span>
          <span className="font-mono text-[20px] font-semibold leading-none tabular text-fg">{counts.sold_30d.toLocaleString(locale)}</span>
          <span className="text-[11px] text-faint">{t("strip.soldHint")}</span>
        </div>
      </div>
    </Card>
  );
}
