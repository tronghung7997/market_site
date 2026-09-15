"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { InventoryCategoryFacet } from "@/lib/types";
import { ChevronDown, ChevronRight, ListFilter, Search, X } from "@/components/Icons";
import {
  buildCategoryTree, categoryNodeIds, categorySelectionLabel, checkState, compactCategorySelection,
  expandCategorySelection, type CategoryNode,
} from "../model";

/** Multi-select category filter shown as a parent → child tree. Ticking a
 *  parent ticks the whole branch; the value handed back is compacted so a
 *  fully ticked branch is just the parent id (the API expands it again). */
export function CategoryTreeSelect({
  facet,
  value,
  onChange,
}: {
  facet: InventoryCategoryFacet[];
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => buildCategoryTree(facet), [facet]);
  const ticked = useMemo(() => expandCategorySelection(tree, value), [tree, value]);
  const names = categorySelectionLabel(tree, value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const toggle = (node: CategoryNode, checked: boolean) => {
    const next = new Set(ticked);
    categoryNodeIds(node).forEach((id) => (checked ? next.add(id) : next.delete(id)));
    onChange(compactCategorySelection(tree, next));
  };
  const matches = (node: CategoryNode, q: string): boolean =>
    node.name.toLowerCase().includes(q) || node.children.some((c) => matches(c, q));

  const summary = names.length === 0
    ? t("categoryPicker.all")
    : names.length <= 2 ? names.join(", ") : t("categoryPicker.many", { first: names[0], count: names.length - 1 });

  const renderNode = (node: CategoryNode, depth: number) => {
    const q = query.trim().toLowerCase();
    if (q && !matches(node, q)) return null;
    const ids = categoryNodeIds(node);
    const state = checkState(ids, ticked);
    const hasChildren = node.children.length > 0;
    const isOpen = !collapsed.has(node.id) || Boolean(q);
    return (
      <div key={node.id}>
        <label className={cn("flex cursor-pointer items-center gap-2 py-1.5 pr-2 text-[12.5px] hover:bg-raised/60", depth === 0 ? "pl-2" : "pl-7")}>
          {hasChildren ? (
            <button type="button" onClick={(e) => { e.preventDefault(); setCollapsed((prev) => { const n = new Set(prev); if (n.has(node.id)) n.delete(node.id); else n.add(node.id); return n; }); }} aria-label={isOpen ? t("table.collapse") : t("table.expand")} className="inline-flex h-4 w-4 items-center justify-center rounded text-faint hover:text-fg">
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : <span className="inline-block h-4 w-4" />}
          <input
            type="checkbox"
            checked={state === "all"}
            ref={(el) => { if (el) el.indeterminate = state === "some"; }}
            onChange={(e) => toggle(node, e.target.checked)}
            className="h-3.5 w-3.5 rounded border-line-2 text-iris"
          />
          <span className={cn("min-w-0 flex-1 truncate", depth === 0 ? "font-semibold text-fg" : "text-fg")}>{node.name}</span>
          <span className="font-mono text-[11px] text-faint">{node.count.toLocaleString(locale)}</span>
        </label>
        {hasChildren && isOpen && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn("inline-flex h-9 w-[230px] items-center gap-2 rounded-lg border bg-surface px-2.5 text-left text-xs transition-colors hover:border-faint", open ? "border-iris ring-2 ring-iris/20" : "border-line-2", value.length > 0 ? "text-fg" : "text-muted")}
      >
        <ListFilter size={13} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {value.length > 0 && (
          <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onChange([]); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onChange([]); } }} aria-label={t("categoryPicker.clear")} className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted hover:bg-raised hover:text-fg"><X size={11} /></span>
        )}
        <ChevronDown size={13} className="shrink-0 text-muted" />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable className="absolute left-0 top-10 z-30 w-[320px] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-2 shadow-card-lg">
          <div className="relative mb-1.5">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("categoryPicker.searchPlaceholder")} className="h-8 w-full rounded-lg border border-line-2 bg-raised/40 pl-8 pr-2 text-[12.5px] text-fg outline-none focus:border-iris" />
          </div>
          <div className="mb-1 flex items-center justify-between px-2 text-[11.5px]">
            <span className="text-faint">{t("categoryPicker.hint")}</span>
            <button type="button" onClick={() => onChange([])} className="text-iris hover:underline">{t("categoryPicker.all")}</button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {tree.map((n) => renderNode(n, 0))}
            {tree.length === 0 && <p className="px-2 py-3 text-center text-[12px] text-muted">{t("categoryPicker.empty")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
