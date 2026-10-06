/** The one fact a catalog card leads with, picked by how the offer is sold:
 *  units in stock for inventory, the duration range for configurable proxies,
 *  the package range for API credits, the promised hours for made-to-order
 *  packages. Pure, so the card and its tests share it. */

import { productStockState, variantStockState, type StockHint } from "../../../lib/stock.ts";

export type OfferFact =
  | { kind: "stock"; count: number; low: boolean }
  | { kind: "out" }
  | { kind: "duration"; minDays: number; maxDays: number; options: string[] }
  | { kind: "requests"; min: number; max: number }
  | { kind: "manual"; slaHours: number | null }
  | { kind: "none" };

type OfferVariant = StockHint & { sla_hours?: number | null };

export type OfferInput = {
  pricing_strategy?: string | null;
  pricing_params?: Record<string, unknown> | null;
  variants?: OfferVariant[] | null;
};

const PLAN_KEY = /^([^|]+)\|([^|]+)\|(\d+)$/;

/** `plan_prices` keys are `TYPE|OPTION|DAYS`; the options (carrier, location,
 *  package) are shown with the seller's display names when given. */
function durationFact(params: Record<string, unknown>): OfferFact | null {
  const prices = params.plan_prices;
  if (!prices || typeof prices !== "object") return null;
  const days: number[] = [];
  const options: string[] = [];
  const display = (params.network_display && typeof params.network_display === "object"
    ? params.network_display
    : {}) as Record<string, unknown>;
  for (const [key, price] of Object.entries(prices as Record<string, unknown>)) {
    const match = PLAN_KEY.exec(key);
    if (!match || typeof price !== "number" || price <= 0) continue;
    days.push(Number(match[3]));
    const raw = match[2];
    const label = typeof display[raw] === "string" && (display[raw] as string).trim() ? (display[raw] as string).trim() : raw;
    if (!options.includes(label)) options.push(label);
  }
  if (days.length === 0) return null;
  return { kind: "duration", minDays: Math.min(...days), maxDays: Math.max(...days), options };
}

function requestsFact(params: Record<string, unknown>): OfferFact | null {
  const packages = Array.isArray(params.packages) ? params.packages : [];
  const sizes = packages
    .filter((p): p is { size: number; active?: boolean } =>
      !!p && typeof p === "object" && typeof (p as { size?: unknown }).size === "number" && (p as { active?: unknown }).active !== false)
    .map((p) => p.size)
    .filter((n) => n > 0);
  if (sizes.length === 0) return null;
  return { kind: "requests", min: Math.min(...sizes), max: Math.max(...sizes) };
}

export function offerFact(product: OfferInput): OfferFact {
  const params = product.pricing_params ?? null;
  if (params && product.pricing_strategy === "config") {
    const fact = durationFact(params);
    if (fact) return fact;
  }
  if (params && product.pricing_strategy === "credit") {
    const fact = requestsFact(params);
    if (fact) return fact;
  }
  const variants = (product.variants ?? []).filter((v) => v.is_active !== false);
  const state = productStockState(variants);
  if (state === "in_stock" || state === "low") {
    const count = variants
      .filter((v) => {
        const s = variantStockState(v);
        return s === "in_stock" || s === "low";
      })
      .reduce((sum, v) => sum + (typeof v.stock_count === "number" ? Math.max(0, v.stock_count) : 0), 0);
    if (count > 0) return { kind: "stock", count, low: state === "low" };
  }
  if (state === "manual") {
    const hours = variants
      .filter((v) => variantStockState(v) === "manual" && typeof v.sla_hours === "number" && v.sla_hours > 0)
      .map((v) => v.sla_hours as number);
    return { kind: "manual", slaHours: hours.length ? Math.min(...hours) : null };
  }
  if (state === "out") return { kind: "out" };
  return { kind: "none" };
}
