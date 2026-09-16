"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import type { InventoryPackage } from "@/lib/types";
import { Card, Input, Tag } from "@/components/ui";
import { ChevronDown, ChevronRight, Search, X } from "@/components/Icons";
import { checkState, scopeCategoryPackages, scopeCategoryProducts, scopeSummary, type CheckState, type ScopeCategory } from "../model";

function TriCheckbox({ state, onChange, label, disabled }: { state: CheckState; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={state === "all"}
      disabled={disabled}
      ref={(el) => { if (el) el.indeterminate = state === "some"; }}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="h-3.5 w-3.5 shrink-0 rounded border-line-2 text-iris disabled:opacity-40"
    />
  );
}

/** Category → product → package tree with tri-state checkboxes. `selected`
 *  only ever holds eligible (active, or all when includeInactive) ids. */
export function ScopeTree({
  tree,
  selected,
  onChange,
  includeInactive,
  onIncludeInactive,
}: {
  tree: ScopeCategory[];
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  includeInactive: boolean;
  onIncludeInactive: (next: boolean) => void;
}) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const eligible = (p: InventoryPackage) => includeInactive || p.is_active;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tree;
    const filterCat = (cat: ScopeCategory, inherit: boolean): ScopeCategory | null => {
      const hit = inherit || cat.name.toLowerCase().includes(q);
      const products = cat.products
        .map((p) => ({ ...p, packages: p.packages.filter((pkg) => hit || p.title.toLowerCase().includes(q) || pkg.variant_name.toLowerCase().includes(q) || String(pkg.variant_id) === q.replace(/^#/, "") || String(p.id) === q.replace(/^#/, "")) }))
        .filter((p) => p.packages.length > 0);
      const children = cat.children.map((c) => filterCat(c, hit)).filter((c): c is ScopeCategory => c !== null);
      return products.length || children.length ? { ...cat, products, children } : null;
    };
    return tree.map((c) => filterCat(c, false)).filter((c): c is ScopeCategory => c !== null);
  }, [tree, query]);

  const allEligibleIds = tree.flatMap((c) => scopeCategoryPackages(c).filter(eligible).map((pkg) => pkg.variant_id));
  const summary = scopeSummary(tree, selected);
  const toggleIds = (ids: number[], checked: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
    onChange(next);
  };
  const toggleOpen = (key: string) => setClosed((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const renderCategory = (cat: ScopeCategory, depth: number) => {
    const catIds = scopeCategoryPackages(cat).filter(eligible).map((pkg) => pkg.variant_id);
    const catKey = `c${cat.id}`;
    const catOpen = !closed.has(catKey);
    const productCount = scopeCategoryProducts(cat).length;
    const indent = 12 + depth * 18;
    return (
      <div key={cat.id}>
        <div role="button" tabIndex={0} onClick={() => toggleOpen(catKey)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOpen(catKey); } }} style={{ paddingLeft: indent }} className="flex cursor-pointer items-center gap-2 py-1.5 pr-3 text-[12.5px] hover:bg-raised/60">
          {catOpen ? <ChevronDown size={12} className="text-faint" /> : <ChevronRight size={12} className="text-faint" />}
          <TriCheckbox state={checkState(catIds, selected)} onChange={(c) => toggleIds(catIds, c)} label={cat.name} disabled={catIds.length === 0} />
          <span className={cn("min-w-0 flex-1 truncate text-fg", depth === 0 ? "font-semibold" : "font-medium")}>{cat.name}</span>
          <span className="font-mono text-[11px] text-faint">{t("scope.catCount", { products: productCount, packages: catIds.length })}</span>
        </div>
        {catOpen && cat.children.map((child) => renderCategory(child, depth + 1))}
        {catOpen && cat.products.map((product) => {
          const ids = product.packages.filter(eligible).map((pkg) => pkg.variant_id);
          const key = `p${product.id}`;
          const open = !closed.has(key);
          const available = product.packages.filter(eligible).reduce((sum, pkg) => sum + pkg.available, 0);
          return (
            <div key={product.id}>
              <div role="button" tabIndex={0} onClick={() => toggleOpen(key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOpen(key); } }} style={{ paddingLeft: indent + 18 }} className="flex cursor-pointer items-center gap-2 py-1.5 pr-3 text-[12.5px] hover:bg-raised/60">
                {open ? <ChevronDown size={12} className="text-faint" /> : <ChevronRight size={12} className="text-faint" />}
                <TriCheckbox state={checkState(ids, selected)} onChange={(c) => toggleIds(ids, c)} label={product.title} disabled={ids.length === 0} />
                <span className="min-w-0 flex-1 truncate text-fg">
                  {product.title}
                  {product.status !== "active" && <span className="ml-1 text-[11px] text-faint">· {t("state.productPaused")}</span>}
                </span>
                <span className="font-mono text-[11px] text-faint">{available.toLocaleString(locale)}</span>
              </div>
              {open && product.packages.map((pkg) => {
                const ok = eligible(pkg);
                return (
                  <label key={pkg.variant_id} style={{ paddingLeft: indent + 42 }} className={cn("flex items-center gap-2 py-1.5 pr-3 text-[12px] hover:bg-raised/60", !ok && "opacity-50")}>
                    <TriCheckbox state={selected.has(pkg.variant_id) ? "all" : "none"} onChange={(c) => toggleIds([pkg.variant_id], c)} label={pkg.variant_name} disabled={!ok} />
                    <span className="min-w-0 flex-1 truncate text-fg">
                      {pkg.variant_name}
                      {!pkg.is_active && <span className="ml-1 text-[11px] text-faint">· {t("state.inactive")}</span>}
                    </span>
                    <span className={cn("font-mono text-[11px]", pkg.available === 0 ? "text-bad" : "text-faint")}>{pkg.available.toLocaleString(locale)}</span>
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Card className="flex flex-col overflow-hidden p-0">
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-fg">{t("scope.title")}</span>
          <span className="text-[11.5px] text-faint">{t("scope.total", { count: allEligibleIds.length })}</span>
        </div>
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("scope.searchPlaceholder")} aria-label={t("scope.searchPlaceholder")} className="h-8 pl-8 pr-7 text-xs" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label={t("clear")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-fg"><X size={12} /></button>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
          <Tag tone={selected.size ? "iris" : "neutral"}>
            {t("scope.selected", { categories: summary.categories, products: summary.products, packages: summary.packages })}
          </Tag>
          <button type="button" onClick={() => onChange(new Set(allEligibleIds))} className="text-iris hover:underline">{t("scope.selectAll")}</button>
          <span className="text-faint">·</span>
          <button type="button" onClick={() => onChange(new Set())} className="text-iris hover:underline">{t("scope.clear")}</button>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted hover:text-fg">
          <input type="checkbox" checked={includeInactive} onChange={(e) => onIncludeInactive(e.target.checked)} className="h-3.5 w-3.5 rounded border-line-2 text-iris" />
          {t("scope.includeInactive")}
        </label>
      </div>
      <div className="max-h-[640px] overflow-y-auto py-1">
        {visible.length === 0 && <p className="px-3 py-4 text-center text-[12px] text-muted">{t("scope.noMatch")}</p>}
        {visible.map((cat) => renderCategory(cat, 0))}
      </div>
    </Card>
  );
}
