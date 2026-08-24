export interface SellerInventoryProductLike {
  pricing_strategy?: string | null;
  total_stock: number;
}

export interface DeliveryVariantLike {
  delivery_mode: string | null;
}

export type InventoryStockState = "not_managed" | "out" | "low" | "in_stock";
export type SellerMutableProductStatus = "active" | "paused";

export function isInventoryManagedProduct(product: SellerInventoryProductLike): boolean {
  return !product.pricing_strategy || product.pricing_strategy === "fixed";
}

export function inventoryStockState(
  product: SellerInventoryProductLike,
  lowStockThreshold: number,
): InventoryStockState {
  if (!isInventoryManagedProduct(product)) return "not_managed";
  if (product.total_stock === 0) return "out";
  if (product.total_stock <= lowStockThreshold) return "low";
  return "in_stock";
}

export function isInstantDelivery(deliveryMode: string | null | undefined): boolean {
  return deliveryMode === "instant";
}

export function restockableVariants<T extends DeliveryVariantLike>(variants: readonly T[]): T[] {
  return variants.filter((variant) => isInstantDelivery(variant.delivery_mode));
}

export function parseResourceItems(raw: string, deduplicate: boolean): string[] {
  const items = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  return deduplicate ? [...new Set(items)] : items;
}

export function canEditInventoryResource(status: string): boolean {
  return status === "available";
}

export function nextSellerProductStatus(status: string): SellerMutableProductStatus | null {
  if (status === "active") return "paused";
  if (status === "paused" || status === "draft") return "active";
  return null;
}

/** Coordinates async master-detail loads without coupling the domain logic to React. */
export class LatestRequestGate {
  #sequence = 0;

  begin(): number {
    this.#sequence += 1;
    return this.#sequence;
  }

  isCurrent(request: number): boolean {
    return request === this.#sequence;
  }

  invalidate(): void {
    this.#sequence += 1;
  }
}
