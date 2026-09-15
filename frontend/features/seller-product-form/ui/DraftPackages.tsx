"use client";

import { useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { ProductLocale } from "@/lib/types";
import { Button, Input, Textarea } from "@/components/ui";
import { ChevronDown, ChevronUp, Download, Plus, Upload, X } from "@/components/Icons";
import { downloadRestockTemplate, mergeRestockText, parseResourceItems, parseRestockFileContent } from "@/features/seller-inventory";
import { createNewProductPackageDraft, patchNewProductPackage, type NewProductPackageDraft } from "@/features/seller-workbench/logic";
import { SellerPriceInput, useSellerPriceCurrency } from "@/features/seller-workbench/SellerPriceInput";
import { LocaleTag } from "./BasicsFields";

/** Create-page variations: one compact row per variation with the stock box
 *  folded away — a seller can add prices now and restock later from the
 *  inventory console. Removing a row that already exists on the server only
 *  stops selling it (no delete anywhere). */
export function DraftPackages({
  packages, onChange, contentLocale, primaryLocale, deliveryMode, onRetireSaved,
}: {
  packages: NewProductPackageDraft[];
  onChange: Dispatch<SetStateAction<NewProductPackageDraft[]>>;
  contentLocale: ProductLocale;
  primaryLocale: ProductLocale;
  deliveryMode: "instant" | "manual";
  onRetireSaved?: (serverId: number) => Promise<void>;
}) {
  const t = useTranslations("sellerProductForm.variants");
  const ts = useTranslations("seller");
  const { currency } = useSellerPriceCurrency();
  const [openStock, setOpenStock] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<string | null>(null);

  const update = (clientId: string, patch: Parameters<typeof patchNewProductPackage>[2]) => onChange((current) => patchNewProductPackage(current, clientId, patch));
  const toggleStock = (clientId: string) => setOpenStock((prev) => { const next = new Set(prev); if (next.has(clientId)) next.delete(clientId); else next.add(clientId); return next; });

  const onFile = (clientId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const raw = loadEvent.target?.result as string;
      if (!raw) return;
      const parsed = parseRestockFileContent(file.name, raw);
      onChange((current) => {
        const pkg = current.find((item) => item.clientId === clientId);
        return pkg ? patchNewProductPackage(current, clientId, { uploadedFileName: file.name, stockText: mergeRestockText(pkg.stockText, parsed) }) : current;
      });
    };
    reader.readAsText(file);
    event.target.value = "";
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
        <span>{t("nameCol")}</span>
        <span>{t("priceCol", { currency })}</span>
        <span>{deliveryMode === "instant" ? t("stockCol") : t("slaCol")}</span>
        <span />
      </div>
      {packages.map((pkg, index) => {
        const pending = parseResourceItems(pkg.stockText, true).length;
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
                  aria-label={t("nameCol")}
                  maxLength={255}
                />
                {contentLocale !== primaryLocale && <span className="absolute right-2 top-1/2 -translate-y-1/2"><LocaleTag locale={contentLocale} /></span>}
              </div>
              <SellerPriceInput amountVnd={pkg.price} onAmountVndChange={(price) => update(pkg.clientId, { price })} />
              {deliveryMode === "instant" ? (
                <button type="button" onClick={() => toggleStock(pkg.clientId)} aria-expanded={stockOpen} className={cn("inline-flex h-9 items-center justify-between gap-2 rounded-lg border px-2.5 text-[12.5px]", stockOpen ? "border-iris text-fg" : "border-line-2 text-muted hover:border-faint hover:text-fg")}>
                  <span className={cn("font-mono font-semibold", total === 0 ? "text-bad" : "text-good")}>{total.toLocaleString()}</span>
                  <span className="truncate">{total === 0 ? t("addStock") : t("stockLines")}</span>
                  {stockOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={1} max={720} value={pkg.slaHours} aria-label={t("slaCol")} onChange={(e) => update(pkg.clientId, { slaHours: Math.min(720, Math.max(1, Number(e.target.value) || 24)) })} className="w-24" />
                  <span className="text-[12px] text-muted">{t("hours")}</span>
                </div>
              )}
              <button type="button" onClick={() => remove(pkg)} disabled={packages.length <= 1 || removing === pkg.clientId} aria-label={t("remove")} title={t("remove")} className="inline-flex h-8 w-8 items-center justify-center justify-self-end rounded-lg text-faint hover:bg-raised hover:text-fg disabled:opacity-30">
                <X size={14} />
              </button>
            </div>
            {deliveryMode === "instant" && stockOpen && (
              <div className="space-y-2 border-t border-line bg-raised/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                  <span className="text-muted">{ts("restockRuleTitle")} {ts("restockRuleLead")} <code className="font-mono text-fg">user|pass|2fa</code> {ts("restockRuleOr")} <code className="font-mono text-fg">license_key</code>{ts("restockRuleEnd")}</span>
                  <span className="flex items-center gap-3">
                    <button type="button" onClick={() => downloadRestockTemplate("txt", "sample_restock_template")} className="inline-flex items-center gap-1 text-iris hover:underline"><Download size={12} /> {ts("sampleFile")}</button>
                    <label className="inline-flex cursor-pointer items-center gap-1 text-iris hover:underline">
                      <Upload size={12} /> {ts("uploadFile")}
                      <Input type="file" accept=".txt,.csv" onChange={(e) => onFile(pkg.clientId, e)} className="hidden" />
                    </label>
                  </span>
                </div>
                <Textarea rows={5} value={pkg.stockText} onChange={(e) => update(pkg.clientId, { stockText: e.target.value, uploadedFileName: null })} placeholder={t("stockPlaceholder")} aria-label={t("stockCol")} className="font-mono text-xs leading-relaxed" />
                <div className="text-[11.5px] text-muted">
                  <span className={cn(pending > 0 && "font-semibold text-good")}>{ts("recognizedLines", { count: pending })}</span>
                  {pkg.uploadedFileName && <span className="ml-1 font-mono">({pkg.uploadedFileName})</span>}
                  {pkg.committedStock > 0 && <span className="ml-1">· {t("alreadySaved", { count: pkg.committedStock })}</span>}
                  <span className="ml-1">· {t("dedupeNote")}</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <Button type="button" size="sm" variant="secondary" onClick={() => onChange((current) => [...current, createNewProductPackageDraft()])}>
        <Plus size={13} /> {t("add")}
      </Button>
    </div>
  );
}
