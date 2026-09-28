"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { FileText, X } from "@/components/Icons";
import { formatByteSize } from "../logic";
import { stockSourceLineCount, type StockSource } from "../stock-sources";
import type { StockFileReading } from "../useStockSources";

/** Uploaded files / large pastes of a stock form, one chip each (name, size,
 *  lines, detected header with keep/skip), plus files still being read. */
export function StockSourceChips({
  sources,
  reading,
  onRemove,
  onToggleHeader,
  disabled = false,
}: {
  sources: readonly StockSource[];
  reading: readonly StockFileReading[];
  onRemove: (id: number) => void;
  onToggleHeader: (id: number) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  if (sources.length === 0 && reading.length === 0) return null;
  return (
    <ul className="space-y-1.5" aria-label={t("restock.sourcesLabel")}>
      {sources.map((source) => (
        <li key={source.id} className="animate-fade-in rounded-lg border border-line bg-surface px-3 py-2">
          <div className="flex items-center gap-2 text-[12px]">
            <FileText size={14} className="shrink-0 text-iris" />
            <span className="min-w-0 truncate font-medium text-fg" title={source.name}>{source.name}</span>
            <span className="shrink-0 text-faint">· {formatByteSize(source.size, locale)} · {t("restock.fileLines", { count: stockSourceLineCount(source) })}</span>
            <Button size="sm" variant="ghost" onClick={() => onRemove(source.id)} disabled={disabled} aria-label={t("restock.removeFile", { name: source.name })} className="ml-auto h-6 w-6 p-0 text-muted"><X size={12} /></Button>
          </div>
          {source.header && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-[22px] text-[11.5px] text-muted">
              <span className="min-w-0 truncate">
                {source.keepHeader ? t("restock.headerKept") : t("restock.headerSkipped")}
                {" "}<code className="rounded bg-raised px-1 font-mono text-[11px] text-fg">{source.header.length > 60 ? `${source.header.slice(0, 60)}…` : source.header}</code>
              </span>
              <button type="button" onClick={() => onToggleHeader(source.id)} disabled={disabled} className="font-medium text-iris hover:underline disabled:opacity-50">
                {source.keepHeader ? t("restock.skipHeader") : t("restock.keepHeader")}
              </button>
            </p>
          )}
        </li>
      ))}
      {reading.map(({ id, name }) => (
        <li key={`reading-${id}`} className="flex items-center gap-2 rounded-lg border border-dashed border-line-2 bg-surface px-3 py-2 text-[12px] text-muted" aria-live="polite">
          <span aria-hidden className="h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-iris border-t-transparent" />
          {t("restock.reading", { name })}
        </li>
      ))}
    </ul>
  );
}
