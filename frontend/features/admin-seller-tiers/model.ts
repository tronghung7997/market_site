/** Admin wording for seller tiers and trust criteria, shared by the tier
 *  review page and the account's "Hạng & uy tín" tab. Admin copy is
 *  Vietnamese-only, like the rest of the admin console. */

import type { SellerTierName, TrustCriterion, TrustCriterionKey, TrustScorePart } from "../../lib/types.ts";

export const TIER_ORDER: SellerTierName[] = ["new", "verified", "trusted", "enterprise"];

export const TIER_NAME: Record<SellerTierName, string> = {
  new: "Mới", verified: "Đã xác minh", trusted: "Uy tín", enterprise: "Doanh nghiệp",
};

type CriterionUnit = "₫" | "đơn" | "ngày" | "%" | "điểm";

/** Config editor rows and account-tab rows, in the order the design lists them. */
export const CRITERIA: { key: TrustCriterionKey; label: string; op: "≥" | "≤"; unit: CriterionUnit; keep?: boolean }[] = [
  { key: "min_gmv", label: "Doanh số hoàn tất (trọn đời)", op: "≥", unit: "₫" },
  { key: "min_orders", label: "Đơn hoàn tất (trọn đời)", op: "≥", unit: "đơn" },
  { key: "min_days", label: "Số ngày bán", op: "≥", unit: "ngày" },
  { key: "max_dispute_pct", label: "Tỉ lệ khiếu nại", op: "≤", unit: "%", keep: true },
  { key: "max_one_star_pct", label: "Tỉ lệ 1 sao", op: "≤", unit: "%", keep: true },
  { key: "min_score", label: "Điểm uy tín", op: "≥", unit: "điểm", keep: true },
];

export const CRITERION_SHORT: Record<TrustCriterionKey, string> = {
  min_gmv: "doanh số", min_orders: "số đơn", min_days: "ngày bán",
  max_dispute_pct: "khiếu nại", max_one_star_pct: "1 sao", min_score: "điểm",
};

export const SCORE_PART_LABEL: Record<TrustScorePart, string> = {
  dispute: "Khiếu nại", one_star: "Đánh giá 1 sao", gmv: "Doanh số trong kỳ",
};

export function criterionUnit(key: TrustCriterionKey): CriterionUnit {
  return CRITERIA.find((c) => c.key === key)?.unit ?? "điểm";
}

/** One criterion value with its unit, e.g. "2,4%" or "138 đơn". Money is left
 *  to the caller's currency formatter. */
export function formatCriterion(key: TrustCriterionKey, value: number | null, money: (amount: number) => string): string {
  if (value == null) return "—";
  const unit = criterionUnit(key);
  if (unit === "₫") return money(value);
  if (unit === "%") return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
  if (unit === "điểm") return String(value);
  return `${value.toLocaleString("vi-VN")} ${unit}`;
}

/** The criteria a seller still misses for the next tier, as short names. */
export function missingShort(rows: Pick<TrustCriterion, "key" | "met">[]): string[] {
  return rows.filter((row) => row.met === false).map((row) => CRITERION_SHORT[row.key]);
}

/** A tier change needs a reason; it is kept in the history and audit log. */
export const TIER_REASON_MAX = 500;

export function tierChangeReady(current: SellerTierName, target: SellerTierName, reason: string): boolean {
  const length = reason.trim().length;
  return target !== current && length > 0 && length <= TIER_REASON_MAX;
}
