"use client";

/** Catalog grid card. It leads with the one fact a buyer compares offers by —
 *  units in stock, proxy durations, API package sizes or the shop's delivery
 *  promise (see `offerFact`) — next to the price, and ends with the shop that
 *  sells it. The title link covers the card; the shop row is its own link. */

import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMoney } from "@/lib/money";
import { useVariantTermFor } from "@/lib/variant-term";
import { effectiveMinPrice } from "@/lib/pricing-display";
import { fulfillmentFromProduct, fulfillmentTagKey, fulfillmentTagValues, fulfillmentTone } from "@/lib/fulfillment";
import { parseCoverId } from "@/lib/product-covers";
import { productPath, sellerPath } from "@/lib/routes";
import { cn } from "@/lib/cn";
import type { Product } from "@/lib/types";
import { Monogram, Tag } from "@/components/ui";
import { ChevronRight, Star } from "@/components/Icons";
import { ProductCover } from "@/components/products/ProductCover";
import { offerFact, type OfferFact } from "../model/offer-fact";

export function OfferCard({ product: p }: { product: Product }) {
  const tc = useTranslations("common");
  const tp = useTranslations("products");
  const termFor = useVariantTermFor();
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const fact = offerFact(p);
  const fulfillment = fulfillmentFromProduct(p);
  const price = effectiveMinPrice(p);
  const packages = (p.variants ?? []).filter((v) => v.is_active !== false).length;
  const soldOut = fact.kind === "out";

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col rounded-card border border-line bg-card shadow-card",
        "transition-[border-color,box-shadow] duration-150 hover:border-line-2 hover:shadow-card-lg",
        "focus-within:border-iris focus-within:ring-2 focus-within:ring-iris/25",
      )}
    >
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <ProductCover
            coverId={parseCoverId(p)}
            image={p.images?.cover}
            title={p.title}
            className={cn("h-11 w-11 rounded-xl", soldOut && "opacity-60 grayscale")}
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold leading-snug text-fg line-clamp-2">
              <Link
                href={productPath(p)}
                className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none group-hover:text-iris-hi"
              >
                {p.title}
              </Link>
            </h3>
            {p.highlight_text && <p className="mt-1 text-[12.5px] leading-relaxed text-muted line-clamp-1">{p.highlight_text}</p>}
          </div>
        </div>

        <div className="mt-auto pt-4 flex items-end justify-between gap-3">
          <Fact fact={fact} locale={locale} />
          <div className="shrink-0 text-right">
            <div className="text-[11.5px] text-muted">{price > 0 ? tc("from") : " "}</div>
            <div className="font-mono tabular text-[17px] font-semibold leading-tight text-fg">
              {price > 0 ? formatBrowseMoney(price, { locale }) : tc("quote")}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-muted">
          <Tag tone={fulfillmentTone(fulfillment.kind)}>{tp(fulfillmentTagKey(fulfillment), fulfillmentTagValues(fulfillment))}</Tag>
          {p.rating_avg != null && p.rating_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <Star size={12} className="text-warn fill-warn" aria-hidden="true" />
              <span className="font-medium text-fg">{p.rating_avg.toFixed(1)}</span>
              <span className="text-faint">({p.rating_count})</span>
            </span>
          )}
          {p.sold_count > 0 && <span>{tc("sold", { count: p.sold_count.toLocaleString(locale) })}</span>}
          {packages > 1 && <span>{tc("packages", { count: packages, ...termFor(p.service_type) })}</span>}
        </div>
      </div>

      <ShopRow product={p} />
    </article>
  );
}

function Fact({ fact, locale }: { fact: OfferFact; locale: string }) {
  const t = useTranslations("categories.offer");
  const n = (value: number) => value.toLocaleString(locale);
  const big = "font-mono tabular text-[28px] font-semibold leading-none tracking-tight";
  const label = "mt-1.5 text-[12px] text-muted";

  switch (fact.kind) {
    case "stock":
      return (
        <div className="min-w-0">
          <div className={cn(big, fact.low ? "text-warn" : "text-fg")}>{n(fact.count)}</div>
          <div className={label}>{fact.low ? t("lowStock") : t("inStock")}</div>
        </div>
      );
    case "out":
      return (
        <div className="min-w-0">
          <div className="text-[18px] font-semibold leading-none text-muted">{t("outOfStock")}</div>
          <div className={label}>{t("outOfStockHint")}</div>
        </div>
      );
    case "duration": {
      const shown = fact.options.slice(0, 2).join(", ");
      const more = fact.options.length - 2;
      return (
        <div className="min-w-0">
          <div className={cn(big, "text-fg")}>
            {fact.minDays === fact.maxDays ? n(fact.minDays) : `${n(fact.minDays)}–${n(fact.maxDays)}`}
          </div>
          <div className={cn(label, "truncate")}>
            {t("days")}{shown && ` · ${shown}`}{more > 0 && ` +${more}`}
          </div>
        </div>
      );
    }
    case "requests":
      return (
        <div className="min-w-0">
          <div className={cn(big, "text-fg")}>{fact.min === fact.max ? n(fact.min) : `${n(fact.min)}–${n(fact.max)}`}</div>
          <div className={label}>{t("requestsPerPackage")}</div>
        </div>
      );
    case "manual":
      return (
        <div className="min-w-0">
          <div className={cn(big, "text-fg")}>{fact.slaHours ? t("hours", { count: fact.slaHours }) : t("madeToOrder")}</div>
          <div className={label}>{fact.slaHours ? t("deliveredWithin") : t("madeToOrderHint")}</div>
        </div>
      );
    default:
      return <div />;
  }
}

/** Who sells it: the shop's name and track record, linking to the shop. */
function ShopRow({ product: p }: { product: Product }) {
  const t = useTranslations("categories.offer");
  const locale = useLocale();
  const name = p.seller_name?.trim();
  if (!name) return null;
  const rated = p.shop_rating_avg != null && (p.shop_review_count ?? 0) > 0;
  const sales = p.shop_sales ?? 0;
  const body = (
    <>
      <Monogram text={name} className="h-8 w-8 rounded-full text-[11.5px]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-fg">{name}</span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
          {rated && (
            <span className="inline-flex items-center gap-0.5">
              <Star size={11} className="text-warn fill-warn" aria-hidden="true" />
              <span className="font-medium text-fg">{p.shop_rating_avg!.toFixed(1)}</span>
            </span>
          )}
          {rated && sales > 0 && <span aria-hidden="true" className="text-faint">·</span>}
          {sales > 0 && <span>{t("shopOrders", { count: sales.toLocaleString(locale) })}</span>}
          {!rated && sales === 0 && <span>{t("shopNew")}</span>}
        </span>
      </span>
    </>
  );
  const row = "relative z-10 flex items-center gap-2.5 border-t border-line px-4 sm:px-5 py-3 rounded-b-card";
  if (!p.seller_key && !p.seller_path) return <div className={row}>{body}</div>;
  return (
    <Link
      href={sellerPath({ canonical_path: p.seller_path, public_key: p.seller_key, handle: p.seller_handle })}
      aria-label={t("shopLink", { name })}
      className={cn(row, "transition-colors hover:bg-raised/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-iris")}
    >
      {body}
      <ChevronRight size={15} className="shrink-0 text-faint" />
    </Link>
  );
}
