import { parseResourceItems, parseRestockFileContent, splitRestockSource, splitStockFormat, stripBatchHeader, unformattedStock, type StockFormatSplit } from "./logic.ts";

/**
 * A file (or a very large paste) of stock lines, kept as parsed lines beside
 * the textarea instead of inside it: megabytes of text in a textarea make every
 * keystroke re-render and re-parse the whole upload, which is what freezes the
 * page. Every stock upload surface (restock console, quick restock, new
 * product packages, manual delivery) holds its uploads this way.
 */
export interface StockSource {
  id: number;
  kind: "file" | "paste";
  name: string;
  /** Size of what was uploaded, in bytes (for the chip). */
  size: number;
  /** A detected column header, split off the lines (the seller can keep it). */
  header: string | null;
  keepHeader: boolean;
  items: string[];
  /** Format the seller typed because line 1 is an account (see `splitStockFormat`). */
  format: string | null;
}

/** A paste this large becomes a source chip instead of textarea content. */
export const PASTE_AS_SOURCE_CHARS = 100_000;

export function stockSourceFromText(
  id: number,
  kind: StockSource["kind"],
  name: string,
  size: number,
  content: string,
): StockSource {
  const { header, items } = splitRestockSource(kind === "file" ? parseRestockFileContent(name, content) : content);
  return { id, kind, name, size, header, keepHeader: false, items, format: null };
}

/** Lines of every source, in upload order (a kept header first in its source). */
export function stockSourceLines(sources: readonly StockSource[]): string[] {
  const lines: string[] = [];
  for (const source of sources) {
    if (source.header && source.keepHeader) lines.push(source.header);
    for (const item of source.items) lines.push(item);
  }
  return lines;
}

/** Lines a source contributes (for its chip). */
export function stockSourceLineCount(source: StockSource): number {
  return source.items.length + (source.header && source.keepHeader ? 1 : 0);
}

export function removeStockSource(sources: readonly StockSource[], id: number): StockSource[] {
  return sources.filter((source) => source.id !== id);
}

export function setStockSourceFormat(sources: readonly StockSource[], id: number, format: string): StockSource[] {
  return sources.map((source) => (source.id === id ? { ...source, format } : source));
}

export function toggleStockSourceHeader(sources: readonly StockSource[], id: number): StockSource[] {
  return sources.map((source) => (source.id === id ? { ...source, keepHeader: !source.keepHeader } : source));
}

/** Drop lines already seen earlier in the sources (then in `seen`), keeping the first. */
export function dedupeStockSources(sources: readonly StockSource[], seen: Set<string> = new Set()): StockSource[] {
  return sources.map((source) => {
    const items = source.items.filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
    return items.length === source.items.length ? source : { ...source, items };
  });
}

/** Every line of an upload form: its sources, then the typed text; duplicates dropped. */
export function stockUploadLines(sources: readonly StockSource[], text: string): string[] {
  return [...new Set([...stockSourceLines(sources), ...parseResourceItems(text, false)])];
}

/** Every line of a source as uploaded (a detected header is a line too). */
function allSourceLines(source: StockSource): string[] {
  return source.header ? [source.header, ...source.items] : source.items;
}

/** One batch of a stock upload: a file or large paste, or the typed text. */
export interface StockFormatGroup extends StockFormatSplit {
  key: string;
  name: string;
  /** The file or large paste the batch comes from (none for the typed text). */
  sourceId?: number;
}

/** An upload split into batches: every source is one, and so is the typed
 * text. With `hasFormat` (the seller's "line 1 is the format" box) each starts
 * with its format line; without it every line is an account. Sources without
 * lines are left out. */
export function stockFormatGroups(sources: readonly StockSource[], text: string, typedName: string, hasFormat = true): StockFormatGroup[] {
  const split = (lines: readonly string[], typedFormat?: string | null) => (
    hasFormat ? splitStockFormat(lines, typedFormat) : unformattedStock(lines)
  );
  const groups: StockFormatGroup[] = [];
  for (const source of sources) {
    const lines = allSourceLines(source);
    if (lines.length > 0) {
      groups.push({ key: `source-${source.id}`, name: source.name, sourceId: source.id, ...split(lines, source.format) });
    }
  }
  const typed = parseResourceItems(text, false);
  if (typed.length > 0) groups.push({ key: "typed", name: typedName, ...split(typed) });
  return groups;
}

/** Lines of an upload that adds to an existing batch (see `stripBatchHeader`). */
export function stockAppendLines(sources: readonly StockSource[], text: string, format: string): string[] {
  const lines: string[] = [];
  for (const source of sources) lines.push(...stripBatchHeader(allSourceLines(source), format));
  lines.push(...stripBatchHeader(parseResourceItems(text, false), format));
  return lines;
}

/** Upload of a stock form as batches ready to send: one per source / typed
 * text that has lines under its format, duplicates inside a batch dropped. */
export function stockUploadBatches(sources: readonly StockSource[], text: string, typedName: string, hasFormat = true): StockFormatGroup[] {
  return stockFormatGroups(sources, text, typedName, hasFormat).map((group) => ({ ...group, items: [...new Set(group.items)] }));
}
