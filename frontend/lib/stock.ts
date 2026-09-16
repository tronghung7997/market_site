/**
 * Buyer-facing stock helpers. Public product payloads no longer carry exact
 * counts — only `stock_state` (in_stock / low / out / manual) and
 * `max_quantity`. Seller/admin payloads still have `stock_count`, so every
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

/** Instant package that has run dry. Manual packages are never "out". */
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

/** Sort weight for "most available first" lists — no exact counts needed. */
export function stockRank(variants: StockHint[] | null | undefined): number {
  switch (productStockState(variants)) {
    case "in_stock": return 3;
    case "low": return 2;
    case "manual": return 1;
    default: return 0;
  }
}
