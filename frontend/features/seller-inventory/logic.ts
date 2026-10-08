export interface SellerInventoryProductLike {
  pricing_strategy?: string | null;
  total_stock: number;
  /** Sells only made-to-order, at least one package without a limit: never low or out. */
  stock_unlimited?: boolean;
}

export interface DeliveryVariantLike {
  delivery_mode: string | null;
}

export type InventoryStockState = "not_managed" | "unlimited" | "out" | "low" | "in_stock";
export type SellerMutableProductStatus = "active" | "paused";

export function isInventoryManagedProduct(product: SellerInventoryProductLike): boolean {
  return !product.pricing_strategy || product.pricing_strategy === "fixed";
}

export function inventoryStockState(
  product: SellerInventoryProductLike,
  lowStockThreshold: number,
): InventoryStockState {
  if (!isInventoryManagedProduct(product)) return "not_managed";
  if (product.stock_unlimited) return "unlimited";
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

/** Sample of a stock file (restock / new-product templates): the format line,
 * the `#` login notes, then one account per line (see `splitStockFormat`). */
export const RESTOCK_TEMPLATE_ROWS = [
  "UID|PASS|2FA|MAIL",
  "# Đăng nhập m.facebook.com bằng UID + PASS, mã 2FA lấy tại 2fa.live",
  "uid1001|pass123|2fa_code|email@domain.com",
  "uid1002|pass456|2fa_code|email@domain.com",
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

/** Longest stock line the backend accepts (`RESOURCE_DATA_MAX_LENGTH`); bulk
 * add, edit and restock share it. Cookie-carrying accounts run 50-100 KB. */
export const RESOURCE_LINE_MAX_LENGTH = 200_000;
/** JSON bytes per restock request. The backend's restock routes accept up to
 * 20 MB, but a stock nginx in front refuses bodies over 1 MiB, so batches stay
 * under that; small batches also keep progress smooth and each commit short.
 * If a deployment runs a lower cap, `runInRestockBatches` shrinks to fit. */
export const RESTOCK_BATCH_BYTES = 900_000;
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

/** `|`-fields of a line without the empty ones a trailing `|` leaves. */
function fieldsWithoutTrailingEmpty(line: string): number {
  return line.replace(/(\|\s*)+$/, "").split("|").length;
}

/**
 * Whether the first line of an upload is a column header such as
 * `Username|Password|Mail|Cookies` rather than stock. Conservative: every field
 * is a short label made of letters (digits only as part of "2FA"), at least
 * half of them name a credential column, and the line has as many fields as
 * the line after it — a trailing `|` on either line aside (`USER|PASS|MAIL`
 * over `u|p|m|`). `user1|pass1|2fa` and anything with `@` or `://` stay stock.
 */
export function isRestockHeaderLine(line: string, nextLine?: string): boolean {
  const fields = line.replace(/(\|\s*)+$/, "").split("|").map((field) => field.trim());
  if (fields.length < 2) return false;
  if (nextLine !== undefined) {
    const counts = [line.split("|").length, fields.length];
    const next = [restockFieldCount(nextLine), fieldsWithoutTrailingEmpty(nextLine)];
    if (!counts.some((count) => next.includes(count))) return false;
  }
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

/** Byte cap from a too-large error (0 when the cap is unknown, as with an edge
 * proxy's 413), or null for any other error. Duck-typed so this module stays
 * transport-free. */
function requestTooLargeCap(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const { errorCode, params } = error as { errorCode?: unknown; params?: { max_bytes?: unknown } };
  if (errorCode !== "REQUEST_TOO_LARGE" && errorCode !== "GATEWAY_REQUEST_TOO_LARGE") return null;
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

/* ----------------------------------------------------------- Stock format */

/** An upload's format ("Định dạng"): its first line names the columns,
 * `|`-separated like the lines (`UID|PASS|2FA|MAIL`); an optional `#` line
 * under it is the login notes ("Ghi chú đăng nhập"). Buyers see both above the
 * lines they receive, and a downloaded batch starts with them, so it uploads
 * again as it is. */
export interface StockFormatSplit {
  format: string | null;
  note: string | null;
  items: string[];
  /** Line 1 was an account, not a format: every line is stock and the format
   *  comes from the seller (typed in the batch card), or the upload is held. */
  needsFormat?: boolean;
  /** Uploaded without a format (the "line 1 is the format" box is off): every
   *  line is an account and buyers get the raw lines. */
  unformatted?: boolean;
  /** Unformatted, but line 1 reads like column names (`isRestockHeaderLine`):
   *  it would be sold as an account, so the seller is offered to use it. */
  headerHint?: boolean;
}

/** Longest format line the backend accepts (`STOCK_FORMAT_MAX_LENGTH`). */
export const STOCK_FORMAT_MAX_LENGTH = 500;

const DATA_LIKE = /@|:\/\/|\d{6,}/;

/** Whether a line can name columns rather than be an account: short, with no
 *  e-mail, URL or long number (UIDs, cookies and tokens all carry one). */
export function isFormatLine(line: string): boolean {
  return line.length <= STOCK_FORMAT_MAX_LENGTH && !DATA_LIKE.test(line);
}

export function cleanLoginNote(value: string): string | null {
  const text = value.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim();
  return text || null;
}

/** `typedFormat` is what the seller typed for an upload whose line 1 is an
 *  account; such an upload keeps every line as stock. */
export function splitStockFormat(lines: readonly string[], typedFormat?: string | null): StockFormatSplit {
  if (lines.length === 0) return { format: null, note: null, items: [] };
  if (typedFormat != null || !isFormatLine(lines[0])) {
    return { format: typedFormat?.trim() || null, note: null, items: [...lines], needsFormat: true };
  }
  const hasNote = lines.length > 1 && lines[1].startsWith("#");
  return {
    format: lines[0],
    note: hasNote ? cleanLoginNote(lines[1]) : null,
    items: lines.slice(hasNote ? 2 : 1),
  };
}

/** An upload taken as it is: every line is an account. */
export function unformattedStock(lines: readonly string[]): StockFormatSplit {
  return {
    format: null, note: null, items: [...lines], unformatted: true,
    headerHint: lines.length > 1 && isRestockHeaderLine(lines[0], lines[1]),
  };
}

/** Lines to add to an existing batch: a leading copy of its format line (and
 * the `#` notes under it), as a downloaded batch starts, is not stock. */
export function stripBatchHeader(lines: readonly string[], format: string): string[] {
  let start = 0;
  if (lines[0]?.trim() === format.trim()) {
    start = 1;
    if (lines[1]?.startsWith("#")) start = 2;
  }
  return lines.slice(start);
}

/** Lines whose `|`-field count differs from the format's: how many, and the
 * first few (1-based among `items`). A mismatch is only a warning. */
export function mismatchedLines(items: readonly string[], fieldCount: number, cap = 50): { total: number; lines: number[] } {
  let total = 0;
  const lines: number[] = [];
  items.forEach((item, index) => {
    if (restockFieldCount(item) === fieldCount) return;
    total += 1;
    if (lines.length < cap) lines.push(index + 1);
  });
  return { total, lines };
}

/** Columns of a format line, for headings. */
export function formatColumns(format: string): string[] {
  return format.split("|").map((column) => column.trim());
}

export interface StockGroupCheck {
  fieldCount: number;
  mismatch: { total: number; lines: number[] };
  /** No account under the format line. */
  empty: boolean;
  /** The format reads like an account (e-mail, URL, long number) or is too long. */
  looksLikeData: boolean;
  /** Line 1 was an account and no format was typed yet. */
  missingFormat: boolean;
}

export function checkStockGroup(group: StockFormatSplit): StockGroupCheck | null {
  if (!group.format) {
    if (!group.needsFormat) return null;
    return {
      fieldCount: restockFieldCount(group.items[0] ?? ""),
      mismatch: { total: 0, lines: [] },
      empty: group.items.length === 0,
      looksLikeData: false,
      missingFormat: true,
    };
  }
  const fieldCount = restockFieldCount(group.format);
  return {
    fieldCount,
    mismatch: mismatchedLines(group.items, fieldCount),
    empty: group.items.length === 0,
    looksLikeData: !isFormatLine(group.format),
    missingFormat: false,
  };
}

/** A batch that cannot be sent: nothing under its format, or no usable format
 *  (the server would refuse it, and an account must never become a format). */
export function isStockGroupBlocked(group: StockFormatSplit): boolean {
  const check = checkStockGroup(group);
  return check !== null && (check.empty || check.missingFormat || check.looksLikeData);
}

/** Line indexes of an upload's format line (first non-blank) and of the `#`
 *  login-notes line right under it (-1 when absent). */
export function formatLineIndexes(value: string): { format: number; note: number } {
  const lines = value.split("\n");
  let format = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    if (format < 0) { format = i; continue; }
    return { format, note: lines[i].trim().startsWith("#") ? i : -1 };
  }
  return { format, note: -1 };
}

/** Rows of the page in runs of one stock batch (rows of a batch sit together:
 *  they were uploaded together). `key` is the batch id or "none". */
export function groupRowsByBatch<T extends { batch_id?: number | null }>(rows: readonly T[]): { key: string; batchId: number | null; rows: { row: T; index: number }[] }[] {
  const groups: { key: string; batchId: number | null; rows: { row: T; index: number }[] }[] = [];
  rows.forEach((row, index) => {
    const batchId = row.batch_id ?? null;
    const last = groups[groups.length - 1];
    if (last && last.batchId === batchId) last.rows.push({ row, index });
    else groups.push({ key: batchId === null ? "none" : String(batchId), batchId, rows: [{ row, index }] });
  });
  return groups;
}
