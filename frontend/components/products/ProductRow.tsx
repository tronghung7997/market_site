"use client";

/** One product as a list row: cover, title, provenance line, delivery, price.
 *  Rows sit inside a single bordered surface (`divide-y`), so a category
 *  reads as one table of offers rather than a field of floating cards. */

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { useVariantTermFor } from "@/lib/variant-term";
import { effectiveMinPrice } from "@/lib/pricing-display";
import { fulfillmentFromProduct, fulfillmentTagKey, fulfillmentTagValues, fulfillmentTone } from "@/lib/fulfillment";
import { parseCoverId } from "@/lib/product-covers";
import { productStockState } from "@/lib/stock";
import type { Product } from "@/lib/types";
import { productPath } from "@/lib/routes";
import { Tag } from "@/components/ui";
import { ChevronRight, Star } from "@/components/Icons";
import { ProductCover } from "@/components/products/ProductCover";

export function ProductRow({
  product: p,
  /** Sub-category (or seller) shown first on the meta line. */
  context,
}: {
  product: Product;
  context?: string | null;
}) {
  const t = useTranslations("common");
  const tp = useTranslations("products");
  const tc = useTranslations("categories");
  const termFor = useVariantTermFor();
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const fulfillment = fulfillmentFromProduct(p);
  const mp = effectiveMinPrice(p);
  const variantCount = (p.variants ?? []).length;
  const term = termFor(p.service_type);
  const stock = productStockState(p.variants);

  return (
    <Link
      href={productPath(p)}
      className="group flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 transition-colors hover:bg-raised/60 focus-visible:bg-raised/60 focus-visible:outline-none"
    >
      <ProductCover coverId={parseCoverId(p)} title={p.title} className="h-10 w-10 sm:h-11 sm:w-11 rounded-lg" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="min-w-0 truncate text-[14px] font-medium text-fg group-hover:text-iris-hi transition-colors">
            {p.title}
          </span>
          {stock === "out" && <Tag tone="bad">{tc("outOfStock")}</Tag>}
          {stock === "low" && <Tag tone="warn">{tc("lowStock")}</Tag>}
        </div>
        <div className="mt-0.5 flex items-center gap-x-2 text-[12px] text-muted min-w-0">
          {context && <span className="min-w-0 truncate text-fg/70">{context}</span>}
          {p.rating_avg != null && p.rating_count > 0 && (
            <span className="inline-flex items-center gap-0.5 shrink-0">
              <Star size={11} className="text-warn fill-warn" />
              <span className="font-medium text-fg/80">{p.rating_avg.toFixed(1)}</span>
              <span className="text-faint">({p.rating_count})</span>
            </span>
          )}
          {p.sold_count > 0 && <span className="shrink-0">{t("sold", { count: p.sold_count })}</span>}
          {variantCount > 1 && <span className="shrink-0 hidden sm:inline">{t("packages", { count: variantCount, ...term })}</span>}
          {p.highlight_text && <span className="hidden md:inline min-w-0 truncate text-faint">{p.highlight_text}</span>}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0 text-right">
        <span className="font-mono tabular text-[14px] sm:text-[15px] font-semibold text-fg leading-none">
          {mp > 0 ? formatBrowseMoney(mp, { locale }) : t("quote")}
        </span>
        <Tag tone={fulfillmentTone(fulfillment.kind)}>
          {tp(fulfillmentTagKey(fulfillment), fulfillmentTagValues(fulfillment))}
        </Tag>
      </div>
      <ChevronRight size={15} className="hidden sm:block text-faint group-hover:text-iris-hi group-hover:translate-x-0.5 transition-all shrink-0" />
    </Link>
  );
}
