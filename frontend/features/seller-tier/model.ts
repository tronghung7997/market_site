/** Display helpers for the seller "Tier & trust" page and the admin review. */

import type { TrustCriterion, TrustCriterionKey } from "../../lib/types.ts";

export const TIER_STEPS = ["new", "verified", "trusted", "enterprise"] as const;

/** How far along a criterion is, 0–1. "max_" criteria are full while at or
 *  under the limit and shrink as the rate climbs past it. */
export function criterionProgress(row: Pick<TrustCriterion, "key" | "value" | "target">): number {
  if (row.value == null) return 0;
  if (row.key.startsWith("max_")) {
    if (row.value <= row.target) return 1;
    return row.value > 0 ? Math.max(0, Math.min(1, row.target / row.value)) : 1;
  }
  if (row.target <= 0) return 1;
  return Math.max(0, Math.min(1, row.value / row.target));
}

export type CriterionUnit = "money" | "count" | "days" | "pct" | "score";

export const CRITERION_UNIT: Record<TrustCriterionKey, CriterionUnit> = {
  min_gmv: "money",
  min_orders: "count",
  min_days: "days",
  max_dispute_pct: "pct",
  max_one_star_pct: "pct",
  min_score: "score",
};

/** Criteria a seller has not met yet (skipped score rows do not count). */
export function missingCriteria(rows: TrustCriterion[]): TrustCriterion[] {
  return rows.filter((row) => row.met === false);
}

/** Score band label key: 85+ very good, 70+ good, 50+ fair, else low. */
export function scoreBand(score: number): "excellent" | "good" | "fair" | "low" {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  return "low";
}

export function formatPct(value: number, locale: string): string {
  return `${value.toLocaleString(locale === "vi" ? "vi-VN" : "en-US", { maximumFractionDigits: 1 })}%`;
}
