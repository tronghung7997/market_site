"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { SellerOrderCounts, SellerOrderTab } from "@/lib/types";
import { Card } from "@/components/ui";
import { AlertCircle, CheckCircle2, Clock, Inbox, ShieldCheck, X } from "@/components/Icons";

const SEGMENTS: { tab: SellerOrderTab; icon: typeof Inbox; tone: "bad" | "warn" | "iris" | "good" | "neutral" }[] = [
  { tab: "all", icon: Inbox, tone: "neutral" },
  { tab: "disputed", icon: AlertCircle, tone: "bad" },
  { tab: "action_required", icon: Clock, tone: "warn" },
  { tab: "escrow", icon: ShieldCheck, tone: "iris" },
  { tab: "completed", icon: CheckCircle2, tone: "good" },
  { tab: "cancelled", icon: X, tone: "neutral" },
];

const TONE_TEXT = { bad: "text-bad", warn: "text-warn", iris: "text-iris-hi", good: "text-good", neutral: "text-fg" } as const;
// Selected segment = tinted cell + a 2px accent bar along the bottom edge (a
// tab underline). An inset ring fought the cell borders and the card's rounded
// corners and read as a misaligned box.
const TONE_BAR = { bad: "after:bg-bad", warn: "after:bg-warn", iris: "after:bg-iris", good: "after:bg-good", neutral: "after:bg-fg" } as const;

/** One segmented summary that doubles as the tab bar: counts are store-wide,
 *  clicking a segment filters the list. */
export function OrdersSummaryStrip({
  counts,
  active,
  onSelect,
}: {
  counts: SellerOrderCounts;
  active: SellerOrderTab;
  onSelect: (tab: SellerOrderTab) => void;
}) {
  const t = useTranslations("sellerOrders");
  return (
    <Card className="overflow-hidden p-0">
      <div role="tablist" aria-label={t("tabsLabel")} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {SEGMENTS.map(({ tab, icon: Icon, tone }, i) => {
          const selected = active === tab;
          const count = counts[tab];
          const urgent = tab === "disputed" ? counts.disputes_awaiting_seller : 0;
          const muted = count === 0 && tab !== "all";
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(selected && tab !== "all" ? "all" : tab)}
              className={cn(
                "relative flex flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-raised/60",
                i > 0 && "border-t border-line sm:border-t-0 lg:border-l",
                i % 2 === 1 && "border-l border-line sm:border-l-0",
                i % 3 !== 0 && "sm:border-l sm:border-line",
                i >= 3 && "sm:border-t sm:border-line lg:border-t-0",
                selected && cn("bg-raised/60 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5", TONE_BAR[tone]),
              )}
            >
              <span className={cn("flex items-center gap-1.5 text-[11.5px] font-medium", muted ? "text-faint" : TONE_TEXT[tone])}>
                <Icon size={13} /> {t(`tab.${tab}`)}
              </span>
              <span className={cn("font-mono text-[20px] font-semibold leading-none tabular", muted ? "text-faint" : "text-fg")}>
                {count.toLocaleString()}
              </span>
              <span className={cn("text-[11px]", urgent > 0 ? "font-semibold text-bad" : "text-faint")}>
                {tab === "disputed"
                  ? (urgent > 0 ? t("disputesUrgent", { count: urgent }) : t("disputesAnswered"))
                  : t(`hint.${tab}`)}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
