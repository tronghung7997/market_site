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

/** UTF-8 byte length of `JSON.stringify(value)`, computed without building
 * either string: batching a 20 MB upload must not allocate it twice. */
export function jsonByteLength(value: string): number {
  let bytes = 2;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x22 || code === 0x5c) bytes += 2;
    else if (code < 0x20) bytes += code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6;
    else if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; i += 1; } else bytes += 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 6;
    else bytes += 3;
  }
  return bytes;
}

/** Number of `|`-separated fields, without splitting the line. */
export function restockFieldCount(item: string): number {
  let fields = 1;
  for (let at = item.indexOf("|"); at !== -1; at = item.indexOf("|", at + 1)) fields += 1;
  return fields;
}

/** End (exclusive) of the batch starting at `start`: as many lines as fit the
 * JSON byte budget, at least one. Sizing only the next batch keeps the cost of
 * a large upload spread between requests instead of one long freeze. */
function restockBatchEnd(items: readonly string[], start: number, maxBytes: number, maxItems: number): number {
  let bytes = 0;
  let end = start;
  while (end < items.length && end - start < maxItems) {
    const size = jsonByteLength(items[end]) + 1;
    if (end > start && bytes + size > maxBytes) break;
    bytes += size;
    end += 1;
  }
  return end;
}

/** Split lines into request-sized batches by JSON-encoded byte size. A single
 * line larger than the budget still gets its own batch. */
export function chunkRestockItems(
  items: readonly string[],
  maxBytes = RESTOCK_BATCH_BYTES,
  maxItems = RESTOCK_BATCH_MAX_ITEMS,
): string[][] {
  const batches: string[][] = [];
  for (let start = 0; start < items.length;) {
    const end = restockBatchEnd(items, start, maxBytes, maxItems);
    batches.push(items.slice(start, end));
    start = end;
  }
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

const HEADER_KEYWORD = /user|name|login|acc|pass|mail|cookie|token|2fa|uid|id|phone|sdt|sđt|recovery|backup|khôi phục|mật khẩu|tài khoản|proxy|key|code|note|ghi chú|profile|link|secret|birth|ngày sinh/iu;

/**
 * Whether the first line of an upload is a column header such as
 * `Username|Password|Mail|Cookies` rather than stock. Conservative: every field
 * is a short label made of letters (digits only as part of "2FA"), at least
 * half of them name a credential column, and the line has as many fields as
 * the line after it. `user1|pass1|2fa` and anything with `@` or `://` stay stock.
 */
export function isRestockHeaderLine(line: string, nextLine?: string): boolean {
  const fields = line.split("|").map((field) => field.trim());
  if (fields.length < 2) return false;
  if (nextLine !== undefined && restockFieldCount(nextLine) !== fields.length) return false;
  let named = 0;
  for (const field of fields) {
    if (!field || field.length > 32) return false;
    if (!/^[\p{L}\p{M} _./()-]+$/u.test(field.replace(/2fa/giu, "twofa"))) return false;
    if (HEADER_KEYWORD.test(field)) named += 1;
  }
  return named * 2 >= fields.length;
}

/** Stock lines of one uploaded file or paste, with a detected header split off
 * (the console lets the seller keep it if the guess is wrong). */
export interface RestockSourceLines {
  header: string | null;
  items: string[];
}

export function splitRestockSource(raw: string): RestockSourceLines {
  const lines = parseResourceItems(raw, false);
  if (lines.length > 0 && isRestockHeaderLine(lines[0], lines[1])) {
    return { header: lines[0], items: lines.slice(1) };
  }
  return { header: null, items: lines };
}

/** Byte cap from a coded `REQUEST_TOO_LARGE` error (0 when the cap is unknown),
 * or null for any other error. Duck-typed so this module stays transport-free. */
function requestTooLargeCap(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const { errorCode, params } = error as { errorCode?: unknown; params?: { max_bytes?: unknown } };
  if (errorCode !== "REQUEST_TOO_LARGE") return null;
  return typeof params?.max_bytes === "number" ? params.max_bytes : 0;
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

export interface RestockBatchOptions<T> {
  onBatch?: (batch: string[], result: T) => void;
  /** Checked before each batch: aborting stops after the batch in flight. */
  signal?: AbortSignal;
}

/**
 * Send `items` in request-sized batches, one at a time. When the server
 * rejects a batch as too large, the rest of the upload is re-chunked under the
 * cap it reports (at least halving each time) and sending resumes; a single
 * line that still does not fit is rethrown. An aborted `signal` rejects with
 * its AbortError before the next batch starts.
 */
export async function runInRestockBatches<T>(
  items: readonly string[],
  send: (batch: string[]) => Promise<T>,
  { onBatch, signal }: RestockBatchOptions<T> = {},
): Promise<T[]> {
  let budget = RESTOCK_BATCH_BYTES;
  const results: T[] = [];
  for (let start = 0; start < items.length;) {
    signal?.throwIfAborted();
    const end = restockBatchEnd(items, start, budget, RESTOCK_BATCH_MAX_ITEMS);
    const batch = items.slice(start, end);
    let result: T;
    try {
      result = await send(batch);
    } catch (error) {
      const cap = requestTooLargeCap(error);
      if (cap === null || batch.length === 1) throw error;
      budget = Math.min(Math.floor(budget / 2), cap > 0 ? Math.floor(cap * 0.9) : Infinity);
      continue;
    }
    results.push(result);
    onBatch?.(batch, result);
    start = end;
  }
  return results;
}

/**
 * Send unique lines batch by batch. Lines are de-duplicated across the whole
 * upload first, so a repeat that lands in a later batch still counts as
 * `skipped_duplicate`. Each batch commits on its own: on failure or abort the
 * error is rethrown as-is and `onProgress` has already reported what was saved.
 * Retrying the same upload is safe because the server skips existing lines.
 */
export async function runRestockBatches(
  items: readonly string[],
  send: (batch: string[]) => Promise<RestockCounters>,
  { onProgress, signal }: { onProgress?: (progress: RestockProgress) => void; signal?: AbortSignal } = {},
): Promise<RestockCounters> {
  const unique = [...new Set(items)];
  const totals: RestockCounters = { count: 0, skipped_duplicate: items.length - unique.length, skipped_existing: 0, skipped_market: 0 };
  let done = 0;
  onProgress?.({ done, total: unique.length, added: 0 });
  await runInRestockBatches(unique, send, {
    signal,
    onBatch: (batch, result) => {
      totals.count += result.count;
      totals.skipped_duplicate += result.skipped_duplicate;
      totals.skipped_existing += result.skipped_existing;
      totals.skipped_market += result.skipped_market;
      done += batch.length;
      onProgress?.({ done, total: unique.length, added: totals.count });
    },
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
      const fields = restockFieldCount(item);
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

/** File name from a Content-Disposition header (RFC 5987 `filename*` first). */
export function contentDispositionFileName(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (encoded) {
    try { return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, "")); } catch { /* fall through */ }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/.exec(header);
  return plain ? (plain[2] ?? plain[1]).trim() || null : null;
}

/** "1.3 MB" / "1,3 MB" for file chips. */
export function formatByteSize(bytes: number, locale: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString(locale === "vi" ? "vi-VN" : "en-US", { maximumFractionDigits: digits })} ${units[unit]}`;
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
