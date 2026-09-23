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

/** Longest stock line the backend accepts; bulk add, edit and restock share it. */
export const RESOURCE_LINE_MAX_LENGTH = 20_000;
/** JSON bytes per restock request. The backend's restock routes accept up to
 * 20 MB; small batches keep progress smooth and each commit short. If a
 * deployment runs a lower cap, `runInRestockBatches` shrinks to fit. */
export const RESTOCK_BATCH_BYTES = 2_000_000;
/** Backend `RESTOCK_MAX_ITEMS`: list length per request. */
export const RESTOCK_BATCH_MAX_ITEMS = 5_000;

export interface RestockCounters {
  count: number;
  skipped_duplicate: number;
  skipped_existing: number;
  skipped_market: number;
}

export interface RestockProgress {
  /** Unique lines already sent and accepted by the server. */
  done: number;
  total: number;
  /** Rows actually inserted so far (done minus lines already in stock). */
  added: number;
}

interface RestockPreviewBatch {
  existing_in_stock: number;
  expected_field_count: number | null;
}

export interface RestockPreviewSummary extends RestockPreviewBatch {
  total_lines: number;
  duplicate_in_file: number;
  to_add: number;
  malformed: { line: number; fields: number }[];
  malformed_total: number;
}

const utf8 = new TextEncoder();

/** Split lines into request-sized batches by JSON-encoded byte size. A single
 * line larger than the budget still gets its own batch. */
export function chunkRestockItems(
  items: readonly string[],
  maxBytes = RESTOCK_BATCH_BYTES,
  maxItems = RESTOCK_BATCH_MAX_ITEMS,
): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = utf8.encode(JSON.stringify(item)).length + 1;
    if (batch.length > 0 && (bytes + size > maxBytes || batch.length >= maxItems)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(item);
    bytes += size;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

function codePointLength(value: string): number {
  let length = 0;
  for (const _ of value) length += 1;
  return length;
}

/** 1-based line numbers longer than the backend cap (counted in code points,
 * like Python's `len`). */
export function tooLongRestockLines(items: readonly string[], max = RESOURCE_LINE_MAX_LENGTH): number[] {
  const lines: number[] = [];
  items.forEach((item, index) => {
    if (item.length > max && codePointLength(item) > max) lines.push(index + 1);
  });
  return lines;
}

/** Byte cap from a coded `REQUEST_TOO_LARGE` error (0 when the cap is unknown),
 * or null for any other error. Duck-typed so this module stays transport-free. */
function requestTooLargeCap(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const { errorCode, params } = error as { errorCode?: unknown; params?: { max_bytes?: unknown } };
  if (errorCode !== "REQUEST_TOO_LARGE") return null;
  return typeof params?.max_bytes === "number" ? params.max_bytes : 0;
}

/**
 * Send `items` in request-sized batches, one at a time. When the server
 * rejects a batch as too large, the rest of the upload is re-chunked under the
 * cap it reports (at least halving each time) and sending resumes; a single
 * line that still does not fit is rethrown.
 */
export async function runInRestockBatches<T>(
  items: readonly string[],
  send: (batch: string[]) => Promise<T>,
  onBatch?: (batch: string[], result: T) => void,
): Promise<T[]> {
  let budget = RESTOCK_BATCH_BYTES;
  let queue = chunkRestockItems(items, budget);
  const results: T[] = [];
  while (queue.length > 0) {
    const [batch, ...rest] = queue;
    let result: T;
    try {
      result = await send(batch);
    } catch (error) {
      const cap = requestTooLargeCap(error);
      if (cap === null || batch.length === 1) throw error;
      budget = Math.min(Math.floor(budget / 2), cap > 0 ? Math.floor(cap * 0.9) : Infinity);
      queue = chunkRestockItems([...batch, ...rest.flat()], budget);
      continue;
    }
    results.push(result);
    onBatch?.(batch, result);
    queue = rest;
  }
  return results;
}

/**
 * Send unique lines batch by batch. Lines are de-duplicated across the whole
 * upload first, so a repeat that lands in a later batch still counts as
 * `skipped_duplicate`. Each batch commits on its own: on failure the error is
 * rethrown as-is and `onProgress` has already reported what was saved.
 * Retrying the same upload is safe because the server skips existing lines.
 */
export async function runRestockBatches(
  items: readonly string[],
  send: (batch: string[]) => Promise<RestockCounters>,
  onProgress?: (progress: RestockProgress) => void,
): Promise<RestockCounters> {
  const unique = [...new Set(items)];
  const totals: RestockCounters = { count: 0, skipped_duplicate: items.length - unique.length, skipped_existing: 0, skipped_market: 0 };
  let done = 0;
  onProgress?.({ done, total: unique.length, added: 0 });
  await runInRestockBatches(unique, send, (batch, result) => {
    totals.count += result.count;
    totals.skipped_duplicate += result.skipped_duplicate;
    totals.skipped_existing += result.skipped_existing;
    totals.skipped_market += result.skipped_market;
    done += batch.length;
    onProgress?.({ done, total: unique.length, added: totals.count });
  });
  return totals;
}

/** Combine per-batch server previews (stock lookups) with the checks that need
 * the whole upload: duplicates across batches and field counts by line. */
export function summarizeRestockPreview(
  items: readonly string[],
  batches: readonly RestockPreviewBatch[],
): RestockPreviewSummary {
  const unique = new Set(items).size;
  const existing = batches.reduce((sum, batch) => sum + batch.existing_in_stock, 0);
  const expected = batches[0]?.expected_field_count ?? null;
  const malformed: { line: number; fields: number }[] = [];
  let malformedTotal = 0;
  if (expected !== null && expected > 1) {
    items.forEach((item, index) => {
      const fields = item.split("|").length;
      if (fields === expected) return;
      malformedTotal += 1;
      if (malformed.length < 50) malformed.push({ line: index + 1, fields });
    });
  }
  return {
    total_lines: items.length,
    duplicate_in_file: items.length - unique,
    existing_in_stock: existing,
    to_add: unique - existing,
    expected_field_count: expected,
    malformed,
    malformed_total: malformedTotal,
  };
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
