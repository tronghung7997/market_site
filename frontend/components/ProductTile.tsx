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

export default function ProductTile({
  product: p,
  layout = "grid",
  density = "compact",
}: {
  product: Product;
  layout?: "grid" | "list";
  density?: "compact" | "detailed";
}) {
  const t = useTranslations("common");
  const tp = useTranslations("products");
  const tc = useTranslations("categories");
  const locale = useLocale();
  const fulfillment = fulfillmentFromProduct(p);
  const { formatBrowseMoney } = useMoney();
  const mp = effectiveMinPrice(p);
  const variantCount = (p.variants ?? []).length;
  const stockCount = (p.variants ?? []).reduce((s, v) => s + (v.stock_count ?? 0), 0);
  const isOutOfStock = (p.variants ?? []).length > 0 && stockCount === 0;

  if (layout === "list") {
    return (
      <Link href={`/products/${p.id}`} className="block group">
        <Card interactive className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 transition-all">
          <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
            <ProductCover coverId={parseCoverId(p)} title={p.title} className="h-11 w-11 sm:h-12 sm:w-12 shrink-0 rounded-xl shadow-xs" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] sm:text-[15px] font-medium leading-snug line-clamp-1 group-hover:text-iris-hi transition-colors">
                {p.title}
              </div>
              {p.highlight_text && (
                <div className="text-[12px] text-muted line-clamp-1 mt-0.5">
                  {p.highlight_text}
                </div>
              )}
              <div className="mt-1 flex items-center gap-x-2.5 gap-y-1 flex-wrap text-[11px] text-faint">
                {p.rating_avg != null && p.rating_count > 0 && (
                  <span className="flex items-center gap-0.5 text-muted font-medium">
                    <Star size={11} className="text-warn fill-warn" /> {p.rating_avg.toFixed(1)}
                  </span>
                )}
                {p.sold_count > 0 && <span>{t("sold", { count: p.sold_count })}</span>}
                {variantCount > 1 && <span>{t("packages", { count: variantCount })}</span>}
                <Tag tone={fulfillmentTone(fulfillment.kind)}>{tp(fulfillmentTagKey(fulfillment), fulfillmentTagValues(fulfillment))}</Tag>
                {isOutOfStock ? (
                  <Tag tone="bad">{tc("outOfStock")}</Tag>
                ) : stockCount > 0 ? (
                  <span className="text-good flex items-center gap-1 font-medium">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-good" />
                    {tc("inStock")}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-line">
            <div className="text-left sm:text-right">
              <div className="text-[10px] uppercase tracking-wider text-faint font-medium">{t("from")}</div>
              <div className="font-mono text-[15px] sm:text-[17px] font-semibold tabular text-iris-hi leading-tight">
                {mp > 0 ? formatBrowseMoney(mp, { locale }) : t("quote")}
              </div>
            </div>
            <span className="text-[12.5px] font-medium text-iris-hi group-hover:translate-x-0.5 transition-transform flex items-center gap-1">
              {tc("viewDetails")} →
            </span>
          </div>
        </Card>
      </Link>
    );
  }

  // Detailed density: Larger card with highlight text and prominent action row
  if (density === "detailed") {
    return (
      <Link href={`/products/${p.id}`} className="h-full block group">
        <Card interactive className="p-4 sm:p-5 h-full flex flex-col justify-between transition-all hover:border-iris/40 shadow-xs hover:shadow-card">
          <div>
            <div className="flex items-start gap-3.5">
              <ProductCover coverId={parseCoverId(p)} title={p.title} className="h-12 w-12 sm:h-13 sm:w-13 shrink-0 rounded-2xl shadow-xs" />
              <div className="min-w-0 flex-1">
                <h3 className="text-[14.5px] sm:text-[15.5px] font-semibold text-fg leading-snug line-clamp-2 group-hover:text-iris-hi transition-colors">
                  {p.title}
                </h3>
                {p.highlight_text && (
                  <p className="text-[12px] sm:text-[12.5px] text-muted line-clamp-2 mt-1 leading-relaxed">
                    {p.highlight_text}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-x-2.5 gap-y-1 flex-wrap text-[11.5px] text-faint">
              {p.rating_avg != null && p.rating_count > 0 && (
                <span className="flex items-center gap-0.5 text-muted font-medium">
                  <Star size={11} className="text-warn fill-warn" /> {p.rating_avg.toFixed(1)}
                  <span className="text-faint">({p.rating_count})</span>
                </span>
              )}
              {p.sold_count > 0 && <span>{t("sold", { count: p.sold_count })}</span>}
              {variantCount > 1 && <span>{t("packages", { count: variantCount })}</span>}
              {isOutOfStock ? (
                <Tag tone="bad">{tc("outOfStock")}</Tag>
              ) : stockCount > 0 ? (
                <span className="text-good flex items-center gap-1 font-medium">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-good" />
                  {tc("inStock")}
                </span>
              ) : null}
              <Tag tone={fulfillmentTone(fulfillment.kind)}>
                {tp(fulfillmentTagKey(fulfillment), fulfillmentTagValues(fulfillment))}
              </Tag>
            </div>
          </div>

          <div className="mt-4 pt-3 flex items-center justify-between gap-3 border-t border-line/70">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-faint font-medium">{t("from")}</div>
              <div className="font-mono text-[17px] sm:text-[19px] font-bold tabular text-iris-hi leading-tight">
                {mp > 0 ? formatBrowseMoney(mp, { locale }) : t("quote")}
              </div>
            </div>
            <span className="text-[12.5px] font-semibold text-iris-hi group-hover:translate-x-0.5 transition-transform flex items-center gap-1 shrink-0">
              {tc("viewDetails")} →
            </span>
          </div>
        </Card>
      </Link>
    );
  }

  return (
    <Link href={`/products/${p.id}`} className="h-full block group">
      <Card interactive className="p-3.5 h-full flex flex-col transition-all">
        <div className="flex items-start gap-2.5">
          <ProductCover coverId={parseCoverId(p)} title={p.title} className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] sm:text-[13.5px] font-medium leading-snug line-clamp-2 group-hover:text-iris-hi transition-colors">
              {p.title}
            </div>
            <div className="mt-1 flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[11px] text-faint">
              {p.rating_avg != null && p.rating_count > 0 && (
                <span className="flex items-center gap-0.5 text-muted font-medium">
                  <Star size={10} className="text-warn fill-warn" /> {p.rating_avg.toFixed(1)}
                </span>
              )}
              {p.sold_count > 0 && <span>{t("sold", { count: p.sold_count })}</span>}
              {variantCount > 1 && <span>{t("packages", { count: variantCount })}</span>}
            </div>
          </div>
        </div>
        <div className="mt-auto pt-3 flex items-end justify-between gap-2 border-t border-line/60">
          <div className="min-w-0">
            <div className="text-[9.5px] uppercase tracking-wide text-faint font-medium">{t("from")}</div>
            <div className="font-mono text-[14.5px] font-semibold tabular text-iris-hi leading-tight">
              {mp > 0 ? formatBrowseMoney(mp, { locale }) : t("quote")}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isOutOfStock && <Tag tone="bad">{tc("outOfStock")}</Tag>}
            <Tag tone={fulfillmentTone(fulfillment.kind)}>
              {tp(fulfillmentTagKey(fulfillment), fulfillmentTagValues(fulfillment))}
            </Tag>
          </div>
        </div>
      </Card>
    </Link>
  );
}
