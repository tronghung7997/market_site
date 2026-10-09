/** Buyer-tier settings editor state. Inputs stay strings while typing; the
 *  bounds mirror validate_config in marketplace-svc/src/buyer_tiers/config.py
 *  so problems show next to the field instead of as a 422 after saving. */

import type { BuyerTierConfig, BuyerTierCriterion, BuyerTierName } from "../../lib/types.ts";

export const BUYER_TIERS: BuyerTierName[] = ["l1", "l2", "l3"];
export const NAME_MAX = 40;
export const CASHBACK_MAX = 50;
export const API_MAX = 100_000;
/** Public-API flood guard per client IP (requests per minute, every tier). */
export const IP_LIMIT = { min: 60, max: 10_000, default: 500 } as const;
const AMOUNT_MAX = 100_000_000_000;

export interface LevelForm {
  name_vi: string;
  name_en: string;
  min_amount: string;
  cashback_percent: string;
  /** Blank = no per-key limit. */
  api_requests_per_minute: string;
  api_orders_per_minute: string;
}

export interface BuyerTierForm {
  criterion: BuyerTierCriterion;
  ip_requests_per_minute: string;
  levels: Record<BuyerTierName, LevelForm>;
}

export type BuyerTierFormErrors = Partial<Record<string, string>>;

const str = (v: number | null | undefined) => (v == null ? "" : String(v));

export function toBuyerForm(cfg: BuyerTierConfig): BuyerTierForm {
  const levels = {} as BuyerTierForm["levels"];
  for (const tier of BUYER_TIERS) {
    const l = cfg.levels[tier];
    levels[tier] = {
      name_vi: l.name_vi, name_en: l.name_en, min_amount: str(l.min_amount), cashback_percent: str(l.cashback_percent),
      api_requests_per_minute: str(l.api_requests_per_minute), api_orders_per_minute: str(l.api_orders_per_minute),
    };
  }
  return { criterion: cfg.criterion, ip_requests_per_minute: str(cfg.ip_requests_per_minute ?? IP_LIMIT.default), levels };
}

function num(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function check(
  errors: BuyerTierFormErrors, path: string, raw: string, low: number, high: number,
  opts: { integer?: boolean; optional?: boolean } = {},
): number | null {
  const n = num(raw);
  if (n === null) {
    if (!opts.optional) errors[path] = "Bắt buộc";
    return null;
  }
  if (Number.isNaN(n)) { errors[path] = "Không phải số"; return null; }
  if (opts.integer && !Number.isInteger(n)) { errors[path] = "Phải là số nguyên"; return null; }
  if (n < low || n > high) { errors[path] = `Từ ${low.toLocaleString("vi-VN")} đến ${high.toLocaleString("vi-VN")}`; return null; }
  return n;
}

/** The settings to save, or the field errors that block it. */
export function fromBuyerForm(form: BuyerTierForm): { config: BuyerTierConfig | null; errors: BuyerTierFormErrors } {
  const e: BuyerTierFormErrors = {};
  const levels = {} as BuyerTierConfig["levels"];
  for (const tier of BUYER_TIERS) {
    const f = form.levels[tier];
    for (const key of ["name_vi", "name_en"] as const) {
      const v = f[key].trim();
      if (!v) e[`${tier}.${key}`] = "Bắt buộc";
      else if (v.length > NAME_MAX) e[`${tier}.${key}`] = `Tối đa ${NAME_MAX} ký tự`;
    }
    levels[tier] = {
      name_vi: f.name_vi.trim(),
      name_en: f.name_en.trim(),
      min_amount: check(e, `${tier}.min_amount`, f.min_amount, 0, AMOUNT_MAX, { integer: true }) ?? 0,
      cashback_percent: check(e, `${tier}.cashback_percent`, f.cashback_percent, 0, CASHBACK_MAX) ?? 0,
      api_requests_per_minute: check(e, `${tier}.api_requests_per_minute`, f.api_requests_per_minute, 1, API_MAX, { integer: true, optional: true }),
      api_orders_per_minute: check(e, `${tier}.api_orders_per_minute`, f.api_orders_per_minute, 1, API_MAX, { integer: true, optional: true }),
    };
  }
  if (!e["l1.min_amount"] && levels.l1.min_amount !== 0) e["l1.min_amount"] = "L1 luôn bắt đầu từ 0";
  if (!e["l2.min_amount"] && !e["l3.min_amount"]) {
    if (levels.l2.min_amount <= levels.l1.min_amount) e["l2.min_amount"] = "Phải lớn hơn mức L1";
    else if (levels.l3.min_amount <= levels.l2.min_amount) e["l3.min_amount"] = "Phải lớn hơn mức L2";
  }
  const ip = check(e, "ip_requests_per_minute", form.ip_requests_per_minute, IP_LIMIT.min, IP_LIMIT.max, { integer: true }) ?? IP_LIMIT.default;
  if (Object.keys(e).length) return { config: null, errors: e };
  return { config: { criterion: form.criterion, ip_requests_per_minute: ip, levels }, errors: e };
}

/** How many fields differ from the saved settings (for the save bar). */
export function buyerChangedCount(form: BuyerTierForm, saved: BuyerTierConfig): number {
  const a = toBuyerForm(saved);
  let n = a.criterion === form.criterion ? 0 : 1;
  if (num(a.ip_requests_per_minute) !== num(form.ip_requests_per_minute)) n++;
  for (const tier of BUYER_TIERS) {
    for (const key of Object.keys(a.levels[tier]) as (keyof LevelForm)[]) {
      const before = a.levels[tier][key];
      const after = form.levels[tier][key];
      const same = key.startsWith("name_") ? before.trim() === after.trim() : num(before) === num(after);
      if (!same) n++;
    }
  }
  return n;
}
