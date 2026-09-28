import { parseResourceItems, parseRestockFileContent, splitRestockSource } from "./logic.ts";

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
  return { id, kind, name, size, header, keepHeader: false, items };
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
