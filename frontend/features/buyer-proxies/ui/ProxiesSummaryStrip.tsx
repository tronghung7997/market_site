"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui";
import { Activity, AlertTriangle, Clock, Globe } from "@/components/Icons";
import { runningShare, type ProxyLineSummary, type StatusTab } from "../model";

const SEGMENTS: { tab: StatusTab; icon: typeof Globe; tone: "neutral" | "good" | "warn" | "bad" }[] = [
  { tab: "", icon: Globe, tone: "neutral" },
  { tab: "running", icon: Activity, tone: "good" },
  { tab: "soon", icon: Clock, tone: "warn" },
  { tab: "problem", icon: AlertTriangle, tone: "bad" },
];
const TONE_TEXT = { neutral: "text-fg", good: "text-good", warn: "text-warn", bad: "text-bad" } as const;
const TONE_BAR = { neutral: "after:bg-fg", good: "after:bg-good", warn: "after:bg-warn", bad: "after:bg-bad" } as const;
const KEY: Record<StatusTab, keyof ProxyLineSummary> = { "": "all", running: "running", soon: "soon", problem: "problem" };

/** One segmented summary doubling as the status tab bar. `counts` are the
 *  list response's `facets.status` — they follow the tag / search / rail
 *  filters, so switching tab never lands on a surprise empty list; `total` is
 *  the unfiltered count shown as context while other filters narrow it.
 *  `null` while the first page loads. */
export function ProxiesSummaryStrip({
  summary, total, active, onSelect,
}: { summary: ProxyLineSummary | null; total: ProxyLineSummary | null; active: StatusTab; onSelect: (tab: StatusTab) => void }) {
  const t = useTranslations("buyerProxies");
  const narrowed = Boolean(summary && total && summary.all !== total.all);
  const hint = (tab: StatusTab) => {
    if (tab === "") return t("strip.hint.all");
    if (tab === "running") return t("strip.hint.running", { pct: summary ? runningShare(summary) : 0 });
    if (tab === "soon") return t("strip.hint.soon");
    return t("strip.hint.problem");
  };
  return (
    <Card className="overflow-hidden p-0">
      <div role="tablist" aria-label={t("strip.tabsLabel")} className="grid grid-cols-2 lg:grid-cols-4">
        {SEGMENTS.map(({ tab, icon: Icon, tone }, i) => {
          const selected = active === tab;
          const n = summary ? summary[KEY[tab]] : null;
          const muted = n === 0 && tab !== "";
          return (
            <button
              key={tab || "all"}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(selected && tab !== "" ? "" : tab)}
              className={cn(
                "relative flex flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris",
                i % 2 === 1 && "border-l border-line",
                i >= 2 && "border-t border-line lg:border-t-0",
                i === 2 && "lg:border-l",
                selected && cn("bg-raised/60 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5", TONE_BAR[tone]),
              )}
            >
              <span className={cn("flex items-center gap-1.5 text-[11.5px] font-medium", muted ? "text-faint" : TONE_TEXT[tone])}>
                <Icon size={13} /> {t(`strip.tab.${KEY[tab]}`)}
              </span>
              {n == null
                ? <span aria-hidden className="h-5 w-10 animate-pulse rounded bg-raised" />
                : <span className={cn("font-mono text-[20px] font-semibold leading-none tabular", muted ? "text-faint" : "text-fg")}>{n.toLocaleString()}</span>}
              <span className={cn("text-[11px]", tab === "soon" && (n ?? 0) > 0 ? "font-semibold text-warn" : "text-faint")}>
                {narrowed && total ? t("strip.ofTotal", { total: total[KEY[tab]].toLocaleString() }) : hint(tab)}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
