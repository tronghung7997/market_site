export type FulfillmentKind = "instant" | "sla" | "api" | "task" | "proxy";

export type FulfillmentInfo = {
  kind: FulfillmentKind;
  hours?: number;
};

type VariantHint = {
  delivery_mode?: string | null;
  sla_hours?: number | null;
  stock_count?: number;
  is_active?: boolean;
};

export function fulfillmentFromStrategy(
  strategy?: string | null,
  deliveryMode?: string | null,
  slaHours?: number | null,
): FulfillmentInfo {
  if (strategy === "credit") return { kind: "api" };
  if (strategy === "task") return { kind: "task" };
  if (strategy === "config") return { kind: "proxy" };
  if (deliveryMode === "manual") return { kind: "sla", hours: slaHours || 24 };
  return { kind: "instant" };
}

export function fulfillmentFromProduct(product: {
  pricing_strategy?: string | null;
  variants?: VariantHint[];
}): FulfillmentInfo {
  const strategy = product.pricing_strategy;
  if (strategy && strategy !== "fixed") return fulfillmentFromStrategy(strategy);

  const variants = (product.variants ?? []).filter((variant) => variant.is_active !== false);
  const instant = variants.filter((variant) => variant.delivery_mode !== "manual");
  const manual = variants.filter((variant) => variant.delivery_mode === "manual");
  const instantStock = instant.reduce((sum, variant) => sum + (variant.stock_count ?? 0), 0);
  if (instant.length > 0 && (instantStock > 0 || manual.length === 0)) return { kind: "instant" };
  if (manual.length > 0) return { kind: "sla", hours: manual[0]?.sla_hours || 24 };
  return { kind: "instant" };
}

export function fulfillmentFromOrder(order: {
  pricing_strategy?: string | null;
  delivery_mode?: string | null;
  sla_hours?: number | null;
  variant_id?: number | null;
  product_id?: number | null;
  tasks?: unknown[] | null;
}): FulfillmentInfo {
  if (order.pricing_strategy) {
    return fulfillmentFromStrategy(order.pricing_strategy, order.delivery_mode, order.sla_hours);
  }
  if (order.tasks && order.tasks.length > 0) return { kind: "task" };
  if (order.variant_id != null) return fulfillmentFromStrategy("fixed", order.delivery_mode, order.sla_hours);
  if (order.product_id != null) return { kind: "api" };
  return { kind: "instant" };
}

export function fulfillmentTone(kind: FulfillmentKind): "good" | "iris" | "warn" | "neutral" {
  if (kind === "instant") return "good";
  if (kind === "api") return "iris";
  if (kind === "sla" || kind === "task") return "warn";
  return "neutral";
}

export function fulfillmentTagKey(info: FulfillmentInfo, pending = false): string {
  if (pending && info.kind === "task") return "fulfillment.taskPending";
  return `fulfillment.${info.kind}`;
}

export function fulfillmentTagValues(info: FulfillmentInfo): { hours: number } | undefined {
  return info.kind === "sla" ? { hours: info.hours || 24 } : undefined;
}
