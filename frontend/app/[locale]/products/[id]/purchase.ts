/** Pure purchase decision helpers — no React, no i18n strings (keys only). */

import type { Variant } from "@/lib/types";

export const purchasable = (v: Variant): boolean =>
  v.price > 0 && (v.delivery_mode !== "instant" || v.stock_count > 0);

export const outOfStock = (v: Variant): boolean =>
  v.delivery_mode === "instant" && v.stock_count <= 0;

export function pickDefaultVariant(variants: Variant[]): Variant | null {
  return variants.find(purchasable) ?? variants.find((v) => v.price > 0) ?? variants[0] ?? null;
}

export function maxQtyFor(v: Variant | null): number {
  if (!v) return 999;
  return v.delivery_mode === "instant" ? Math.max(1, v.stock_count) : 999;
}

export function clampQty(n: number, v: Variant | null): number {
  return Math.min(Math.max(1, n), maxQtyFor(v));
}

export type PanelMode = "buy" | "contact";
export function panelMode(selected: Variant | null): PanelMode {
  return selected && selected.price === 0 ? "contact" : "buy";
}

export interface CtaState {
  /** Message key under `products` namespace. */
  labelKey: "processing" | "placeOrder" | "loginToBuy" | "outOfStock" | "buyNow";
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
  return {
    labelKey: selected.delivery_mode === "instant" ? "buyNow" : "placeOrder",
    disabled: false,
    intent: "confirm",
  };
}
