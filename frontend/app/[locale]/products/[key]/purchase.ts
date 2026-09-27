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

/** How much the wallet is missing for `total`, or 0 when it covers it.
 *  `available` null = balance unknown (signed out / still loading). */
export function walletShortfall(total: number, available: number | null | undefined): number {
  if (available == null || !Number.isFinite(available)) return 0;
  return Math.max(0, Math.ceil(total - available));
}

/** Wallet page link that prefills the top-up amount and brings the buyer back. */
export function topUpHref(amount: number, returnPath: string): string {
  const q = new URLSearchParams({ amount: String(Math.max(0, Math.ceil(amount))) });
  if (returnPath.startsWith("/") && !returnPath.startsWith("//")) q.set("return", returnPath);
  return `/wallet?${q}`;
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
