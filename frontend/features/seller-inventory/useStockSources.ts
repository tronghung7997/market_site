"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  PASTE_AS_SOURCE_CHARS,
  removeStockSource,
  setStockSourceFormat,
  stockSourceFromText,
  stockSourceLines,
  toggleStockSourceHeader,
  type StockSource,
} from "./stock-sources.ts";

/** Let the browser paint (spinner, chip) before a synchronous parse. rAF is
 * paused in background tabs, so a timer fallback keeps the read moving there. */
const nextFrame = () => new Promise<void>((resolve) => {
  const fallback = setTimeout(resolve, 50);
  requestAnimationFrame(() => { clearTimeout(fallback); setTimeout(resolve, 0); });
});

export interface StockFileReading {
  id: number;
  name: string;
}

let nextSourceId = 1;

/** Read uploaded files into sources, one at a time, reporting each read in
 * progress. Works with state owned by the caller (see `useStockSources`). */
export async function readStockFiles(
  files: readonly File[],
  {
    onReading,
    onSource,
    onError,
  }: {
    onReading: (reading: StockFileReading, active: boolean) => void;
    onSource: (source: StockSource) => void;
    onError: (name: string) => void;
  },
): Promise<void> {
  for (const file of files) {
    const reading = { id: nextSourceId++, name: file.name };
    onReading(reading, true);
    try {
      const raw = await file.text();
      await nextFrame();
      onSource(stockSourceFromText(nextSourceId++, "file", file.name, file.size, raw));
    } catch {
      onError(file.name);
    } finally {
      onReading(reading, false);
    }
  }
}

/** Source for a paste too large for the textarea, or null (let it paste). */
export function stockSourceFromPaste(event: React.ClipboardEvent, name: string): StockSource | null {
  const pasted = event.clipboardData.getData("text");
  if (pasted.length < PASTE_AS_SOURCE_CHARS) return null;
  event.preventDefault();
  return stockSourceFromText(nextSourceId++, "paste", name, new Blob([pasted]).size, pasted);
}

/** Uploads held as source chips (see `StockSource`) for a stock upload form. */
export function useStockSources({ pastedName, onReadError }: { pastedName: string; onReadError: (name: string) => void }) {
  const [sources, setSources] = useState<StockSource[]>([]);
  const [reading, setReading] = useState<StockFileReading[]>([]);
  const errorRef = useRef(onReadError);
  errorRef.current = onReadError;

  const addFiles = useCallback((files: readonly File[]) => readStockFiles(files, {
    onReading: (entry, active) => setReading((prev) => (active ? [...prev, entry] : prev.filter((r) => r.id !== entry.id))),
    onSource: (source) => setSources((prev) => [...prev, source]),
    onError: (name) => errorRef.current(name),
  }), []);

  /** Turns a very large paste into a source; returns true when it did. */
  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const source = stockSourceFromPaste(event, pastedName);
    if (!source) return false;
    setSources((prev) => [...prev, source]);
    return true;
  }, [pastedName]);

  const remove = useCallback((id: number) => setSources((prev) => removeStockSource(prev, id)), []);
  const toggleHeader = useCallback((id: number) => setSources((prev) => toggleStockSourceHeader(prev, id)), []);
  const setFormat = useCallback((id: number, format: string) => setSources((prev) => setStockSourceFormat(prev, id, format)), []);
  const clear = useCallback(() => setSources([]), []);
  const lines = useMemo(() => stockSourceLines(sources), [sources]);

  return { sources, setSources, reading, lines, addFiles, handlePaste, remove, toggleHeader, setFormat, clear };
}
