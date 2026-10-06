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

/** `hideShop`: the grid already shows one shop's offers, so each card need not repeat it. */
export function OfferCard({ product: p, hideShop = false }: { product: Product; hideShop?: boolean }) {
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
            {/* Vietnamese titles carry the spec (2FA, warranty, age…): never clamped. */}
            <h3 className="text-[15px] font-semibold leading-5 text-fg [overflow-wrap:anywhere]">
              <Link
                href={productPath(p)}
                className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none group-hover:text-iris-hi"
              >
                {p.title}
              </Link>
            </h3>
            {p.highlight_text && <p className="mt-1 text-[13px] leading-5 text-muted line-clamp-2">{p.highlight_text}</p>}
          </div>
        </div>

        <div className="mt-auto pt-4 flex items-end justify-between gap-3">
          <Fact fact={fact} locale={locale} />
          <div className={cn("shrink-0 text-right", soldOut && "opacity-60")}>
            <div className="text-[11px] leading-4 text-muted">{price > 0 ? tc("from") : " "}</div>
            <div className="font-mono tabular text-[18px] font-semibold leading-6 text-fg">
              {price > 0 ? formatBrowseMoney(price, { locale }) : tc("quote")}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-muted">
          {!soldOut && <Tag tone={fulfillmentTone(fulfillment.kind)}>{tp(fulfillmentTagKey(fulfillment), fulfillmentTagValues(fulfillment))}</Tag>}
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

      {!hideShop && <ShopRow product={p} />}
    </article>
  );
}

/** The comparison fact, one line in the title's size (the price stays the
 *  biggest number on the card): number in mono, unit in plain text. */
function Fact({ fact, locale }: { fact: OfferFact; locale: string }) {
  const t = useTranslations("categories.offer");
  const n = (value: number) => value.toLocaleString(locale);
  const range = (min: number, max: number) => (min === max ? n(min) : `${n(min)}–${n(max)}`);
  const line = "text-[15px] font-semibold leading-5 text-fg";
  const num = "font-mono tabular";
  const sub = "mt-0.5 text-[12px] leading-4 text-muted";

  switch (fact.kind) {
    case "stock":
      return (
        <div className="min-w-0">
          <div className={line}><span className={num}>{n(fact.count)}</span> {t("inStock")}</div>
          {fact.low && (
            <div className={cn(sub, "flex items-center gap-1.5")}>
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />{t("lowStock")}
            </div>
          )}
        </div>
      );
    case "out":
      return (
        <div className="min-w-0">
          <div className={line}>{t("outOfStock")}</div>
          <div className={sub}>{t("outOfStockHint")}</div>
        </div>
      );
    case "duration":
      return (
        <div className="min-w-0">
          <div className={line}><span className={num}>{range(fact.minDays, fact.maxDays)}</span> {t("days")}</div>
          {fact.options.length > 0 && <div className={cn(sub, "line-clamp-2")}>{fact.options.join(", ")}</div>}
        </div>
      );
    case "requests":
      return (
        <div className="min-w-0">
          <div className={line}><span className={num}>{range(fact.min, fact.max)}</span> {t("requestsPerPackage")}</div>
        </div>
      );
    case "manual":
      return (
        <div className="min-w-0">
          <div className={line}>
            {fact.slaHours ? <><span className={num}>{n(fact.slaHours)}</span> {t("hoursUnit")}</> : t("madeToOrder")}
          </div>
          <div className={sub}>{fact.slaHours ? t("deliveredWithin") : t("madeToOrderHint")}</div>
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
        <span className="flex items-center gap-1.5 text-[12px] text-muted">
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
