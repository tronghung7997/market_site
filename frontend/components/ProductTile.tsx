"use client";

/** Shared product tile for category hub/detail grids. */

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { effectiveMinPrice } from "@/lib/pricing-display";
import { fulfillmentFromProduct, fulfillmentTagKey, fulfillmentTagValues, fulfillmentTone } from "@/lib/fulfillment";
import { parseCoverId } from "@/lib/product-covers";
import type { Product } from "@/lib/types";
import { Card, Tag } from "@/components/ui";
import { Star } from "@/components/Icons";
import { ProductCover } from "@/components/products/ProductCover";

export default function ProductTile({ product: p }: { product: Product }) {
  const t = useTranslations("common");
  const tp = useTranslations("products");
  const locale = useLocale();
  const fulfillment = fulfillmentFromProduct(p);
  const { formatBrowseMoney } = useMoney();
  const mp = effectiveMinPrice(p);
  const variantCount = (p.variants ?? []).length;

  return (
    <Link href={`/products/${p.id}`} className="h-full">
      <Card interactive className="p-3.5 h-full flex flex-col">
        <div className="flex items-start gap-2.5">
          <ProductCover coverId={parseCoverId(p)} title={p.title} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-snug line-clamp-2">{p.title}</div>
            <div className="mt-1 flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[11px] text-faint">
              {p.rating_avg != null && p.rating_count > 0 && (
                <span className="flex items-center gap-0.5 text-muted">
                  <Star size={10} className="text-warn fill-warn" /> {p.rating_avg.toFixed(1)}
                </span>
              )}
              {p.sold_count > 0 && <span>{t("sold", { count: p.sold_count })}</span>}
              {variantCount > 1 && <span>{t("packages", { count: variantCount })}</span>}
            </div>
          </div>
        </div>
        <div className="mt-auto pt-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[9.5px] uppercase tracking-wide text-faint font-medium">{t("from")}</div>
            <div className="font-mono text-[14.5px] font-semibold tabular text-iris-hi leading-tight">
              {mp > 0 ? formatBrowseMoney(mp, { locale }) : t("quote")}
            </div>
          </div>
          <span className="shrink-0"><Tag tone={fulfillmentTone(fulfillment.kind)}>{tp(fulfillmentTagKey(fulfillment), fulfillmentTagValues(fulfillment))}</Tag></span>
        </div>
      </Card>
    </Link>
  );
}
