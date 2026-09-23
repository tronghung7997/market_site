"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { useVariantTerm } from "@/lib/variant-term";
import { Card } from "@/components/ui";
import { ProductCover } from "@/components/products/ProductCover";
import { Eye } from "@/components/Icons";

/** Slim "what the buyer sees" card: just the head of the listing. The full
 *  page lives behind the preview button so the sidebar stays short. */
export function CustomerGlance({
  title, categoryLabel, coverId, deliveryLabel, escrowDays, highlightText, minPrice, variantCount, onPreview, serviceType,
}: {
  title: string;
  categoryLabel: string;
  coverId: string | null;
  deliveryLabel: string;
  escrowDays: number;
  highlightText: string;
  minPrice: number | null;
  variantCount: number;
  onPreview: () => void;
  serviceType: string;
}) {
  const t = useTranslations("sellerProductForm.glance");
  const term = useVariantTerm(serviceType);
  const { formatCheckoutMoney } = useMoney();
  const locale = useLocale();
  const meta = [categoryLabel || t("noCategory"), deliveryLabel, t("protection", { days: escrowDays })].filter(Boolean).join(" · ");
  return (
    <Card className="p-4">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">{t("title")}</div>
      <div className="flex items-center gap-2.5">
        <ProductCover coverId={coverId} title={title || t("untitled")} className="h-10 w-10 shrink-0 rounded-[10px]" />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-bold text-fg">{title.trim() || <span className="text-faint">{t("untitled")}</span>}</div>
          <div className="truncate text-[11.5px] text-faint">{meta}</div>
        </div>
      </div>
      {highlightText.trim() && <div className="mt-1.5 text-[12px] text-iris-hi">{highlightText}</div>}
      <div className="mt-2.5 text-[17px] font-bold text-iris-hi">
        {minPrice != null && minPrice > 0
          ? t("from", { price: formatCheckoutMoney(minPrice, { locale }) })
          : <span className="text-[12.5px] font-medium text-faint">{t("noPrice")}</span>}
        {variantCount > 1 && <span className="ml-1.5 text-[11.5px] font-normal text-faint">· {t("variants", { count: variantCount, ...term })}</span>}
      </div>
      <button type="button" onClick={onPreview} className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-iris hover:underline">
        <Eye size={13} /> {t("fullPreview")}
      </button>
    </Card>
  );
}
