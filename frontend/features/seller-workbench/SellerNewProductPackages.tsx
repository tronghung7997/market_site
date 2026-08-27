"use client";

import { useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { CheckCircle2, Download, Plus, Trash, Upload } from "@/components/Icons";
import { cn } from "@/lib/cn";
import {
  downloadRestockTemplate,
  mergeRestockText,
  parseResourceItems,
  parseRestockFileContent,
} from "@/features/seller-inventory";
import type { ProductLocale } from "@/lib/types";
import {
  createNewProductPackageDraft,
  patchNewProductPackage,
  type NewProductPackageDraft,
} from "./logic";
import { SellerPriceInput } from "./SellerPriceInput";

export function SellerNewProductPackages({
  packages,
  contentLocale,
  deliveryMode,
  priceCurrency,
  onChange,
  onDeleteSavedVariant,
}: {
  packages: NewProductPackageDraft[];
  contentLocale: ProductLocale;
  deliveryMode: "instant" | "manual";
  priceCurrency: string;
  onChange: Dispatch<SetStateAction<NewProductPackageDraft[]>>;
  onDeleteSavedVariant?: (serverId: number) => Promise<void>;
}) {
  const t = useTranslations("seller.newProductFlow");
  const ts = useTranslations("seller");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const addPackageLabel = t("addPackage");
  const removePackageLabel = t("removePackage");
  const packagesHint = t("packagesHint");
  const packageIndexLabel = (n: number) => t("packageIndex", { n });
  const alreadySavedStock = (count: number) => t("alreadySavedStock", { count });

  const update = (clientId: string, patch: Parameters<typeof patchNewProductPackage>[2]) => {
    onChange((current) => patchNewProductPackage(current, clientId, patch));
  };

  const handleStockFileUpload = (clientId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const raw = loadEvent.target?.result as string;
      if (!raw) return;
      const parsed = parseRestockFileContent(file.name, raw);
      onChange((current) => {
        const pkg = current.find((item) => item.clientId === clientId);
        if (!pkg) return current;
        return patchNewProductPackage(current, clientId, {
          uploadedFileName: file.name,
          stockText: mergeRestockText(pkg.stockText, parsed),
        });
      });
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted">{t("step3")}</div>
          <h2 className="mt-1 text-[14px] font-bold text-fg">{t("fixedSetup")}</h2>
          <p className="mt-1 text-[12px] text-muted">{packagesHint}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => onChange((current) => [...current, createNewProductPackageDraft()])}
        >
          <Plus size={13} /> {addPackageLabel}
        </Button>
      </div>

      <div className="space-y-3">
        {packages.map((pkg, index) => {
          const pendingStock = parseResourceItems(pkg.stockText, pkg.autoDedupe);
          return (
            <div key={pkg.clientId} className="space-y-3 rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-fg">{packageIndexLabel(index + 1)}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={packages.length <= 1 || removingId === pkg.clientId}
                  onClick={async () => {
                    if (packages.length <= 1) return;
                    if (pkg.serverId && onDeleteSavedVariant) {
                      setRemovingId(pkg.clientId);
                      try {
                        await onDeleteSavedVariant(pkg.serverId);
                      } catch {
                        setRemovingId(null);
                        return;
                      }
                      setRemovingId(null);
                    }
                    onChange((current) => (
                      current.length <= 1 ? current : current.filter((item) => item.clientId !== pkg.clientId)
                    ));
                  }}
                  className="h-7 px-2 text-bad hover:bg-bad-soft/50 disabled:text-faint"
                  aria-label={removePackageLabel}
                >
                  <Trash size={13} />
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("variantName", { language: contentLocale.toUpperCase() })}>
                  <Input
                    value={pkg.names[contentLocale]}
                    onChange={(event) => update(pkg.clientId, { names: { [contentLocale]: event.target.value } })}
                    placeholder={t("variantNamePlaceholder")}
                  />
                </Field>
                <Field label={t("price", { currency: priceCurrency })}>
                  <SellerPriceInput
                    amountVnd={pkg.price}
                    onAmountVndChange={(price) => update(pkg.clientId, { price })}
                  />
                </Field>
              </div>

              {deliveryMode === "manual" ? (
                <Field label={t("slaHours")}>
                  <Input
                    type="number"
                    min={1}
                    max={720}
                    value={pkg.slaHours}
                    onChange={(event) => update(pkg.clientId, {
                      slaHours: Math.min(720, Math.max(1, Number(event.target.value) || 24)),
                    })}
                  />
                </Field>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-[12.5px] font-medium text-fg">{t("initialStock")}</span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => downloadRestockTemplate("txt", "sample_restock_template")}
                        className="h-6 px-1.5 text-[11px] text-iris gap-1"
                      >
                        <Download size={11} />
                        <span>{ts("sampleFile")}</span>
                      </Button>
                      <label className="inline-flex cursor-pointer items-center gap-1 text-[11.5px] font-medium text-iris hover:underline">
                        <Upload size={12} />
                        <span>{ts("uploadFile")}</span>
                        <Input
                          type="file"
                          accept=".txt,.csv"
                          onChange={(event) => handleStockFileUpload(pkg.clientId, event)}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="rounded-lg border border-line bg-raised/50 p-2 text-[11.5px] text-muted">
                    {ts("restockRuleTitle")} {ts("restockRuleLead")} <code className="font-mono text-fg">user|pass|2fa</code> {ts("restockRuleOr")} <code className="font-mono text-fg">license_key</code>{ts("restockRuleEnd")}
                  </div>
                  <Textarea
                    rows={4}
                    aria-label={`${t("initialStock")} ${packageIndexLabel(index + 1)}`}
                    value={pkg.stockText}
                    onChange={(event) => update(pkg.clientId, {
                      stockText: event.target.value,
                      uploadedFileName: null,
                    })}
                    placeholder={t("stockPlaceholder")}
                    className="font-mono text-xs leading-relaxed"
                  />
                  <div className="flex flex-col gap-2 text-[11.5px] text-muted sm:flex-row sm:items-center sm:justify-between">
                    <span className={cn(pendingStock.length > 0 && "font-semibold text-good")}>
                      {ts("recognizedLines", { count: pendingStock.length })}
                      {pkg.uploadedFileName && (
                        <span className="ml-1 font-mono font-normal text-muted">({pkg.uploadedFileName})</span>
                      )}
                      {pkg.committedStock > 0 && (
                        <span className="ml-1 font-normal text-muted">· {alreadySavedStock(pkg.committedStock)}</span>
                      )}
                    </span>
                    <label className="flex cursor-pointer items-center gap-1.5 text-muted hover:text-fg">
                      <Input
                        type="checkbox"
                        checked={pkg.autoDedupe}
                        onChange={(event) => update(pkg.clientId, { autoDedupe: event.target.checked })}
                        className="h-3.5 w-3.5 rounded border-line-2 p-0 text-iris focus:ring-0"
                      />
                      <span>{ts("skipDuplicates")}</span>
                    </label>
                  </div>
                  {pendingStock.length > 0 && (
                    <div className="space-y-1 rounded-lg border border-good/20 bg-good-soft/70 p-2 text-[11.5px] text-good">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 size={13} />
                        <span>
                          {ts("restockReady", { count: pendingStock.length })}
                          {pkg.uploadedFileName && <span> {ts("fromFile", { name: pkg.uploadedFileName })}</span>}
                        </span>
                      </div>
                      <div className="truncate rounded border border-line bg-surface/60 px-2 py-0.5 font-mono text-[11px] text-faint">
                        {ts("firstLineSample", { value: pendingStock[0] })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
