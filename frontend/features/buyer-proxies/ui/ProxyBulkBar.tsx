"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Download, RotateCcw, Shield, Tag, X } from "@/components/Icons";

export type BulkAction = "tag" | "rotate" | "whitelist" | "export";

/** Floating action bar for the current selection. Sits over the table (not in
 *  the toolbar) so it is reachable however far down the list the user is. */
export function ProxyBulkBar({
  count, filteredTotal, busy, selectingAll, progress, onAction, onSelectAllFiltered, onClear, capabilities,
}: {
  count: number;
  filteredTotal: number;
  busy: BulkAction | null;
  /** "Select all matching" is fetching the remaining pages. */
  selectingAll: boolean;
  progress: { done: number; total: number } | null;
  onAction: (action: BulkAction) => void;
  onSelectAllFiltered: () => void;
  onClear: () => void;
  /** How many selected lines each capability applies to; actions with 0 are disabled. */
  capabilities: { rotate: number; whitelist: number };
}) {
  const t = useTranslations("buyerProxies");
  if (count === 0) return null;
  const item = (action: BulkAction, Icon: typeof Tag, label: string, enabled = true) => (
    <button
      type="button"
      disabled={!enabled || busy !== null}
      onClick={() => onAction(action)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12.5px] font-medium text-white/90 transition-colors",
        "hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        busy === action && "bg-iris text-white",
      )}
    >
      <Icon size={13} className={busy === action ? "animate-spin" : undefined} /> {label}
    </button>
  );
  return (
    <div className="pointer-events-none sticky bottom-4 z-30 flex justify-center px-2" role="region" aria-label={t("bulk.label")}>
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-xl bg-ink-panel py-1.5 pl-3.5 pr-1.5 text-white shadow-card-lg">
        <span className="mr-1 text-[12.5px] font-semibold whitespace-nowrap">
          {t("bulk.selected", { n: count })}
          {count < filteredTotal && (
            <button type="button" onClick={onSelectAllFiltered} disabled={selectingAll || busy !== null} aria-busy={selectingAll} className="ml-2 disabled:opacity-60 text-[12px] font-medium text-white/70 underline-offset-2 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded">
              {selectingAll ? t("bulk.selectingAll") : t("bulk.selectAllFiltered", { n: filteredTotal })}
            </button>
          )}
        </span>
        {progress && busy && (
          <span className="mr-1 inline-flex items-center gap-2 text-[11.5px] text-white/70">
            <span className="h-1 w-20 overflow-hidden rounded-full bg-white/15"><span className="block h-full bg-white/80" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} /></span>
            <span className="font-mono tabular">{progress.done}/{progress.total}</span>
          </span>
        )}
        {item("tag", Tag, t("bulk.tag"))}
        {item("rotate", RotateCcw, capabilities.rotate > 0 ? t("bulk.rotateN", { n: capabilities.rotate }) : t("bulk.rotate"), capabilities.rotate > 0)}
        {item("whitelist", Shield, capabilities.whitelist > 0 ? t("bulk.whitelistN", { n: capabilities.whitelist }) : t("bulk.whitelist"), capabilities.whitelist > 0)}
        {item("export", Download, t("bulk.export"))}
        <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
        <button type="button" onClick={onClear} disabled={busy !== null} aria-label={t("bulk.clear")} className="grid h-8 w-8 place-items-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
