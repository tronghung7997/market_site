"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ChevronLeft, ChevronRight, Plus, X } from "@/components/Icons";
import { moveItem } from "../model";

/** Ordered column chooser: active chips are draggable (and have ‹ › for the
 *  keyboard); inactive ones sit after a divider and join at the end on click. */
export function ColumnPicker<T extends string>({
  active,
  available,
  label,
  render,
  onChange,
  locked,
}: {
  active: T[];
  available: T[];
  label: string;
  render: (column: T) => string;
  onChange: (next: T[]) => void;
  /** Columns that cannot be removed (still reorderable). */
  locked?: T[];
}) {
  const t = useTranslations("sellerInventory");
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const inactive = available.filter((c) => !active.includes(c));

  const drop = (to: number) => {
    if (dragging != null) onChange(moveItem(active, dragging, to));
    setDragging(null);
    setOver(null);
  };

  return (
    <div className="space-y-1.5" aria-label={label}>
      <div role="list" className="flex flex-wrap items-center gap-1.5">
        {active.map((column, i) => (
          <div
            key={column}
            role="listitem"
            draggable
            onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(e) => { e.preventDefault(); if (over !== i) setOver(i); }}
            onDragLeave={() => { if (over === i) setOver(null); }}
            onDrop={(e) => { e.preventDefault(); drop(i); }}
            onDragEnd={() => { setDragging(null); setOver(null); }}
            className={cn(
              "group inline-flex cursor-grab items-center gap-0.5 rounded-md border border-iris/25 bg-iris-soft py-0.5 pl-1 pr-1 text-[11.5px] font-medium text-iris-hi transition-colors active:cursor-grabbing",
              dragging === i && "opacity-40",
              over === i && dragging !== i && "ring-2 ring-iris/50",
            )}
          >
            <span className="mr-0.5 select-none font-mono text-[10px] text-iris-hi/70">{i + 1}</span>
            <span>{render(column)}</span>
            <button type="button" disabled={i === 0} onClick={() => onChange(moveItem(active, i, i - 1))} aria-label={t("columns.moveLeft", { column: render(column) })} className="ml-1 hidden h-4 w-4 items-center justify-center rounded text-iris-hi/70 hover:bg-iris/10 group-hover:inline-flex disabled:opacity-30 group-focus-within:inline-flex"><ChevronLeft size={11} /></button>
            <button type="button" disabled={i === active.length - 1} onClick={() => onChange(moveItem(active, i, i + 1))} aria-label={t("columns.moveRight", { column: render(column) })} className="hidden h-4 w-4 items-center justify-center rounded text-iris-hi/70 hover:bg-iris/10 group-hover:inline-flex disabled:opacity-30 group-focus-within:inline-flex"><ChevronRight size={11} /></button>
            {!locked?.includes(column) && (
              <button type="button" onClick={() => onChange(active.filter((c) => c !== column))} aria-label={t("columns.remove", { column: render(column) })} className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-iris-hi/70 hover:bg-iris/10 hover:text-bad"><X size={11} /></button>
            )}
          </div>
        ))}
        {inactive.length > 0 && active.length > 0 && <span className="mx-1 h-4 w-px bg-line-2" aria-hidden />}
        {inactive.map((column) => (
          <button key={column} type="button" onClick={() => onChange([...active, column])} aria-label={t("columns.add", { column: render(column) })} className="inline-flex items-center gap-0.5 rounded-md border border-line-2 bg-surface px-1.5 py-0.5 text-[11.5px] font-medium text-muted hover:border-faint hover:text-fg">
            {render(column)} <Plus size={10} className="opacity-70" />
          </button>
        ))}
      </div>
      <p className="text-[11px] text-faint">{t("columns.hint")}</p>
    </div>
  );
}
