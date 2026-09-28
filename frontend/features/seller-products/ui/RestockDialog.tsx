"use client";

import { useLocale, useTranslations } from "next-intl";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useVariantTerm } from "@/lib/variant-term";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money";
import type { SellerProduct, SellerVariant } from "@/lib/types";
import {
  addResourcesInBatches,
  downloadRestockTemplate,
  restockableVariants,
  stockFormatGroups,
  FormatTextarea,
  StockFormatGroupCard,
  StockSourceChips,
  useStockSources,
  type RestockProgress,
} from "@/features/seller-inventory";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { Button, Input, Spinner, Tag } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Check, CheckCircle2, Download, Package, Plus, Upload } from "@/components/Icons";
import { useInvalidateSellerProducts } from "../useSellerProducts";

/** Quick restock from the products table: pick a package, paste/upload lines, add. */
export function RestockDialog({ product, onClose }: { product: SellerProduct | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(product)} onOpenChange={(open) => { if (!open) onClose(); }}>
      {product && <RestockForm key={product.id} product={product} onClose={onClose} />}
    </Dialog>
  );
}

function RestockForm({ product, onClose }: { product: SellerProduct; onClose: () => void }) {
  const t = useTranslations("seller");
  const locale = useLocale();
  const term = useVariantTerm(product.service_type);
  const { formatBrowseMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const invalidate = useInvalidateSellerProducts();
  const [variants, setVariants] = useState<SellerVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [loadingVariants, setLoadingVariants] = useState(true);
  const ti = useTranslations("sellerInventory");
  // Typed / small pasted lines; files and large pastes are chips (see StockSource).
  const [textData, setTextData] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [autoDedupe, setAutoDedupe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<RestockProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingVariants(true);
    api.sellerProduct(product.id)
      .then((detail) => {
        if (cancelled) return;
        // Seller detail always carries the exact count; the type is loose because
        // the same Variant shape serves the storefront, where it is omitted.
        const eligible = restockableVariants(detail.variants || []).map((v) => ({ ...v, stock_count: v.stock_count ?? 0 }));
        setVariants(eligible);
        if (eligible.length > 0) {
          setSelectedVariantId([...eligible].sort((a, b) => a.stock_count - b.stock_count)[0].id);
        }
      })
      .catch(() => { if (!cancelled) setError(t("variantsLoadFailed")); })
      .finally(() => { if (!cancelled) setLoadingVariants(false); });
    return () => { cancelled = true; };
  }, [product.id, t]);

  const stock = useStockSources({
    pastedName: ti("restock.pastedSource"),
    onReadError: (name) => setError(ti("restock.readFailed", { name })),
  });
  // Typing stays responsive: the parse follows the deferred value.
  const deferredText = useDeferredValue(textData);
  // Each file / paste is one batch: its first line is the format (see StockFormatGroupCard).
  const groups = useMemo(
    () => stockFormatGroups(stock.sources, deferredText, ti("restock.typedSource"))
      .map((group) => (autoDedupe ? { ...group, items: [...new Set(group.items)] } : group)),
    [stock.sources, deferredText, autoDedupe, ti],
  );
  const parsedItems = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const emptyGroup = groups.some((group) => group.items.length === 0);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    setError(null);
    void stock.addFiles(files);
  };

  const handleRestock = async () => {
    if (!selectedVariantId) { setError(t("variantRequired")); return; }
    if (parsedItems.length === 0 || emptyGroup) { setError(ti("format.empty")); return; }
    setSubmitting(true);
    setError(null);
    try {
      const uploads = groups.map((group) => ({
        items: group.items,
        format: group.format as string,
        loginNote: (notes[group.key] ?? group.note ?? "").trim() || null,
      }));
      const result = await addResourcesInBatches(selectedVariantId, uploads, { onProgress: setProgress });
      setSuccessCount(result.count);
      await invalidate();
      setTimeout(onClose, 1200);
    } catch (err: unknown) {
      // Batches before the failure are committed; refresh the stock counts.
      void invalidate();
      setError(apiErrorMessage(err, t("inventoryAddFailed")));
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  };

  return (
    <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-xl flex-col gap-0 rounded-2xl border-line bg-surface p-0 shadow-card-lg sm:w-full">
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-raised/50 p-4 pr-12">
        <ProductCover coverId={parseCoverId(product)} image={product.images?.cover} title={product.title} className="h-8 w-8 shrink-0 rounded-lg" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-iris-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-iris">{t("quickRestockTitle")}</span>
          </div>
          <DialogTitle className="truncate text-[13.5px] font-bold text-fg">{product.title}</DialogTitle>
          <DialogDescription className="sr-only">{t("pasteResourcesHint")}</DialogDescription>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {loadingVariants ? (
          <div className="py-8 text-center"><Spinner /></div>
        ) : variants.length === 0 ? (
          <div className="space-y-2 py-6 text-center text-xs text-muted">
            <Package size={28} className="mx-auto text-faint" />
            <p>{error ?? t("noVariantsForRestock", { ...term })}</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-semibold text-fg">{t("selectVariant", { ...term })} · {t("variantsAvailable", { count: variants.length, ...term })}</span>
                <span className="text-[11px] text-faint">{t("variantSelectionHint", { ...term })}</span>
              </div>
              <div role="radiogroup" className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto p-0.5 sm:grid-cols-2">
                {variants.map((v) => {
                  const isSelected = selectedVariantId === v.id;
                  const isOut = v.stock_count === 0;
                  const isLow = v.stock_count > 0 && v.stock_count <= 5;
                  const tone = isOut ? "bad" : isLow ? "warn" : "good";
                  const toneLabel = isOut
                    ? t("stockOutCount", { count: 0 })
                    : isLow ? t("stockLowCount", { count: v.stock_count }) : t("stockCountItems", { count: v.stock_count });
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelectedVariantId(v.id)}
                      className={cn(
                        "flex flex-col justify-between gap-1.5 rounded-xl border p-2.5 text-left text-xs transition-all",
                        isSelected ? "border-iris bg-iris-soft/40 shadow-xs ring-1 ring-iris" : "border-line bg-surface hover:border-line-2 hover:bg-raised/60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <span className={cn("line-clamp-2 text-[12.5px] font-semibold leading-snug", isSelected ? "text-iris-hi" : "text-fg")} title={v.name}>{v.name}</span>
                        {isSelected && <span className="shrink-0 text-iris"><Check size={14} /></span>}
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px]">
                        <span className="font-mono font-bold text-fg">{formatBrowseMoney(v.price)}</span>
                        <Tag tone={tone} className="text-[10px]">{toneLabel}</Tag>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 border-t border-line pt-3">
              <div className="flex flex-col justify-between gap-1 text-[12px] sm:flex-row sm:items-center">
                <label htmlFor="restock-data" className="font-semibold text-fg">{t("pasteResourcesHint")}</label>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => downloadRestockTemplate("txt", "sample_restock_template")} className="h-6 gap-1 px-1.5 text-[11px] text-iris">
                    <Download size={11} /> {t("sampleFile")}
                  </Button>
                  <label className="inline-flex cursor-pointer items-center gap-1 text-[11.5px] font-medium text-iris hover:underline">
                    <Upload size={12} /> {t("uploadFile")}
                    <Input type="file" accept=".txt,.csv" multiple onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
              </div>
              <p className="rounded-lg border border-line bg-raised/50 p-2 text-[11.5px] leading-relaxed text-muted">
                {ti("format.rule")} <code className="font-mono text-fg">UID|PASS|2FA|MAIL</code>
              </p>
              <StockSourceChips sources={stock.sources} reading={stock.reading} onRemove={stock.remove} onToggleHeader={stock.toggleHeader} disabled={submitting} />
              <FormatTextarea
                id="restock-data"
                rows={stock.sources.length > 0 ? 3 : 5}
                value={textData}
                onChange={(e) => setTextData(e.target.value)}
                onPaste={(event) => { stock.handlePaste(event); }}
                placeholder={stock.sources.length > 0 ? ti("restock.placeholderMore") : ti("restock.placeholderFormat")}
                className="font-mono text-xs leading-relaxed"
              />
              <div className="flex items-center justify-between text-[11.5px] text-muted">
                <span className={cn(parsedItems.length > 0 && "font-semibold text-good")}>
                  {t("recognizedLines", { count: parsedItems.length })}
                </span>
                <label className="flex cursor-pointer items-center gap-1.5 text-muted hover:text-fg">
                  <input type="checkbox" checked={autoDedupe} onChange={(e) => setAutoDedupe(e.target.checked)} className="h-3.5 w-3.5 rounded border-line-2 text-iris" />
                  <span>{t("skipDuplicates")}</span>
                </label>
              </div>
              {groups.map((group) => (
                <StockFormatGroupCard
                  key={group.key}
                  group={group}
                  name={groups.length > 1 || group.key !== "typed" ? group.name : undefined}
                  note={notes[group.key] ?? group.note ?? ""}
                  onNoteChange={(value) => setNotes((prev) => ({ ...prev, [group.key]: value }))}
                  disabled={submitting}
                />
              ))}
            </div>

            {error && <div role="alert" className="rounded-lg border border-bad/20 bg-bad-soft p-2.5 text-xs font-medium text-bad">{error}</div>}
            {successCount !== null && (
              <div role="status" className="flex items-center gap-2 rounded-lg border border-good/20 bg-good-soft p-2.5 text-xs font-medium text-good">
                <CheckCircle2 size={14} /> <span>{t("restockSuccess", { count: successCount })}</span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-raised/50 p-3">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={submitting}>{t("cancel")}</Button>
        <Button size="sm" onClick={handleRestock} loading={submitting} disabled={parsedItems.length === 0 || emptyGroup || !selectedVariantId || variants.length === 0 || stock.reading.length > 0} className="gap-1.5">
          {submitting ? <span className="font-mono tabular">{progress && progress.total > 0 ? t("inventoryAddingProgress", { done: progress.done.toLocaleString(locale), total: progress.total.toLocaleString(locale) }) : t("inventoryAdding")}</span> : <><Plus size={14} /><span>{t("confirmRestock")}</span></>}
        </Button>
      </div>
    </DialogContent>
  );
}
