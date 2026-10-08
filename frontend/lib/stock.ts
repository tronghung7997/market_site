/**
 * Buyer-facing stock helpers. Public product payloads carry `stock_state`
 * (in_stock / low / out / manual) and `max_quantity`, plus the exact
 * `stock_count` for instant packages and for made-to-order packages the
 * seller limited (both shown as "còn N"; a limited made-to-order package is
 * `out` at 0). Seller/admin payloads always have `stock_count`, so every
 * helper falls back to it when the state is missing.
 */

import { MAX_ORDER_QUANTITY } from "./order-limits.ts";

export type StockState = "in_stock" | "low" | "out" | "manual";

export type StockHint = {
  delivery_mode?: string | null;
  stock_state?: string | null;
  max_quantity?: number | null;
  stock_count?: number | null;
  is_active?: boolean;
};

function isStockState(value: unknown): value is StockState {
  return value === "in_stock" || value === "low" || value === "out" || value === "manual";
}

/** Normalised state for one variant. */
export function variantStockState(v: StockHint): StockState {
  if (isStockState(v.stock_state)) return v.stock_state;
  if (v.delivery_mode === "manual") return "manual";
  const count = v.stock_count ?? 0;
  if (count <= 0) return "out";
  return count <= 10 ? "low" : "in_stock";
}

/** Instant packages with units to sell, or manual packages (made to order). */
export function variantPurchasable(v: StockHint): boolean {
  return variantStockState(v) !== "out";
}

/** Instant package that has run dry, or a limited made-to-order package with
 *  nothing left. Unlimited made-to-order packages are never "out". */
export function variantOutOfStock(v: StockHint): boolean {
  return variantStockState(v) === "out";
}

/** Largest quantity the order form should allow for this variant. */
export function variantMaxQuantity(v: StockHint | null): number {
  if (!v) return MAX_ORDER_QUANTITY;
  if (typeof v.max_quantity === "number") return Math.max(1, Math.min(MAX_ORDER_QUANTITY, v.max_quantity));
  if (v.delivery_mode === "instant" && typeof v.stock_count === "number") {
    return Math.min(MAX_ORDER_QUANTITY, Math.max(1, v.stock_count));
  }
  return MAX_ORDER_QUANTITY;
}

/**
 * Whole-product state from its active variants:
 * - any instant variant in stock → in_stock (low only when *all* stocked ones are low)
 * - otherwise a manual variant → manual
 * - otherwise out; a product with no variants at all is "unknown".
 */
export function productStockState(variants: StockHint[] | null | undefined): StockState | "unknown" {
  const active = (variants ?? []).filter((v) => v.is_active !== false);
  if (active.length === 0) return "unknown";
  const states = active.map(variantStockState);
  if (states.includes("in_stock")) return "in_stock";
  if (states.includes("low")) return "low";
  if (states.includes("manual")) return "manual";
  return "out";
}

/** Units a made-to-order package still takes on; null when it is not made
 *  to order or the seller set no limit. Works on storefront payloads (count
 *  only when limited) and management ones (count 0 when unlimited): a limited
 *  package is "out" at 0, so a "manual" package with no positive count has no
 *  limit. */
export function manualStockLeft(v: StockHint): number | null {
  if (v.delivery_mode !== "manual") return null;
  const state = variantStockState(v);
  if (state === "out") return 0;
  return state === "manual" && typeof v.stock_count === "number" && v.stock_count > 0 ? v.stock_count : null;
}

/** Units the buyer can order right now: the exact counts of the active
 *  instant packages that still have stock plus what limited made-to-order
 *  packages still take. 0 when no count is published (unlimited made-to-order
 *  packages, or a payload without `stock_count`). */
export function productStockCount(variants: StockHint[] | null | undefined): number {
  return (variants ?? [])
    .filter((v) => v.is_active !== false)
    .reduce((sum, v) => {
      const state = variantStockState(v);
      if (state === "in_stock" || state === "low") {
        return sum + (typeof v.stock_count === "number" ? Math.max(0, v.stock_count) : 0);
      }
      return sum + (manualStockLeft(v) ?? 0);
    }, 0);
}

/** What the active limited made-to-order packages still take on, summed;
 *  null when none of them is limited (the product then shows no count). */
export function productManualLeft(variants: StockHint[] | null | undefined): number | null {
  const limits = (variants ?? [])
    .filter((v) => v.is_active !== false && variantStockState(v) === "manual")
    .map(manualStockLeft);
  if (limits.length === 0 || limits.some((left) => left === null)) return null;
  return limits.reduce<number>((sum, left) => sum + (left ?? 0), 0);
}

/** Sort weight for "most available first" lists — no exact counts needed. */
export function stockRank(variants: StockHint[] | null | undefined): number {
  switch (productStockState(variants)) {
    case "in_stock": return 3;
    case "low": return 2;
    case "manual": return 1;
    default: return 0;
  }
}


/** Backend MANUAL_STOCK_MAX: the most units a made-to-order package can take on. */
export const MANUAL_STOCK_CEILING = 1_000_000;

/** Typed "units still taken on" for a made-to-order package: blank = no
 *  limit, anything else is clamped to 0…MANUAL_STOCK_CEILING. */
export function parseManualStock(raw: string): number | null {
  if (raw.trim() === "") return null;
  return Math.min(MANUAL_STOCK_CEILING, Math.max(0, Math.floor(Number(raw)) || 0));
}
