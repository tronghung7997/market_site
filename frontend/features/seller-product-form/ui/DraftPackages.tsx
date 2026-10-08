"use client";

import { useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { useVariantTerm } from "@/lib/variant-term";
import type { ProductLocale } from "@/lib/types";
import { Button, Input } from "@/components/ui";
import { ChevronDown, ChevronUp, Download, Plus, Upload, X } from "@/components/Icons";
import {
  downloadRestockTemplate,
  readStockFiles,
  removeStockSource,
  setStockSourceFormat,
  stockSourceFromPaste,
  FormatTextarea,
  StockFormatGroupCard,
  StockFormatToggle,
  StockSourceChips,
  stockUploadBatches,
  type StockFileReading,
  type StockSource,
} from "@/features/seller-inventory";
import { createNewProductPackageDraft, patchNewProductPackage, type NewProductPackageDraft } from "@/features/seller-workbench/logic";
import { SellerPriceInput, useSellerPriceCurrency } from "@/features/seller-workbench/SellerPriceInput";
import { MANUAL_STOCK_CEILING, parseManualStock } from "@/lib/stock";
import { LocaleTag } from "./BasicsFields";

/** Create-page variations: one compact row per variation with the stock box
 *  folded away — a seller can add prices now and restock later from the
 *  inventory console. Removing a row that already exists on the server only
 *  stops selling it (no delete anywhere). */
export function DraftPackages({
  packages, onChange, contentLocale, primaryLocale, deliveryMode, onRetireSaved, serviceType, stockHasFormat, onStockHasFormatChange,
}: {
  packages: NewProductPackageDraft[];
  onChange: Dispatch<SetStateAction<NewProductPackageDraft[]>>;
  contentLocale: ProductLocale;
  primaryLocale: ProductLocale;
  deliveryMode: "instant" | "manual";
  onRetireSaved?: (serverId: number) => Promise<void>;
  serviceType: string;
  /** The "line 1 is the format" box, shared by every package of the form. */
  stockHasFormat: boolean;
  onStockHasFormatChange: (next: boolean) => void;
}) {
  const t = useTranslations("sellerProductForm.variants");
  const term = useVariantTerm(serviceType);
  const ts = useTranslations("seller");
  const { currency } = useSellerPriceCurrency();
  const [openStock, setOpenStock] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<string | null>(null);
  const ti = useTranslations("sellerInventory");
  // Files being read, per package.
  const [reading, setReading] = useState<Record<string, StockFileReading[]>>({});
  const [readError, setReadError] = useState<string | null>(null);

  const update = (clientId: string, patch: Parameters<typeof patchNewProductPackage>[2]) => onChange((current) => patchNewProductPackage(current, clientId, patch));
  const toggleStock = (clientId: string) => setOpenStock((prev) => { const next = new Set(prev); if (next.has(clientId)) next.delete(clientId); else next.add(clientId); return next; });

  // Uploads become chips on the package (never textarea content: megabytes of
  // text there freeze typing — see StockSource).
  const addSource = (clientId: string, source: StockSource) => onChange((current) => {
    const pkg = current.find((item) => item.clientId === clientId);
    return pkg ? patchNewProductPackage(current, clientId, { stockSources: [...pkg.stockSources, source] }) : current;
  });
  const patchSources = (clientId: string, change: (sources: StockSource[]) => StockSource[]) => onChange((current) => {
    const pkg = current.find((item) => item.clientId === clientId);
    return pkg ? patchNewProductPackage(current, clientId, { stockSources: change(pkg.stockSources) }) : current;
  });
  const onFile = (clientId: string, event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    setReadError(null);
    void readStockFiles(files, {
      onReading: (entry, active) => setReading((prev) => ({
        ...prev,
        [clientId]: active ? [...(prev[clientId] ?? []), entry] : (prev[clientId] ?? []).filter((r) => r.id !== entry.id),
      })),
      onSource: (source) => addSource(clientId, source),
      onError: (name) => setReadError(ti("restock.readFailed", { name })),
    });
  };

  const remove = async (pkg: NewProductPackageDraft) => {
    if (packages.length <= 1) return;
    if (pkg.serverId && onRetireSaved) {
      setRemoving(pkg.clientId);
      try { await onRetireSaved(pkg.serverId); } catch { setRemoving(null); return; }
      setRemoving(null);
    }
    onChange((current) => (current.length <= 1 ? current : current.filter((item) => item.clientId !== pkg.clientId)));
  };

  return (
    <div className="space-y-2.5">
      <div className="hidden grid-cols-[minmax(0,1fr)_170px_150px_32px] gap-3 px-1 text-[11px] font-semibold uppercase tracking-wider text-faint sm:grid">
        <span>{t("nameCol", { ...term })}</span>
        <span>{t("priceCol", { currency })}</span>
        <span>{deliveryMode === "instant" ? t("stockCol") : t("slaCol")}</span>
        <span />
      </div>
      {packages.map((pkg, index) => {
        const batches = stockUploadBatches(pkg.stockSources, pkg.stockText, ti("restock.typedSource"), stockHasFormat);
        const pending = batches.reduce((sum, group) => sum + group.items.length, 0);
        const stockOpen = openStock.has(pkg.clientId);
        const total = pkg.committedStock + pending;
        return (
          <div key={pkg.clientId} className="rounded-xl border border-line bg-surface">
            <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_170px_150px_32px] sm:items-center">
              <div className="relative">
                <Input
                  id={index === 0 ? "product-variant-name" : undefined}
                  value={pkg.names[contentLocale]}
                  onChange={(e) => update(pkg.clientId, { names: { [contentLocale]: e.target.value } })}
                  placeholder={t("namePlaceholder")}
                  aria-label={t("nameCol", { ...term })}
                  maxLength={255}
                />
                {contentLocale !== primaryLocale && <span className="absolute right-2 top-1/2 -translate-y-1/2"><LocaleTag locale={contentLocale} /></span>}
              </div>
              <SellerPriceInput amountVnd={pkg.price} onAmountVndChange={(price) => update(pkg.clientId, { price })} />
              {deliveryMode === "instant" ? (
                <button type="button" onClick={() => toggleStock(pkg.clientId)} aria-expanded={stockOpen} className={cn("inline-flex h-9 items-center justify-between gap-2 rounded-lg border px-2.5 text-[12.5px]", stockOpen ? "border-iris text-fg" : "border-line-2 text-muted hover:border-faint hover:text-fg")}>
                  <span className={cn("font-mono font-semibold", total === 0 ? "text-bad" : "text-good")}>{total.toLocaleString()}</span>
                  <span className="min-w-0 truncate">{total === 0 ? t("addStock") : t("stockLines")}</span>
                  {stockOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={1} max={720} value={pkg.slaHours} aria-label={t("slaCol")} onChange={(e) => update(pkg.clientId, { slaHours: Math.min(720, Math.max(1, Number(e.target.value) || 24)) })} className="w-24" />
                  <span className="text-[12px] text-muted">{t("hours")}</span>
                </div>
              )}
              <button type="button" onClick={() => remove(pkg)} disabled={packages.length <= 1 || removing === pkg.clientId} aria-label={t("remove", { ...term })} title={t("remove", { ...term })} className="inline-flex h-8 w-8 items-center justify-center justify-self-end rounded-lg text-faint hover:bg-raised hover:text-fg disabled:opacity-30">
                <X size={14} />
              </button>
            </div>
            {deliveryMode === "manual" && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-3 py-2.5">
                <label htmlFor={`manual-stock-${pkg.clientId}`} className="text-[12px] font-medium text-muted">{t("manualStock")}</label>
                <Input
                  id={`manual-stock-${pkg.clientId}`} type="number" min={0} max={MANUAL_STOCK_CEILING} placeholder={t("manualStockNone")}
                  value={pkg.manualStock ?? ""}
                  onChange={(e) => update(pkg.clientId, { manualStock: parseManualStock(e.target.value) })}
                  className="w-32"
                />
                <span className="min-w-0 flex-1 text-[11.5px] text-faint">{t("manualStockHint")}</span>
              </div>
            )}
            {deliveryMode === "instant" && stockOpen && (
              <div className="space-y-2 border-t border-line bg-raised/30 p-3">
                <StockFormatToggle checked={stockHasFormat} onChange={onStockHasFormatChange} />
                <div className="flex flex-wrap items-center justify-end gap-2 text-[12px]">
                  <span className="flex items-center gap-3">
                    <button type="button" onClick={() => downloadRestockTemplate("txt", "sample_restock_template")} className="inline-flex items-center gap-1 text-iris hover:underline"><Download size={12} /> {ts("sampleFile")}</button>
                    <label className="inline-flex cursor-pointer items-center gap-1 text-iris hover:underline">
                      <Upload size={12} /> {ts("uploadFile")}
                      <Input type="file" accept=".txt,.csv" multiple onChange={(e) => onFile(pkg.clientId, e)} className="hidden" />
                    </label>
                  </span>
                </div>
                <StockSourceChips
                  sources={pkg.stockSources}
                  reading={reading[pkg.clientId] ?? []}
                  onRemove={(id) => patchSources(pkg.clientId, (sources) => removeStockSource(sources, id))}
                />
                {readError && <p role="alert" className="text-[11.5px] font-medium text-bad">{readError}</p>}
                <FormatTextarea
                  rows={pkg.stockSources.length > 0 ? 3 : 5}
                  value={pkg.stockText}
                  onChange={(e) => update(pkg.clientId, { stockText: e.target.value })}
                  onPaste={(event) => {
                    const source = stockSourceFromPaste(event, ti("restock.pastedSource"));
                    if (source) addSource(pkg.clientId, source);
                  }}
                  highlight={stockHasFormat}
                  placeholder={pkg.stockSources.length > 0 ? ti("restock.placeholderMore") : stockHasFormat ? ti("restock.placeholderFormat") : ti("restock.placeholder")}
                  aria-label={t("stockCol")}
                  className="font-mono text-xs leading-relaxed"
                />
                {batches.map((group) => (
                  <StockFormatGroupCard
                    key={group.key}
                    group={group}
                    name={batches.length > 1 || group.key !== "typed" ? group.name : undefined}
                    note={group.note ?? ""}
                    onFormatChange={group.sourceId === undefined ? undefined : (value) => patchSources(pkg.clientId, (sources) => setStockSourceFormat(sources, group.sourceId as number, value))}
                    onUseFormat={() => onStockHasFormatChange(true)}
                    onDisableFormat={() => onStockHasFormatChange(false)}
                  />
                ))}
                <div className="text-[11.5px] text-muted">
                  <span className={cn(pending > 0 && "font-semibold text-good")}>{ts("recognizedLines", { count: pending })}</span>
                  {pkg.committedStock > 0 && <span className="ml-1">· {t("alreadySaved", { count: pkg.committedStock })}</span>}
                  <span className="ml-1">· {t("dedupeNote")}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <Button type="button" size="sm" variant="secondary" onClick={() => onChange((current) => [...current, createNewProductPackageDraft()])}>
        <Plus size={13} /> {t("add", { ...term })}
      </Button>
    </div>
  );
}
