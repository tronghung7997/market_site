"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import type { SellerProduct, SellerProductSort } from "@/lib/types";
import { inventoryStockState, isInventoryManagedProduct, nextSellerProductStatus } from "@/features/seller-inventory";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { Button, Tag } from "@/components/ui";
import { Bolt, ChevronDown, ChevronRight, ChevronUp, Edit2, Eye, Package, Plus, Star } from "@/components/Icons";

function SortHeader({
  label, asc, desc, sort, onSort, className,
}: {
  label: string; asc: SellerProductSort; desc: SellerProductSort; sort: SellerProductSort;
  onSort: (next: SellerProductSort) => void; className?: string;
}) {
  const active = sort === asc || sort === desc;
  const Icon = sort === asc ? ChevronUp : ChevronDown;
  return (
    <th className={cn("px-3 py-3", className)} aria-sort={sort === asc ? "ascending" : sort === desc ? "descending" : "none"}>
      <button type="button" onClick={() => onSort(sort === desc ? asc : desc)} className={cn("inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-fg", active && "text-fg")}>
        {label} <Icon size={12} className={cn(!active && "opacity-40")} />
      </button>
    </th>
  );
}

export function SellerProductsTable({
  products,
  lowStockThreshold,
  sort,
  onSort,
  selected,
  onToggleSelect,
  onToggleAll,
  togglingId,
  onToggleStatus,
  onRestock,
}: {
  products: SellerProduct[];
  lowStockThreshold: number;
  sort: SellerProductSort;
  onSort: (next: SellerProductSort) => void;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onToggleAll: (ids: number[], checked: boolean) => void;
  togglingId: number | null;
  onToggleStatus: (product: SellerProduct) => void;
  onRestock: (product: SellerProduct) => void;
}) {
  const t = useTranslations("seller");
  const tp = useTranslations("sellerProducts");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const pageIds = products.map((p) => p.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someSelected = pageIds.some((id) => selected.has(id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line bg-raised/20 text-[11.5px] font-semibold uppercase tracking-wider text-faint">
            <th className="w-10 px-3 py-3">
              <input
                type="checkbox"
                aria-label={tp("selectAll")}
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected; }}
                onChange={(e) => onToggleAll(pageIds, e.target.checked)}
                className="h-3.5 w-3.5 rounded border-line-2 text-iris"
              />
            </th>
            <SortHeader label={t("product")} asc="title" desc="title" sort={sort} onSort={onSort} className="pl-1" />
            <th className="px-3 py-3 whitespace-nowrap">{t("category")}</th>
            <SortHeader label={tp("colPrice")} asc="price_asc" desc="price_desc" sort={sort} onSort={onSort} className="text-right" />
            <SortHeader label={t("stock")} asc="stock_asc" desc="stock_desc" sort={sort} onSort={onSort} className="min-w-[150px] whitespace-nowrap" />
            <SortHeader label={tp("colSold")} asc="sold_desc" desc="sold_desc" sort={sort} onSort={onSort} className="text-right whitespace-nowrap" />
            <th className="w-[116px] px-3 py-3 text-center whitespace-nowrap">{t("toggleStatus")}</th>
            <th className="w-20 px-3 py-3 text-center whitespace-nowrap">{t("actions")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line text-[13px]">
          {products.map((p) => {
            const stockState = inventoryStockState(p, lowStockThreshold);
            const managed = isInventoryManagedProduct(p);
            const stockTone = stockState === "not_managed" ? "iris" : stockState === "out" ? "bad" : stockState === "low" ? "warn" : "good";
            const stockLabel = stockState === "not_managed"
              ? (p.pricing_strategy ?? "fixed").toUpperCase()
              : stockState === "out" ? t("outOfStockLabel") : stockState === "low" ? t("lowStockLabel") : t("inStockLabel");
            const isActive = p.status === "active";
            const nextStatus = nextSellerProductStatus(p.status);
            const isSelected = selected.has(p.id);
            return (
              <tr key={p.id} className={cn("transition-colors hover:bg-raised/50", p.status === "paused" && "opacity-75", isSelected && "bg-iris-soft/20")}>
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={tp("selectRow", { title: p.title })}
                    checked={isSelected}
                    onChange={() => onToggleSelect(p.id)}
                    className="h-3.5 w-3.5 rounded border-line-2 text-iris"
                  />
                </td>
                <td className="py-3 pl-1 pr-3">
                  <div className="flex items-center gap-3">
                    <ProductCover coverId={parseCoverId(p)} title={p.title} className="h-9 w-9 shrink-0 rounded-lg" />
                    <div className="min-w-0">
                      <Link href={`/seller/products/${p.id}`} className="block max-w-[260px] truncate text-[13.5px] font-medium text-fg transition-colors hover:text-iris" title={p.title}>
                        {p.title}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
                        {p.service_type && (
                          <span className="inline-flex items-center gap-1 rounded bg-iris-soft px-1.5 py-0.5 text-[10.5px] font-medium text-iris-hi">
                            <Bolt size={11} /> {p.service_type}
                          </span>
                        )}
                        <span className="font-mono">#{p.id}</span>
                        {managed && (
                          <Link href={`/seller/inventory?product=${p.id}`} className="inline-flex items-center gap-0.5 text-faint hover:text-iris" title={t("productsPageInventoryTitle")}>
                            {p.variant_count} {t("variants").toLowerCase()} <ChevronRight size={11} />
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-muted whitespace-nowrap">{p.category_name ?? "—"}</td>
                <td className="px-3 py-3 text-right font-mono text-[12.5px] tabular whitespace-nowrap">
                  {p.price_min === null || p.price_max === null ? (
                    <span className="text-faint">—</span>
                  ) : p.price_min === p.price_max ? (
                    formatBrowseMoney(p.price_min, { locale })
                  ) : (
                    <span>{formatBrowseMoney(p.price_min, { locale })} <span className="text-faint">–</span> {formatBrowseMoney(p.price_max, { locale })}</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="font-mono font-bold tabular text-fg">{managed ? p.total_stock.toLocaleString(locale) : "—"}</span>
                    <Tag tone={stockTone}>{stockLabel}</Tag>
                  </div>
                  {managed && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onRestock(p)}
                      className={cn(
                        "mt-1 h-6 gap-1 px-1.5 text-[11px] font-semibold",
                        stockState === "out" ? "text-bad hover:bg-bad-soft" : stockState === "low" ? "text-warn hover:bg-warn-soft" : "text-iris hover:bg-iris-soft",
                      )}
                    >
                      <Plus size={11} /> {t("addStock")}
                    </Button>
                  )}
                </td>
                <td className="px-3 py-3 text-right font-mono text-[12.5px] tabular whitespace-nowrap">
                  <div className="font-semibold text-fg">{p.sold_count.toLocaleString(locale)}</div>
                  <div className="text-[11px] text-faint">
                    {p.rating_avg === null || p.rating_count === 0 ? tp("noRating") : (
                      <span className="inline-flex items-center gap-0.5"><Star size={11} className="text-warn" /> {p.rating_avg.toFixed(1)} ({p.rating_count})</span>
                    )}
                  </div>
                </td>
                <td className="w-[116px] px-3 py-3 text-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={togglingId === p.id || nextStatus === null}
                    onClick={() => onToggleStatus(p)}
                    title={nextStatus === null ? t("suspendedStatus") : isActive ? t("pause") : t("activate")}
                    aria-pressed={isActive}
                    className={cn(
                      "h-7 rounded-full border px-2.5 text-[11.5px] font-semibold transition-all",
                      isActive ? "border-good/30 bg-good-soft text-good hover:bg-good-soft/80" : "border-line-2 bg-raised text-faint hover:bg-surface hover:text-fg",
                    )}
                  >
                    <span className={cn("mr-1.5 h-1.5 w-1.5 rounded-full", isActive ? "bg-good" : "bg-faint")} />
                    {isActive ? t("activeStatus") : p.status === "suspended" ? t("suspendedStatus") : p.status === "draft" ? t("draftStatus") : t("pausedStatus")}
                  </Button>
                </td>
                <td className="w-20 px-3 py-3">
                  <div className="flex items-center justify-center gap-1">
                    <Link href={`/products/${p.id}`} title={t("viewPurchasePage")} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-fg">
                      <Eye size={14} />
                    </Link>
                    <Link href={`/seller/products/${p.id}`} title={t("edit")} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-iris hover:bg-iris-soft hover:text-iris-hi">
                      <Edit2 size={14} />
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {products.length === 0 && (
        <div className="p-8 text-center">
          <Package size={32} className="mx-auto mb-2 text-faint" />
          <p className="text-[13.5px] font-medium text-fg">{t("noMatchingProducts")}</p>
        </div>
      )}
    </div>
  );
}
