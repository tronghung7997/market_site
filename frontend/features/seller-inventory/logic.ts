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

const RESTOCK_CSV_HEADERS = new Set(["data", "item", "resource", "content", "key"]);

/** Sample rows used by seller restock / new-product file templates. */
export const RESTOCK_TEMPLATE_ROWS = [
  "uid1001|pass123|2fa_code|email@domain.com",
  "uid1002|pass456|2fa_code|email@domain.com",
  "LICENSE-KEY-EXAMPLE-9901",
] as const;

export function restockTemplateContent(format: "txt" | "csv"): { content: string; mimeType: string } {
  const rows = RESTOCK_TEMPLATE_ROWS.join("\n");
  if (format === "csv") {
    return { content: `data\n${rows}`, mimeType: "text/csv" };
  }
  return { content: rows, mimeType: "text/plain" };
}

/**
 * CSV restock files may include a single-column header and RFC-style quoted cells.
 * TXT files are used as-is (later split by parseResourceItems).
 */
export function parseRestockFileContent(fileName: string, raw: string): string {
  if (!fileName.toLowerCase().endsWith(".csv")) {
    return raw;
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return "";

  const firstLineLower = lines[0].toLowerCase();
  const isHeader =
    RESTOCK_CSV_HEADERS.has(firstLineLower) ||
    firstLineLower.startsWith('"data"') ||
    firstLineLower.startsWith('"item"');
  const dataRows = isHeader ? lines.slice(1) : lines;

  return dataRows
    .map((row) => {
      if (row.startsWith('"') && row.endsWith('"')) {
        return row.slice(1, -1).replace(/""/g, '"');
      }
      return row;
    })
    .join("\n");
}

export function mergeRestockText(previous: string, incoming: string): string {
  if (!incoming) return previous;
  return previous ? `${previous}\n${incoming}` : incoming;
}

export function downloadRestockTemplate(format: "txt" | "csv", basename: string): void {
  const { content, mimeType } = restockTemplateContent(format);
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${basename}.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function canEditInventoryResource(status: string, orderId?: number | null): boolean {
  return !orderId && (status === "available" || status === "error");
}

export function canRestockInventoryResource(status: string, orderId?: number | null): boolean {
  return status === "error" && !orderId;
}

export function canArchiveInventoryResource(status: string): boolean {
  return status === "error" || status === "available";
}

export function isDefectiveReturnResource(status: string, orderId: number | null | undefined): boolean {
  return status === "error" && typeof orderId === "number" && orderId > 0;
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
