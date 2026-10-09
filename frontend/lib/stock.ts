/**
 * Buyer-facing stock helpers. The backend decides availability
 * (`marketplace-svc/src/products/availability.py`): public product payloads
 * carry `stock_state` per package (in_stock / low / out / manual / paused),
 * `max_quantity`, the exact `stock_count` for instant packages and for
 * made-to-order packages the seller limited (both shown as "còn N"), and
 * `availability` for the whole product. These helpers render what they are
 * given; the derivations below only run for seller/admin payloads, which
 * carry exact counts instead of states.
 *
 * - `manual` = made to order: the seller delivers within `sla_hours`. Never
 *   "out of stock" unless the seller's limit is used up (then `out`);
 *   purchasable up to `max_quantity`.
 * - `paused` = a catalog-supplier package whose source is switched off.
 *   Temporary ("Tạm ngưng"), not purchasable, not "out of stock".
 * - `out` = an instant package with nothing to sell, or a limited
 *   made-to-order package with nothing left.
 */

import { MAX_ORDER_QUANTITY } from "./order-limits.ts";

export type StockState = "in_stock" | "low" | "out" | "manual" | "paused";

/** Whole product: the variant states rolled up, plus `auto` for products a
 *  provider fulfils (no stock) and `unknown` when nothing is known. */
export type ProductAvailability = StockState | "auto" | "unknown";

export type StockHint = {
  delivery_mode?: string | null;
  stock_state?: string | null;
  max_quantity?: number | null;
  stock_count?: number | null;
  is_active?: boolean;
};

export type AvailabilityHint = {
  availability?: string | null;
  pricing_strategy?: string | null;
  variants?: StockHint[] | null;
};

const STOCK_STATES: readonly string[] = ["in_stock", "low", "out", "manual", "paused"];
const PRODUCT_STATES: readonly string[] = [...STOCK_STATES, "auto"];

function isStockState(value: unknown): value is StockState {
  return typeof value === "string" && STOCK_STATES.includes(value);
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
  const state = variantStockState(v);
  return state === "in_stock" || state === "low" || state === "manual";
}

/** Instant package that has run dry, or a limited made-to-order package with
 *  nothing left. Unlimited made-to-order packages are never "out". */
export function variantOutOfStock(v: StockHint): boolean {
  return variantStockState(v) === "out";
}

/** Package a buyer cannot order right now: dry, or its source is paused. */
export function variantUnavailable(v: StockHint): boolean {
  return !variantPurchasable(v);
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
 * Whole-product state from its active variants (same order as the backend):
 * - any instant variant in stock → in_stock (low only when *all* stocked ones are low)
 * - otherwise a manual variant → manual (made to order, still purchasable)
 * - otherwise a paused variant → paused
 * - otherwise out; a product with no variants at all is "unknown".
 */
export function productStockState(variants: StockHint[] | null | undefined): StockState | "unknown" {
  const active = (variants ?? []).filter((v) => v.is_active !== false);
  if (active.length === 0) return "unknown";
  const states = active.map(variantStockState);
  for (const state of ["in_stock", "low", "manual", "paused"] as const) {
    if (states.includes(state)) return state;
  }
  return "out";
}

/** The product's availability: the backend's `availability` when the
 *  payload has it, else rolled up from the variants (provider-fulfilled
 *  products read as `auto`). */
export function productAvailability(product: AvailabilityHint): ProductAvailability {
  const given = product.availability;
  if (typeof given === "string" && PRODUCT_STATES.includes(given)) return given as ProductAvailability;
  if (product.pricing_strategy && product.pricing_strategy !== "fixed") return "auto";
  return productStockState(product.variants);
}

/** A buyer can order something on this product now. */
export function productPurchasable(availability: ProductAvailability): boolean {
  return availability === "in_stock" || availability === "low" || availability === "manual" || availability === "auto";
}

/** Units ready to deliver right now: the exact counts of the active instant
 *  packages that still have stock. 0 when no count is published (manual
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
