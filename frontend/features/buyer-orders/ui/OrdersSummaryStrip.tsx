"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import type { OrderStats } from "@/lib/types";
import { Card } from "@/components/ui";
import { AlertCircle, CheckCircle2, Clock, Inbox, ShieldCheck, Wallet } from "@/components/Icons";
import { tabCount, type BuyerOrderTab } from "../model";

const SEGMENTS: { tab: BuyerOrderTab; icon: typeof Inbox; tone: "bad" | "warn" | "iris" | "good" | "neutral" }[] = [
  { tab: "", icon: Inbox, tone: "neutral" },
  { tab: "awaiting_confirm", icon: ShieldCheck, tone: "warn" },
  { tab: "active", icon: Clock, tone: "iris" },
  { tab: "disputed", icon: AlertCircle, tone: "bad" },
  { tab: "deleted", icon: CheckCircle2, tone: "neutral" },
];

const TONE_TEXT = { bad: "text-bad", warn: "text-warn", iris: "text-iris-hi", good: "text-good", neutral: "text-fg" } as const;
// Selected segment = tinted cell + a 2px accent bar along the bottom edge (a
// tab underline). An inset ring fought the cell borders and the card's rounded
// corners and read as a misaligned box.
const TONE_BAR = { bad: "after:bg-bad", warn: "after:bg-warn", iris: "after:bg-iris", good: "after:bg-good", neutral: "after:bg-fg" } as const;

const TAB_KEY: Record<BuyerOrderTab, "all" | "active" | "awaiting_confirm" | "disputed" | "deleted"> = {
  "": "all", active: "active", awaiting_confirm: "awaiting_confirm", disputed: "disputed", deleted: "deleted",
};

/** One segmented summary that doubles as the tab bar. Counts are account-wide
 *  (`/orders/stats`), clicking a segment filters the list; the trailing cell
 *  is the spend total and is informational only. */
export function OrdersSummaryStrip({
  stats,
  active,
  onSelect,
}: {
  stats: OrderStats | null | undefined;
  active: BuyerOrderTab;
  onSelect: (tab: BuyerOrderTab) => void;
}) {
  const t = useTranslations("buyerOrders");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const loading = !stats;

  return (
    <Card className="overflow-hidden p-0">
      <div role="tablist" aria-label={t("tabsLabel")} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {SEGMENTS.map(({ tab, icon: Icon, tone }, i) => {
          const selected = active === tab;
          const count = tabCount(stats, tab);
          const urgent = tab === "awaiting_confirm" ? (stats?.awaiting_confirm ?? 0) : 0;
          const muted = count === 0 && tab !== "";
          return (
            <button
              key={tab || "all"}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(selected && tab !== "" ? "" : tab)}
              className={cn(
                "relative flex flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris",
                i > 0 && "border-t border-line sm:border-t-0 lg:border-l",
                i % 2 === 1 && "border-l border-line sm:border-l-0",
                i % 3 !== 0 && "sm:border-l sm:border-line",
                i >= 3 && "sm:border-t sm:border-line lg:border-t-0",
                selected && cn("bg-raised/60 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5", TONE_BAR[tone]),
              )}
            >
              <span className={cn("flex items-center gap-1.5 text-[11.5px] font-medium", muted ? "text-faint" : TONE_TEXT[tone])}>
                <Icon size={13} /> {t(`tab.${TAB_KEY[tab]}`)}
              </span>
              <span className={cn("font-mono text-[20px] font-semibold leading-none tabular", muted ? "text-faint" : "text-fg")}>
                {loading ? <span className="inline-block h-5 w-8 animate-pulse rounded bg-raised" /> : count?.toLocaleString()}
              </span>
              <span className={cn("text-[11px]", urgent > 0 ? "font-semibold text-warn" : "text-faint")}>
                {tab === "awaiting_confirm"
                  ? (urgent > 0 ? t("awaitingUrgent", { count: urgent }) : t("awaitingNone"))
                  : t(`hint.${TAB_KEY[tab]}`)}
              </span>
            </button>
          );
        })}

        <div
          className={cn(
            "flex flex-col gap-1 px-4 py-3 text-left",
            "border-t border-line sm:border-t-0 lg:border-l",
            "border-l border-line sm:border-l-0",
            "sm:border-l sm:border-line",
            "sm:border-t sm:border-line lg:border-t-0",
          )}
        >
          <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-fg">
            <Wallet size={13} /> {t("spent")}
          </span>
          <span className="truncate font-mono text-[16px] font-semibold leading-none tabular text-fg pt-0.5">
            {loading ? <span className="inline-block h-5 w-16 animate-pulse rounded bg-raised" /> : formatBrowseMoney(stats.total_spend, { locale })}
          </span>
          <span className="text-[11px] text-faint">{t("spentHint")}</span>
        </div>
      </div>
    </Card>
  );
}

