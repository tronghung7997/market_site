/**
 * Quantity rules of the configurable order form (`DynamicOrderForm`). Pure:
 * no React, no network, loadable by the node test runner.
 *
 * `max_quantity` comes from `GET /products/{id}/pricing-options` (the
 * adapter's per-order limit for this strategy; null = no adapter limit). An
 * auto-delivered proxy sold by package ("config") may buy several proxies in
 * one order — each is delivered as its own line. A pool proxy ("credit") and
 * a backend that does not announce a limit stay at exactly one proxy.
 */
// Relative so the model stays loadable by the node test runner (no path alias there).
import { MAX_ORDER_QUANTITY } from "../lib/order-limits.ts";
import type { PricingOptions } from "../lib/types.ts";

export type QuantityOptions = Pick<PricingOptions, "strategy" | "adapter_type" | "max_quantity">;

/** How the form asks for a quantity:
 *  - `stepper`: the buyer picks 1…`max`;
 *  - `single`: exactly one unit, stated in the copy (one proxy);
 *  - `none`: the quantity lives in another field (task URLs, request package). */
export type QuantityControl =
  | { kind: "stepper"; max: number; proxy: boolean }
  | { kind: "single" }
  | { kind: "none" };

export function isAutoProxy(options: Pick<PricingOptions, "adapter_type">): boolean {
  return options.adapter_type === "auto_proxy";
}

/** Pool proxy: handed out from ready stock, always one per order. */
export function isPoolProxy(options: Pick<PricingOptions, "adapter_type" | "strategy">): boolean {
  return isAutoProxy(options) && options.strategy === "credit";
}

/** The adapter limit folded into the marketplace-wide cap. */
export function perOrderMax(maxQuantity: number | null | undefined): number {
  if (maxQuantity == null || !Number.isFinite(maxQuantity)) return MAX_ORDER_QUANTITY;
  return Math.max(1, Math.min(Math.floor(maxQuantity), MAX_ORDER_QUANTITY));
}

export function quantityControl(options: QuantityOptions): QuantityControl {
  if (isAutoProxy(options)) {
    if (isPoolProxy(options) || options.max_quantity == null) return { kind: "single" };
    const max = perOrderMax(options.max_quantity);
    return max > 1 ? { kind: "stepper", max, proxy: true } : { kind: "single" };
  }
  if (options.strategy === "task" || options.strategy === "credit") return { kind: "none" };
  return { kind: "stepper", max: perOrderMax(options.max_quantity), proxy: false };
}

/** Any typed/stepped value → a whole number within 1…max. */
export function clampQuantity(value: number, max: number): number {
  const whole = Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, Math.min(whole, Math.max(1, max)));
}

/** The quantity the order body and the price calculation carry. */
export function orderQuantity(control: QuantityControl, picked: number): number {
  return control.kind === "stepper" ? clampQuantity(picked, control.max) : 1;
}

/** `user_config` sent to calculate and to `POST /orders`: the chosen fields
 *  plus the quantity (a pool proxy also pins `package_size` to one). */
export function orderConfig(
  config: Record<string, unknown>,
  options: QuantityOptions,
  quantity: number,
): Record<string, unknown> {
  return { ...config, quantity, ...(isPoolProxy(options) ? { package_size: 1 } : {}) };
}
