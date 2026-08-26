"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { useMoney } from "@/lib/money";
import { Button, Tag } from "@/components/ui";
import { ProductCover } from "@/components/products/ProductCover";
import { type WorkbenchVariant } from "./index.ts";

export function SellerOrderPanelSimulation({
  title,
  categoryName,
  coverId,
  escrowDays,
  variants,
}: {
  title: string;
  categoryName?: string;
  coverId?: string | null;
  escrowDays: number;
  variants: WorkbenchVariant[];
}) {
  const locale = useLocale() as "en" | "vi";
  const t = useTranslations("seller.workbench");
  const tp = useTranslations("products");
  const { formatCheckoutMoney } = useMoney();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [qty, setQty] = useState(1);

  const activeVariants = variants.filter((variant) => variant.is_active !== false);
  const selected = activeVariants[selectedIdx] ?? activeVariants[0] ?? null;
  const identity = (
    <div className="flex items-start gap-3">
      <ProductCover coverId={coverId} title={title || t("productFallback")} className="h-11 w-11" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <Tag tone="neutral">{categoryName || t("categoryFallback")}</Tag>
          <span className="text-[12px] text-faint">• {t("yourShop")}</span>
        </div>
        <h3 className="break-words font-serif text-[16px] font-bold leading-snug text-fg">
          {title.trim() || t("unnamedProduct")}
        </h3>
      </div>
    </div>
  );

  if (!selected) {
    return (
      <div className="space-y-4 rounded-xl border border-line bg-card p-5 shadow-card">
        {identity}
        <div className="space-y-3 rounded-xl border border-dashed border-line bg-surface/50 p-6 text-center">
          <p className="text-[12px] text-muted">{t("noPackagesDescription")}</p>
          <div className="w-full cursor-not-allowed rounded-lg border border-line bg-surface py-3 text-center text-[12px] font-semibold text-faint">
            {t("cannotBuyNoPackage")}
          </div>
        </div>
        <EscrowNote days={escrowDays} />
      </div>
    );
  }

  const instant = selected.delivery_mode === "instant";
  const outOfStock = instant && selected.stock_count <= 0;
  const contact = selected.price === 0;
  const maxQty = instant ? Math.max(1, selected.stock_count) : 999;
  const effectiveQty = Math.min(Math.max(1, qty), maxQty);

  return (
    <div className="space-y-4 rounded-xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-2 border-b border-line pb-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted">{tp("orderPanel")}</span>
          <h4 className="text-[13px] font-semibold text-fg">{t("customerPreview")}</h4>
        </div>
        <Tag tone={instant ? "good" : "warn"}>
          {instant ? tp("instantDelivery") : tp("deliverInHours", { hours: selected.sla_hours || 24 })}
        </Tag>
      </div>

      {identity}

      <fieldset className="space-y-2">
        <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
          {tp("choosePackage", { count: activeVariants.length })}
        </legend>
        {activeVariants.map((variant, index) => {
          const active = index === selectedIdx;
          const variantOutOfStock = variant.delivery_mode === "instant" && variant.stock_count <= 0;
          return (
            <Button
              type="button"
              variant="ghost"
              role="radio"
              aria-checked={active}
              disabled={variantOutOfStock}
              key={`${variant.name}-${index}`}
              onClick={() => setSelectedIdx(index)}
              className={cn(
                "!h-auto !whitespace-normal flex w-full items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left",
                active ? "border-iris bg-iris-soft/40 ring-1 ring-iris" : "border-line bg-surface hover:border-line-2",
                variantOutOfStock && "cursor-not-allowed opacity-50",
              )}
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{variant.name}</span>
                <span className={cn("mt-1 block text-[11px]", variantOutOfStock ? "text-bad" : variant.delivery_mode === "instant" ? "text-good" : "text-warn")}>
                  {variantOutOfStock
                    ? tp("outOfStock")
                    : variant.delivery_mode === "instant"
                      ? t("stockAvailable", { count: variant.stock_count })
                      : tp("deliverInHours", { hours: variant.sla_hours || 24 })}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums">
                {variant.price > 0 ? formatCheckoutMoney(variant.price, { locale }) : tp("contact")}
              </span>
            </Button>
          );
        })}
      </fieldset>

      {contact ? (
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-[12px] text-muted">{tp("contactBlurb")}</p>
          <div className="w-full rounded-lg bg-fg py-3 text-center text-[12px] font-semibold text-surface">{tp("contactSeller")}</div>
        </div>
      ) : outOfStock ? (
        <div className="space-y-2 border-t border-line pt-3 text-center">
          <div className="rounded-lg border border-bad/25 bg-surface py-3 text-[12px] font-semibold text-bad">{tp("outOfStock")}</div>
          <p className="text-[11px] text-bad">{t("outOfStockSellerHint")}</p>
        </div>
      ) : (
        <div className="space-y-3 border-t border-line pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted">{tp("quantity")}</span>
            <div className="flex items-center overflow-hidden rounded-lg border border-line bg-surface">
              <Button type="button" variant="ghost" size="sm" aria-label={tp("decreaseQty")} onClick={() => setQty((value) => Math.max(1, value - 1))} className="!h-8 !w-8 !p-0 text-muted hover:bg-raised hover:text-fg">−</Button>
              <span className="grid h-8 w-10 place-items-center border-x border-line font-mono text-[12px] font-semibold">{effectiveQty}</span>
              <Button type="button" variant="ghost" size="sm" aria-label={tp("increaseQty")} onClick={() => setQty((value) => Math.min(maxQty, value + 1))} className="!h-8 !w-8 !p-0 text-muted hover:bg-raised hover:text-fg">+</Button>
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[12px] text-muted">{tp("total")}</span>
            <span className="font-mono text-[20px] font-bold tabular-nums text-iris-hi">{formatCheckoutMoney(selected.price * effectiveQty, { locale })}</span>
          </div>
          <div className="w-full rounded-lg bg-iris py-3 text-center text-[12.5px] font-semibold text-panel shadow-xs">
            {instant ? tp("buyNow") : tp("placeOrder")}
          </div>
        </div>
      )}

      <EscrowNote days={escrowDays} />
    </div>
  );
}

function EscrowNote({ days }: { days: number }) {
  const t = useTranslations("seller.workbench");
  return (
    <p className="pt-1 text-center text-[11.5px] text-faint">
      {days > 0 ? t("escrowProtected", { days }) : t("escrowNone")}
    </p>
  );
}
