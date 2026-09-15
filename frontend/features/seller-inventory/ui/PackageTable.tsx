"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { daysAgo } from "@/lib/utils";
import type { InventoryPackage, InventoryPackageSort } from "@/lib/types";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { Tag } from "@/components/ui";
import { ChevronDown, ChevronRight, ChevronUp, Edit2, Plus } from "@/components/Icons";
import { categoryPath, checkState, groupPackages, stockBarPercent, stockTone, type PackageGroup } from "../model";

function SortHeader({
  label, asc, desc, sort, onSort, className,
}: {
  label: string; asc: InventoryPackageSort; desc: InventoryPackageSort; sort: InventoryPackageSort;
  onSort: (next: InventoryPackageSort) => void; className?: string;
}) {
  const active = sort === asc || sort === desc;
  const Icon = sort === asc ? ChevronUp : ChevronDown;
  return (
    <th className={cn("px-3 py-3", className)} aria-sort={sort === asc ? "ascending" : sort === desc ? "descending" : "none"}>
      <button type="button" onClick={() => onSort(sort === asc ? desc : asc)} className={cn("inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-fg", active && "text-fg")}>
        {label} <Icon size={12} className={cn(!active && "opacity-40")} />
      </button>
    </th>
  );
}

function Checkbox({ state, onChange, label }: { state: "none" | "some" | "all"; onChange: (checked: boolean) => void; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={state === "all"}
      ref={(el) => { if (el) el.indeterminate = state === "some"; }}
      onChange={(e) => onChange(e.target.checked)}
      className="h-3.5 w-3.5 rounded border-line-2 text-iris"
    />
  );
}

export function PackageTable({
  items,
  grouped,
  threshold,
  sort,
  onSort,
  selected,
  onSelect,
}: {
  items: InventoryPackage[];
  grouped: boolean;
  threshold: number;
  sort: InventoryPackageSort;
  onSort: (next: InventoryPackageSort) => void;
  selected: Set<number>;
  onSelect: (ids: number[], checked: boolean) => void;
}) {
  const t = useTranslations("sellerInventory");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const groups = grouped ? groupPackages(items) : null;
  const allIds = items.map((p) => p.variant_id);

  const toggleGroup = (productId: number) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(productId)) next.delete(productId); else next.add(productId);
    return next;
  });

  const renderPackage = (pkg: InventoryPackage, indent: boolean) => {
    const tone = stockTone(pkg);
    const isSelected = selected.has(pkg.variant_id);
    const inactive = !pkg.is_active;
    const barColor = pkg.stock_state === "out" ? "bg-bad" : pkg.stock_state === "low" ? "bg-warn" : "bg-good";
    return (
      <tr key={pkg.variant_id} className={cn("transition-colors hover:bg-raised/50", isSelected && "bg-iris-soft/20", inactive && "opacity-60")}>
        <td className="px-3 py-2.5">
          <Checkbox state={isSelected ? "all" : "none"} onChange={(c) => onSelect([pkg.variant_id], c)} label={t("table.selectRow", { name: pkg.variant_name })} />
        </td>
        <td className={cn("py-2.5 pr-3", indent ? "pl-11" : "pl-1")}>
          <div className="flex items-center gap-3">
            {!indent && <ProductCover coverId={parseCoverId({ cover_id: pkg.cover_id })} title={pkg.product_title} className="h-8 w-8 shrink-0 rounded-lg" />}
            <div className="min-w-0">
              <Link href={`/seller/inventory/${pkg.variant_id}`} className="block max-w-[320px] truncate text-[13px] font-medium text-fg hover:text-iris" title={pkg.variant_name}>
                {pkg.variant_name}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-faint">
                <span className="font-mono">#{pkg.variant_id}</span>
                {!indent && <span className="truncate">{pkg.product_title} <span className="font-mono">#{pkg.product_id}</span></span>}
                <span>{t("table.autoDelivery")}</span>
              </div>
            </div>
          </div>
        </td>
        <td className="px-2 py-2.5 text-right font-mono text-[12.5px] tabular whitespace-nowrap">{formatBrowseMoney(pkg.price, { locale })}</td>
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className={cn("inline-block w-12 font-mono text-[13px] font-semibold tabular", pkg.stock_state === "out" ? "text-bad" : pkg.stock_state === "low" ? "text-warn" : "text-fg")}>
              {pkg.available.toLocaleString(locale)}
            </span>
            <span className="inline-block h-1.5 w-12 overflow-hidden rounded-full bg-raised" aria-hidden>
              <span className={cn("block h-full rounded-full", barColor)} style={{ width: `${inactive ? 0 : stockBarPercent(pkg.available, threshold)}%` }} />
            </span>
            {(pkg.stock_state === "low" || pkg.stock_state === "out") && (
              <Tag tone={tone}>{pkg.stock_state === "out" ? t("state.out") : t("state.low")}</Tag>
            )}
          </div>
        </td>
        <td className="px-2 py-2.5 text-right font-mono text-[12.5px] tabular">{pkg.sold_30d.toLocaleString(locale)}</td>
        <td className={cn("px-2 py-2.5 text-right font-mono text-[12.5px] tabular", pkg.error > 0 ? "text-warn" : "text-faint")}>{pkg.error > 0 ? pkg.error.toLocaleString(locale) : "—"}</td>
        <td className="truncate px-2 py-2.5 text-[12px] text-muted whitespace-nowrap">{pkg.last_restock_at ? daysAgo(pkg.last_restock_at, locale) : "—"}</td>
        <td className="px-2 py-2.5 whitespace-nowrap">
          {inactive ? <Tag tone="neutral">{t("state.inactive")}</Tag>
            : pkg.product_status !== "active" ? <Tag tone="neutral">{t("state.productPaused")}</Tag>
            : <Tag tone="good">{t("state.selling")}</Tag>}
        </td>
        <td className="px-2 py-2.5">
          <div className="flex items-center justify-end gap-0.5 whitespace-nowrap">
            <Link href={`/seller/inventory/${pkg.variant_id}?restock=1`} className={cn("inline-flex h-7 items-center gap-1 rounded-lg border border-line-2 bg-raised px-2 text-[11.5px] font-medium text-fg hover:border-faint", inactive && "pointer-events-none")}>
              <Plus size={12} /> {t("table.restock")}
            </Link>
            <Link href={`/seller/inventory/${pkg.variant_id}`} className="inline-flex h-7 items-center gap-0.5 rounded-lg px-1.5 text-[11.5px] text-muted hover:bg-surface hover:text-fg">
              {t("table.open")} <ChevronRight size={12} />
            </Link>
          </div>
        </td>
      </tr>
    );
  };

  const renderGroup = (group: PackageGroup) => {
    const ids = group.packages.map((p) => p.variant_id);
    const state = checkState(ids, selected);
    const open = !collapsed.has(group.productId);
    return [
      <tr key={`p-${group.productId}`} className="bg-raised/60">
        <td className="px-3 py-2">
          <Checkbox state={state} onChange={(c) => onSelect(ids, c)} label={t("table.selectGroup", { name: group.productTitle })} />
        </td>
        <td colSpan={2} className="py-2 pl-1 pr-3">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={() => toggleGroup(group.productId)} aria-expanded={open} aria-label={open ? t("table.collapse") : t("table.expand")} className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface hover:text-fg">
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <ProductCover coverId={parseCoverId({ cover_id: group.coverId })} title={group.productTitle} className="h-6 w-6 shrink-0 rounded-md text-[10px]" />
            <Link href={`/seller/products/${group.productId}`} className="truncate text-[13px] font-semibold text-fg hover:text-iris" title={group.productTitle}>{group.productTitle}</Link>
            <span className="shrink-0 font-mono text-[11px] text-faint">#{group.productId}</span>
            {group.productStatus !== "active" && <Tag tone="neutral">{t("state.productPaused")}</Tag>}
            <span className="truncate text-[11.5px] text-faint">{categoryPath(group.packages[0])}</span>
          </div>
        </td>
        <td className="px-2 py-2 whitespace-nowrap">
          <span className="font-mono text-[12.5px] font-semibold tabular text-fg">{group.available.toLocaleString(locale)}</span>
          <span className="ml-1.5 text-[11px] text-faint">· {t("table.packagesCount", { count: group.packages.length })}</span>
        </td>
        <td className="px-2 py-2 text-right font-mono text-[12px] tabular text-muted">{group.sold30d.toLocaleString(locale)}</td>
        <td className={cn("px-2 py-2 text-right font-mono text-[12px] tabular", group.error > 0 ? "text-warn" : "text-faint")}>{group.error > 0 ? group.error : "—"}</td>
        <td colSpan={2} />
        <td className="px-2 py-2">
          <div className="flex justify-end">
            <Link href={`/seller/products/${group.productId}`} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] text-muted hover:bg-surface hover:text-fg whitespace-nowrap">
              <Edit2 size={12} /> {t("table.editProduct")}
            </Link>
          </div>
        </td>
      </tr>,
      ...(open ? group.packages.map((pkg) => renderPackage(pkg, true)) : []),
    ];
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] table-fixed border-collapse text-left">
        <thead>
          <tr className="border-b border-line bg-raised/20 text-[11.5px] font-semibold uppercase tracking-wider text-faint whitespace-nowrap">
            <th className="w-10 px-3 py-3">
              <Checkbox state={checkState(allIds, selected)} onChange={(c) => onSelect(allIds, c)} label={t("table.selectAll")} />
            </th>
            <SortHeader label={t("table.colPackage")} asc="title" desc="title" sort={sort} onSort={onSort} className="pl-1" />
            <th className="w-[88px] px-2 py-3 text-right">{t("table.colPrice")}</th>
            <SortHeader label={t("table.colAvailable")} asc="available_asc" desc="available_desc" sort={sort} onSort={onSort} className="w-[178px]" />
            <SortHeader label={t("table.colSold")} asc="sold_desc" desc="sold_desc" sort={sort} onSort={onSort} className="w-[92px] text-right" />
            <th className="w-[56px] px-2 py-3 text-right">{t("table.colError")}</th>
            <SortHeader label={t("table.colLastRestock")} asc="last_restock" desc="last_restock" sort={sort} onSort={onSort} className="w-[124px]" />
            <th className="w-[100px] px-2 py-3">{t("table.colStatus")}</th>
            <th className="w-[118px] px-2 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {groups ? groups.flatMap(renderGroup) : items.map((pkg) => renderPackage(pkg, false))}
        </tbody>
      </table>
    </div>
  );
}
