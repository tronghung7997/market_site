/** Pure purchase decision helpers — no React, no i18n strings (keys only). */

import type { Variant } from "@/lib/types";
import { variantMaxQuantity, variantOutOfStock } from "../../../../lib/stock.ts";

/** Priced, and not a dried-up instant package. Uses the storefront
 *  `stock_state`; falls back to `stock_count` on management payloads. */
export const purchasable = (v: Variant): boolean =>
  v.price > 0 && !variantOutOfStock(v);

export const outOfStock = (v: Variant): boolean => variantOutOfStock(v);

export function pickDefaultVariant(variants: Variant[]): Variant | null {
  return variants.find(purchasable) ?? variants.find((v) => v.price > 0) ?? variants[0] ?? null;
}

/** The buyer's pick as the product has it now (fresh price and stock after a
 *  reload), or the default package when nothing was picked or it is gone. */
export function resolveSelected(variants: Variant[], chosenId: number | null): Variant | null {
  return (chosenId != null ? variants.find((v) => v.id === chosenId) : undefined) ?? pickDefaultVariant(variants);
}

/** Other packages of the same product the buyer can switch to. */
export function alternativePackages(variants: Variant[], excludeId: number | null, limit = 3): Variant[] {
  return variants.filter((v) => v.id !== excludeId && v.is_active !== false && purchasable(v)).slice(0, limit);
}

/** Order errors the confirm dialog recovers from by reloading the product. */
export type PurchaseNotice = { kind: "price"; oldPrice: number } | { kind: "soldOut" };

export function noticeFor(errorCode: string | undefined, oldPrice: number): PurchaseNotice | null {
  if (errorCode === "ORDER_PRICE_CHANGED") return { kind: "price", oldPrice };
  if (errorCode === "RESOURCE_UNAVAILABLE") return { kind: "soldOut" };
  return null;
}

/** Order-form ceiling: the API's `max_quantity` (already capped server-side). */
export function maxQtyFor(v: Variant | null): number {
  return variantMaxQuantity(v);
}

/** The seller's minimum units per order for this package. */
export function minQtyFor(v: Variant | null): number {
  return Math.max(1, v?.min_per_order ?? 1);
}

export function clampQty(n: number, v: Variant | null): number {
  const min = minQtyFor(v);
  return Math.min(Math.max(min, n), Math.max(min, maxQtyFor(v)));
}

/** Instant package with fewer units in stock than one order must take. */
export function belowMinimum(v: Variant | null): boolean {
  return !!v && v.delivery_mode === "instant" && maxQtyFor(v) < minQtyFor(v);
}

/** Per-order bounds worth telling the buyer, or null when there are none. */
export function perOrderBounds(v: Variant | null): { min: number; max: number | null } | null {
  if (!v) return null;
  const min = minQtyFor(v);
  const max = v.max_per_order ?? null;
  return min > 1 || max != null ? { min, max } : null;
}

export type PanelMode = "buy" | "contact";
export function panelMode(selected: Variant | null): PanelMode {
  return selected && selected.price === 0 ? "contact" : "buy";
}

export interface CtaState {
  /** Message key under `products` namespace. */
  labelKey: "processing" | "placeOrder" | "loginToBuy" | "outOfStock" | "notEnoughStock" | "buyNow";
  disabled: boolean;
  intent: "login" | "confirm" | "none";
}

export function ctaState({ loggedIn, placing, selected }: {
  loggedIn: boolean;
  placing: boolean;
  selected: Variant | null;
}): CtaState {
  if (placing) return { labelKey: "processing", disabled: true, intent: "none" };
  if (!selected) return { labelKey: "placeOrder", disabled: true, intent: "none" };
  if (!loggedIn) return { labelKey: "loginToBuy", disabled: false, intent: "login" };
  if (outOfStock(selected)) return { labelKey: "outOfStock", disabled: true, intent: "none" };
  if (belowMinimum(selected)) return { labelKey: "notEnoughStock", disabled: true, intent: "none" };
  return {
    labelKey: selected.delivery_mode === "instant" ? "buyNow" : "placeOrder",
    disabled: false,
    intent: "confirm",
  };
}

export type DeliverySummary =
  | { kind: "instant" }
  | { kind: "hours"; hours: number }
  | { kind: "mixed"; hours: number }
  | { kind: "auto" };

/** One line for the "Delivery" fact: fixed-price products read their active
 *  packages (slowest SLA wins, so the promise is never shorter than a
 *  package's); provider-backed products deliver automatically. */
export function deliverySummary(variants: Variant[], pricingStrategy: string | null | undefined): DeliverySummary {
  if (pricingStrategy && pricingStrategy !== "fixed") return { kind: "auto" };
  const active = variants.filter((v) => v.is_active !== false);
  const manual = active.filter((v) => v.delivery_mode !== "instant");
  if (manual.length === 0) return { kind: "instant" };
  const hours = Math.max(...manual.map((v) => v.sla_hours ?? 24));
  return manual.length === active.length ? { kind: "hours", hours } : { kind: "mixed", hours };
}
