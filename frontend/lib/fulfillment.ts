export type FulfillmentKind = "inventory" | "api" | "task" | "proxy" | "service";

export function fulfillmentFromStrategy(strategy?: string | null): FulfillmentKind {
  if (strategy === "credit") return "api";
  if (strategy === "task") return "task";
  if (strategy === "config") return "proxy";
  return "inventory";
}

export function fulfillmentFromOrder(order: {
  pricing_strategy?: string | null;
  variant_id?: number | null;
  product_id?: number | null;
  tasks?: unknown[] | null;
}): FulfillmentKind {
  if (order.pricing_strategy) return fulfillmentFromStrategy(order.pricing_strategy);
  if (order.tasks && order.tasks.length > 0) return "task";
  if (order.variant_id != null) return "inventory";
  if (order.product_id != null) return "service";
  return "inventory";
}

export function fulfillmentTone(kind: FulfillmentKind): "good" | "iris" | "warn" | "neutral" {
  if (kind === "inventory") return "good";
  if (kind === "api") return "iris";
  if (kind === "task") return "warn";
  return "neutral";
}
