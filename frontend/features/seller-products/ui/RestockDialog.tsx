"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useVariantTerm } from "@/lib/variant-term";
import { cn } from "@/lib/cn";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money";
import type { SellerProduct, SellerVariant } from "@/lib/types";
import {
  addResourcesInBatches,
  downloadRestockTemplate,
  mergeRestockText,
  parseResourceItems,
  parseRestockFileContent,
  restockableVariants,
} from "@/features/seller-inventory";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { Button, Input, Spinner, Tag, Textarea } from "@/components/ui";
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
  const term = useVariantTerm(product.service_type);
  const { formatBrowseMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const invalidate = useInvalidateSellerProducts();
  const [variants, setVariants] = useState<SellerVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [loadingVariants, setLoadingVariants] = useState(true);
  const [textData, setTextData] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [autoDedupe, setAutoDedupe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
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

  const parsedItems = useMemo(() => parseResourceItems(textData, autoDedupe), [textData, autoDedupe]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const raw = event.target?.result as string;
      if (!raw) return;
      setTextData((prev) => mergeRestockText(prev, parseRestockFileContent(file.name, raw)));
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleRestock = async () => {
    if (!selectedVariantId) { setError(t("variantRequired")); return; }
    if (parsedItems.length === 0) { setError(t("resourcesRequired")); return; }
    setSubmitting(true);
    setError(null);
    try {
      const result = await addResourcesInBatches(selectedVariantId, parsedItems);
      setSuccessCount(result.count);
      await invalidate();
      setTimeout(onClose, 1200);
    } catch (err: unknown) {
      // Batches before the failure are committed; refresh the stock counts.
      void invalidate();
      setError(apiErrorMessage(err, t("inventoryAddFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-xl flex-col gap-0 rounded-2xl border-line bg-surface p-0 shadow-card-lg sm:w-full">
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-raised/50 p-4 pr-12">
        <ProductCover coverId={parseCoverId(product)} title={product.title} className="h-8 w-8 shrink-0 rounded-lg" />
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
                    <Input type="file" accept=".txt,.csv" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
              </div>
              <p className="rounded-lg border border-line bg-raised/50 p-2 text-[11.5px] text-muted">
                <strong>{t("restockRuleTitle")}</strong> {t("restockRuleLead")} <code className="font-mono text-fg">user|pass|2fa</code> {t("restockRuleOr")} <code className="font-mono text-fg">license_key</code>{t("restockRuleEnd")}
              </p>
              <Textarea
                id="restock-data"
                rows={5}
                value={textData}
                onChange={(e) => { setTextData(e.target.value); if (uploadedFileName) setUploadedFileName(null); }}
                placeholder={"uid1|pass1|cookie1\nuid2|pass2|cookie2\nkey_token_example_03"}
                className="font-mono text-xs leading-relaxed"
              />
              <div className="flex items-center justify-between text-[11.5px] text-muted">
                <span className={cn(parsedItems.length > 0 && "font-semibold text-good")}>
                  {t("recognizedLines", { count: parsedItems.length })}
                  {uploadedFileName && <span className="ml-1 font-mono font-normal text-muted">({uploadedFileName})</span>}
                </span>
                <label className="flex cursor-pointer items-center gap-1.5 text-muted hover:text-fg">
                  <input type="checkbox" checked={autoDedupe} onChange={(e) => setAutoDedupe(e.target.checked)} className="h-3.5 w-3.5 rounded border-line-2 text-iris" />
                  <span>{t("skipDuplicates")}</span>
                </label>
              </div>
              {parsedItems.length > 0 && (
                <div className="space-y-1 rounded-lg border border-good/20 bg-good-soft/70 p-2 text-[11.5px] text-good">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 size={13} />
                    <span>{t("restockReady", { count: parsedItems.length })}{uploadedFileName && <span> {t("fromFile", { name: uploadedFileName })}</span>}</span>
                  </div>
                  <div className="truncate rounded border border-line bg-surface/60 px-2 py-0.5 font-mono text-[11px] text-faint">
                    {t("firstLineSample", { value: parsedItems[0] })}
                  </div>
                </div>
              )}
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
        <Button size="sm" onClick={handleRestock} disabled={submitting || parsedItems.length === 0 || !selectedVariantId || variants.length === 0} className="gap-1.5">
          {submitting ? <span>{t("inventoryAdding")}</span> : <><Plus size={14} /><span>{t("confirmRestock")}</span></>}
        </Button>
      </div>
    </DialogContent>
  );
}
