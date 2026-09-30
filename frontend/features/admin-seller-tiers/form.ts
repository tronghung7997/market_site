/** Trust-config editor state. Inputs are kept as strings so a field can be
 *  emptied while typing (a number state turned "" into 0); bounds mirror
 *  validate_config in marketplace-svc/src/sellers/trust.py so problems show
 *  next to the field instead of as an English 400 after saving. */

import type { SellerTrustConfig, TrustCriterionKey } from "../../lib/types.ts";
import { CRITERIA } from "./model.ts";

export const EDIT_TIERS = ["verified", "trusted", "enterprise"] as const;
export type EditTier = (typeof EDIT_TIERS)[number];

export interface TrustForm {
  window_days: string;
  min_orders_for_score: string;
  dispute_points: string;
  dispute_zero_at_pct: string;
  one_star_points: string;
  one_star_zero_at_pct: string;
  gmv_points: string;
  gmv_full_at: string;
  criteria: Record<EditTier, Record<TrustCriterionKey, string>>;
}

export type TrustFormErrors = Partial<Record<string, string>>;

const str = (v: number | null | undefined) => (v == null ? "" : String(v));

export function toForm(cfg: SellerTrustConfig): TrustForm {
  const criteria = {} as TrustForm["criteria"];
  for (const tier of EDIT_TIERS) {
    criteria[tier] = {} as Record<TrustCriterionKey, string>;
    for (const c of CRITERIA) criteria[tier][c.key] = str(cfg.criteria[tier]?.[c.key]);
  }
  return {
    window_days: str(cfg.window_days),
    min_orders_for_score: str(cfg.min_orders_for_score),
    dispute_points: str(cfg.score.dispute.points),
    dispute_zero_at_pct: str(cfg.score.dispute.zero_at_pct),
    one_star_points: str(cfg.score.one_star.points),
    one_star_zero_at_pct: str(cfg.score.one_star.zero_at_pct),
    gmv_points: str(cfg.score.gmv.points),
    gmv_full_at: str(cfg.score.gmv.full_at),
    criteria,
  };
}

const CRITERION_BOUNDS: Record<TrustCriterionKey, [number, number]> = {
  min_gmv: [0, 100_000_000_000], min_orders: [0, 10_000_000], min_days: [0, 3650],
  max_dispute_pct: [0, 100], max_one_star_pct: [0, 100], min_score: [0, 100],
};
const INTEGER_KEYS = new Set<TrustCriterionKey>(["min_gmv", "min_orders", "min_days", "min_score"]);

/** Decimal comma or dot both accepted: "2,5" and "2.5" are the same. */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function check(errors: TrustFormErrors, path: string, raw: string, low: number, high: number, opts: { integer?: boolean; optional?: boolean } = {}): number | null {
  const n = parseNumber(raw);
  if (n === null) {
    if (!opts.optional) errors[path] = "Bắt buộc";
    return null;
  }
  if (Number.isNaN(n)) { errors[path] = "Không phải số"; return null; }
  if (opts.integer && !Number.isInteger(n)) { errors[path] = "Phải là số nguyên"; return null; }
  if (n < low || n > high) { errors[path] = `Từ ${low.toLocaleString("vi-VN")} đến ${high.toLocaleString("vi-VN")}`; return null; }
  return n;
}

export function scorePoints(form: TrustForm): number {
  return [form.dispute_points, form.one_star_points, form.gmv_points]
    .reduce((sum, raw) => sum + (Number(parseNumber(raw)) || 0), 0);
}

/** The config to save, or the field errors that block it. */
export function fromForm(form: TrustForm): { config: SellerTrustConfig | null; errors: TrustFormErrors } {
  const e: TrustFormErrors = {};
  const window_days = check(e, "window_days", form.window_days, 7, 365, { integer: true });
  const min_orders_for_score = check(e, "min_orders_for_score", form.min_orders_for_score, 0, 10_000, { integer: true });
  const dp = check(e, "dispute_points", form.dispute_points, 0, 100, { integer: true });
  const dz = check(e, "dispute_zero_at_pct", form.dispute_zero_at_pct, 0.1, 100);
  const op = check(e, "one_star_points", form.one_star_points, 0, 100, { integer: true });
  const oz = check(e, "one_star_zero_at_pct", form.one_star_zero_at_pct, 0.1, 100);
  const gp = check(e, "gmv_points", form.gmv_points, 0, 100, { integer: true });
  const gf = check(e, "gmv_full_at", form.gmv_full_at, 1, 100_000_000_000, { integer: true });
  if (dp !== null && op !== null && gp !== null && dp + op + gp !== 100) e.points = `Tổng điểm phải bằng 100 (đang là ${dp + op + gp})`;

  const criteria = {} as SellerTrustConfig["criteria"];
  for (const tier of EDIT_TIERS) {
    criteria[tier] = {} as SellerTrustConfig["criteria"][EditTier];
    for (const c of CRITERIA) {
      const [low, high] = CRITERION_BOUNDS[c.key];
      criteria[tier][c.key] = check(e, `criteria.${tier}.${c.key}`, form.criteria[tier][c.key], low, high, { integer: INTEGER_KEYS.has(c.key), optional: true });
    }
  }
  if (Object.keys(e).length > 0) return { config: null, errors: e };
  return {
    config: {
      window_days: window_days!,
      min_orders_for_score: min_orders_for_score!,
      score: {
        dispute: { points: dp!, zero_at_pct: dz! },
        one_star: { points: op!, zero_at_pct: oz! },
        gmv: { points: gp!, full_at: gf! },
      },
      criteria,
    },
    errors: e,
  };
}

/** How many fields differ from the saved config (for the save bar). */
export function changedCount(form: TrustForm, saved: SellerTrustConfig): number {
  const a = toForm(saved);
  let n = 0;
  for (const k of Object.keys(a) as (keyof TrustForm)[]) {
    if (k === "criteria") continue;
    if (parseNumber(a[k] as string) !== parseNumber(form[k] as string)) n++;
  }
  for (const tier of EDIT_TIERS) for (const c of CRITERIA) {
    if (parseNumber(a.criteria[tier][c.key]) !== parseNumber(form.criteria[tier][c.key])) n++;
  }
  return n;
}
