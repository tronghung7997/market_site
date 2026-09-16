"use client";

/** Category filter for the storefront shelf. A single trigger ("Danh mục:
 *  Tất cả") opens a popover listing the whole tree — parents as group rows,
 *  children indented — with counts and a search box once the tree is big.
 *  Scales to dozens of categories where a chip row does not. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { Category } from "@/lib/types";
import { categoryCoverId } from "@/lib/product-covers";
import { ProductCover } from "@/components/products/ProductCover";
import { Check, ChevronDown, Search, X } from "@/components/Icons";

const SEARCH_THRESHOLD = 8;

export function CategoryPicker({ cats, active, onChange, countFor, total }: {
  /** Category tree (parents with `children`). */
  cats: Category[];
  active: number | null;
  onChange: (id: number | null) => void;
  /** Product count for a category incl. its children; null when unknown. */
  countFor: (id: number) => number | null;
  total: number;
}) {
  const t = useTranslations("home");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const flat = useMemo(() => {
    const out: { cat: Category; depth: number }[] = [];
    const walk = (list: Category[], depth: number) => list.forEach((c) => { out.push({ cat: c, depth }); walk(c.children ?? [], depth + 1); });
    walk(cats, 0);
    return out;
  }, [cats]);
  const activeCat = active != null ? flat.find((x) => x.cat.id === active)?.cat ?? null : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); cancelAnimationFrame(frame); };
  }, [open]);

  const query = q.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!query) return flat.filter(({ cat }) => (countFor(cat.id) ?? 1) > 0);
    // Keep a parent when any of its children match so the indent still reads.
    const matches = new Set<number>();
    flat.forEach(({ cat }) => { if (cat.name.toLowerCase().includes(query)) matches.add(cat.id); });
    flat.forEach(({ cat }) => { if ((cat.children ?? []).some((c) => matches.has(c.id))) matches.add(cat.id); });
    return flat.filter(({ cat }) => matches.has(cat.id));
  }, [flat, query, countFor]);

  const pick = (id: number | null) => { onChange(id); setOpen(false); setQ(""); };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-10 max-w-full items-center gap-2 rounded-lg border bg-surface px-3 text-[13px] font-medium transition-colors",
          open ? "border-iris ring-2 ring-iris/20" : activeCat ? "border-iris/40 bg-iris-soft/40 text-iris-hi" : "border-line text-fg hover:border-line-2",
        )}
      >
        {activeCat ? (
          <>
            <ProductCover coverId={categoryCoverId(activeCat)} title={activeCat.name} className="h-5 w-5 rounded" />
            <span className="truncate">{activeCat.name}</span>
            <span className="font-mono text-[11.5px] text-iris">{countFor(activeCat.id) ?? ""}</span>
          </>
        ) : (
          <>
            <span className="text-muted">{t("categoryPickerLabel")}</span>
            <span>{t("all")}</span>
            <span className="font-mono text-[11.5px] text-faint">{total}</span>
          </>
        )}
        <ChevronDown size={14} className={cn("shrink-0 text-faint transition-transform", open && "rotate-180")} />
      </button>
      {activeCat && (
        <button
          type="button"
          onClick={() => pick(null)}
          aria-label={t("clearCategory")}
          className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full border border-line bg-surface text-faint shadow-card hover:text-fg"
        >
          <X size={11} />
        </button>
      )}

      {open && (
        <div role="listbox" className="absolute left-0 top-12 z-30 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-card-lg animate-pop">
          {flat.length > SEARCH_THRESHOLD && (
            <div className="relative border-b border-line p-2">
              <Search size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("searchCategories")}
                className="h-8 w-full rounded-lg border border-line bg-raised/40 pl-8 pr-2 text-[12.5px] text-fg outline-none focus:border-iris"
              />
            </div>
          )}
          <div className="max-h-[360px] overflow-y-auto p-1.5">
            {!query && (
              <button type="button" role="option" aria-selected={active == null} onClick={() => pick(null)}
                className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-raised", active == null && "bg-iris-soft/50 font-medium")}>
                <span className="grid h-6 w-6 place-items-center rounded-md border border-line bg-raised text-[10px] font-semibold text-muted">∗</span>
                <span className="flex-1">{t("all")}</span>
                <span className="font-mono text-[11.5px] text-faint">{total}</span>
                {active == null && <Check size={13} className="text-iris" />}
              </button>
            )}
            {rows.length === 0 && <p className="px-2.5 py-3 text-[12.5px] text-faint">{t("noCategoryMatch")}</p>}
            {rows.map(({ cat, depth }) => {
              const count = countFor(cat.id);
              const selected = active === cat.id;
              return (
                <button key={cat.id} type="button" role="option" aria-selected={selected} onClick={() => pick(cat.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg py-2 pr-2.5 text-left text-[13px] hover:bg-raised",
                    depth === 0 ? "pl-2.5 font-medium" : "pl-9 text-muted",
                    selected && "bg-iris-soft/50 text-fg",
                  )}>
                  <ProductCover coverId={categoryCoverId(cat)} title={cat.name} className={cn("rounded", depth === 0 ? "h-6 w-6" : "h-5 w-5")} />
                  <span className="flex-1 truncate">{cat.name}</span>
                  {count != null && <span className="font-mono text-[11.5px] text-faint">{count}</span>}
                  {selected && <Check size={13} className="text-iris" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
