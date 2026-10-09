/**
 * schema.org JSON-LD for the storefront (Product / SoftwareApplication,
 * Organization + WebSite, BreadcrumbList + ItemList). Pure builders: the
 * routes pass absolute URLs and the payloads they already loaded, and embed
 * the result with `jsonLdHtml`.
 *
 * Ratings come from `product.seo` only — real buyers' visible reviews; seeded,
 * automatic and hidden reviews never reach markup (Google's review-snippet
 * policy). Without a real review there is no aggregateRating at all.
 */

import { effectiveMinPrice } from "./pricing-display.ts";

export type JsonLd = Record<string, unknown>;

/** Brand / site name used in markup (the og:site_name of `pageMetadata`). */
export const SITE_NAME = "GMMO";

/** Days an advertised price is declared valid; pages are re-rendered far more often. */
export const PRICE_VALID_DAYS = 30;

type ImageRef = { url?: string | null } | null | undefined;

type VariantLike = {
  price: number;
  is_active?: boolean;
  stock_state?: string | null;
};

export type ProductLike = {
  title: string;
  highlight_text?: string | null;
  public_key: string;
  service_type?: string | null;
  pricing_strategy?: string | null;
  pricing_params?: Record<string, unknown> | null;
  category_name?: string | null;
  seller_name?: string | null;
  images?: { cover?: ImageRef; gallery?: ImageRef[]; cover_id?: string | null } | null;
  variants?: VariantLike[] | null;
  seo?: {
    rating_value: number | null;
    review_count: number;
    reviews: { author: string; rating: number; body: string; created_at: string }[];
  } | null;
};

/** Absolute URL of a site-relative path (or an already absolute URL). */
export function absoluteUrl(origin: string, path: string): string {
  return new URL(path, `${origin.replace(/\/$/, "")}/`).toString();
}

/** Products sold as software access: API request packages ("credit"),
 *  lookup/scrape endpoints and token keys. Everything else (accounts, proxies,
 *  cloud, takedown services) stays a plain Product. */
export function isSoftwareProduct(product: Pick<ProductLike, "service_type" | "pricing_strategy">): boolean {
  return product.pricing_strategy === "credit" || product.service_type === "endpoint" || product.service_type === "token";
}

/** Uploaded pictures first, else the allowlisted cover illustration. */
export function productImages(product: Pick<ProductLike, "images">, origin: string): string[] {
  const urls = [
    ...(product.images?.gallery ?? []).map((image) => image?.url),
    product.images?.cover?.url,
  ].filter((url): url is string => Boolean(url));
  const unique = [...new Set(urls)].map((url) => absoluteUrl(origin, url));
  if (unique.length > 0) return unique;
  const cover = product.images?.cover_id;
  return cover && /^[a-z0-9-]+$/.test(cover) ? [absoluteUrl(origin, `/covers/${cover}.svg`)] : [];
}

/** Units ready now → InStock (LimitedAvailability when every stocked package
 *  is low); only made-to-order packages → BackOrder (orderable now, the shop
 *  delivers within its SLA — Google's merchant listings accept BackOrder, not
 *  MadeToOrder); nothing orderable (sold out, paused source) → OutOfStock. */
function availability(variants: VariantLike[]): string {
  const ready = variants.filter((variant) => !["out", "paused", "manual"].includes(variant.stock_state ?? ""));
  if (ready.length > 0) {
    return ready.every((variant) => variant.stock_state === "low")
      ? "https://schema.org/LimitedAvailability"
      : "https://schema.org/InStock";
  }
  if (variants.some((variant) => variant.stock_state === "manual")) return "https://schema.org/BackOrder";
  return "https://schema.org/OutOfStock";
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Prices of a product priced by formula instead of packages (API request
 *  packages, proxy plans): each request package of a "credit" product, else
 *  the cheapest price a buyer can pay (`effectiveMinPrice`, as on the cards). */
export function formulaPrices(product: Pick<ProductLike, "pricing_strategy" | "pricing_params" | "variants">): number[] {
  const params = product.pricing_params;
  if (product.pricing_strategy === "credit" && params) {
    const unit = typeof params.credit_price === "number" ? params.credit_price : 0;
    const sizes = Array.isArray(params.packages)
      ? (params.packages as { size?: unknown }[]).map((p) => (typeof p.size === "number" ? p.size : 0)).filter((size) => size > 0)
      : [];
    if (unit > 0 && sizes.length > 0) return sizes.map((size) => Math.round(unit * size));
  }
  const min = effectiveMinPrice({ ...product, variants: [] });
  return min > 0 ? [min] : [];
}

/** AggregateOffer over the active packages with a price (or, without any,
 *  the formula prices — always in stock: a provider fulfils those), sold by
 *  the shop. */
export function aggregateOffer({ variants, fallbackPrices = [], url, seller, now }: {
  variants: VariantLike[] | null | undefined;
  fallbackPrices?: number[];
  url: string;
  seller: { name: string; url: string | null } | null;
  now: Date;
}): JsonLd | null {
  const variantPriced = (variants ?? []).filter((variant) => variant.is_active !== false && variant.price > 0);
  const priced: VariantLike[] = variantPriced.length > 0
    ? variantPriced
    : fallbackPrices.filter((price) => price > 0).map((price) => ({ price, stock_state: "in_stock" }));
  if (priced.length === 0) return null;
  const prices = priced.map((variant) => variant.price);
  const validUntil = new Date(now.getTime() + PRICE_VALID_DAYS * 24 * 60 * 60 * 1000);
  return {
    "@type": "AggregateOffer",
    priceCurrency: "VND",
    lowPrice: Math.min(...prices),
    highPrice: Math.max(...prices),
    offerCount: priced.length,
    availability: availability(priced),
    priceValidUntil: isoDate(validUntil),
    url,
    ...(seller ? { seller: { "@type": "Organization", name: seller.name, ...(seller.url ? { url: seller.url } : {}) } } : {}),
  };
}

function ratingParts(seo: ProductLike["seo"]): JsonLd {
  if (!seo || !seo.rating_value || seo.review_count < 1) return {};
  return {
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: seo.rating_value,
      reviewCount: seo.review_count,
      bestRating: 5,
      worstRating: 1,
    },
    ...(seo.reviews.length > 0
      ? {
        review: seo.reviews.map((review) => ({
          "@type": "Review",
          author: { "@type": "Person", name: review.author },
          datePublished: review.created_at.slice(0, 10),
          reviewBody: review.body,
          reviewRating: { "@type": "Rating", ratingValue: review.rating, bestRating: 5, worstRating: 1 },
        })),
      }
      : {}),
  };
}

/**
 * Product page markup. Tools and APIs are a SoftwareApplication (web app,
 * applicationCategory DeveloperApplication); everything else a Product whose
 * brand is the shop (the listing's maker — never the platform it is for, such
 * as Facebook or TikTok, which would claim a trademark).
 */
export function productJsonLd({ product, url, origin, sellerUrl, now }: {
  product: ProductLike;
  url: string;
  origin: string;
  sellerUrl: string | null;
  now: Date;
}): JsonLd {
  const seller = product.seller_name ? { name: product.seller_name, url: sellerUrl } : null;
  const offers = aggregateOffer({ variants: product.variants, fallbackPrices: formulaPrices(product), url, seller, now });
  const images = productImages(product, origin);
  const description = product.highlight_text?.trim() || product.title;
  const common = {
    "@context": "https://schema.org",
    name: product.title,
    description,
    url,
    ...(images.length > 0 ? { image: images } : {}),
    ...(offers ? { offers } : {}),
    ...ratingParts(product.seo),
  };
  if (isSoftwareProduct(product)) {
    return {
      ...common,
      "@type": "SoftwareApplication",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      ...(product.category_name ? { applicationSubCategory: product.category_name } : {}),
      ...(seller ? { publisher: { "@type": "Organization", name: seller.name, ...(seller.url ? { url: seller.url } : {}) } } : {}),
    };
  }
  return {
    ...common,
    "@type": "Product",
    sku: product.public_key,
    ...(product.category_name ? { category: product.category_name } : {}),
    ...(seller ? { brand: { "@type": "Brand", name: seller.name } } : {}),
  };
}

/** Home page: the marketplace as an Organization and the site's search box. */
export function siteJsonLd({ origin, homeUrl, searchUrl, logoUrl, description }: {
  origin: string;
  homeUrl: string;
  /** Search results URL with `{search_term_string}` where the query goes. */
  searchUrl: string;
  logoUrl: string;
  description: string;
}): JsonLd {
  const organization = {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: SITE_NAME,
    url: origin,
    logo: logoUrl,
  };
  const website = {
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    name: SITE_NAME,
    url: homeUrl,
    description,
    publisher: { "@id": organization["@id"] },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: searchUrl },
      "query-input": "required name=search_term_string",
    },
  };
  return { "@context": "https://schema.org", "@graph": [organization, website] };
}

export type Crumb = { name: string; url: string };

export function breadcrumbJsonLd(crumbs: Crumb[]): JsonLd {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

/** Category page: where it sits (breadcrumb) and the offers listed on it. */
export function categoryJsonLd({ crumbs, name, url, items }: {
  crumbs: Crumb[];
  name: string;
  url: string;
  items: { name: string; url: string }[];
}): JsonLd {
  const graph: JsonLd[] = [breadcrumbJsonLd(crumbs)];
  if (items.length > 0) {
    graph.push({
      "@type": "ItemList",
      name,
      url,
      numberOfItems: items.length,
      itemListElement: items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: item.url,
        name: item.name,
      })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}
