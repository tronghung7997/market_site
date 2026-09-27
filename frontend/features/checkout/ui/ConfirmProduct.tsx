"use client";

/** Top of a purchase confirmation: what is being bought and from whom, plus
 *  what arrives after payment — so the buyer confirms the right thing. */

import { useTranslations } from "next-intl";
import type { ProductDetail } from "@/lib/types";
import { ProductCover, parseCoverId } from "@/features/product-covers";

export function ConfirmProduct({ product }: { product: ProductDetail }) {
  const t = useTranslations("products");
  return (
    <div className="space-y-2.5">
      <div className="flex items-start gap-3">
        <ProductCover coverId={parseCoverId(product)} image={product.images?.cover} title={product.title} className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <p className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-fg">{product.title}</p>
          {product.seller_name && <p className="mt-0.5 truncate text-[12px] text-muted">{t("confirmSeller", { name: product.seller_name })}</p>}
        </div>
      </div>
      {product.delivery_note && (
        <div className="rounded-md bg-raised px-3 py-2 text-[12px] leading-snug">
          <p className="font-medium text-fg">{t("confirmReceives")}</p>
          <p className="mt-0.5 line-clamp-3 text-muted">{product.delivery_note}</p>
        </div>
      )}
    </div>
  );
}
