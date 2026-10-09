import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateOffer, categoryJsonLd, formulaPrices, isSoftwareProduct, productImages, productJsonLd, siteJsonLd,
} from "../lib/structured-data.ts";

const origin = "https://gmmo.example";
const url = "https://gmmo.example/vi/products/clone-fb-ab12cd34";
const now = new Date("2026-10-07T10:00:00Z");

const product = {
  title: "Clone Facebook ngâm 2 năm",
  highlight_text: "Live ads, có 2FA",
  public_key: "ab12cd34",
  service_type: "account",
  pricing_strategy: "fixed",
  category_name: "Facebook",
  seller_name: "Shop Via Sạch",
  images: { cover: { url: "/media/public/a.webp" }, gallery: [{ url: "/media/public/a.webp" }, { url: "/media/public/b.webp" }] },
  variants: [
    { price: 15000, is_active: true, stock_state: "in_stock" },
    { price: 42000, is_active: true, stock_state: "low" },
    { price: 99000, is_active: false, stock_state: "in_stock" },
    { price: 0, is_active: true, stock_state: "manual" },
  ],
  seo: {
    rating_value: 4.5,
    review_count: 2,
    reviews: [{ author: "ng***n", rating: 5, body: "Giao nhanh", created_at: "2026-10-01T08:00:00Z" }],
  },
};

describe("product structured data", () => {
  it("is a Product with an AggregateOffer, the shop as brand and seller, and real ratings", () => {
    const ld = productJsonLd({ product, url, origin, sellerUrl: "https://gmmo.example/vi/sellers/via-sach-k1", now });
    assert.equal(ld["@type"], "Product");
    assert.equal(ld.sku, "ab12cd34");
    assert.equal(ld.category, "Facebook");
    assert.deepEqual(ld.brand, { "@type": "Brand", name: "Shop Via Sạch" });
    assert.deepEqual(ld.image, ["https://gmmo.example/media/public/a.webp", "https://gmmo.example/media/public/b.webp"]);
    const offers = ld.offers as Record<string, unknown>;
    assert.equal(offers["@type"], "AggregateOffer");
    // Inactive and zero-price packages are not offers.
    assert.deepEqual([offers.lowPrice, offers.highPrice, offers.offerCount], [15000, 42000, 2]);
    assert.equal(offers.priceCurrency, "VND");
    assert.equal(offers.priceValidUntil, "2026-11-06");
    assert.equal(offers.availability, "https://schema.org/InStock");
    assert.deepEqual(offers.seller, { "@type": "Organization", name: "Shop Via Sạch", url: "https://gmmo.example/vi/sellers/via-sach-k1" });
    assert.deepEqual(ld.aggregateRating, { "@type": "AggregateRating", ratingValue: 4.5, reviewCount: 2, bestRating: 5, worstRating: 1 });
    const [review] = ld.review as Record<string, unknown>[];
    assert.deepEqual(review.author, { "@type": "Person", name: "ng***n" });
    assert.equal(review.datePublished, "2026-10-01");
  });

  it("omits aggregateRating and review when no real buyer has rated", () => {
    const ld = productJsonLd({ product: { ...product, seo: { rating_value: null, review_count: 0, reviews: [] } }, url, origin, sellerUrl: null, now });
    assert.equal("aggregateRating" in ld, false);
    assert.equal("review" in ld, false);
    const bare = productJsonLd({ product: { ...product, seo: null }, url, origin, sellerUrl: null, now });
    assert.equal("aggregateRating" in bare, false);
  });

  it("has no offers without a priced package, and reports stock", () => {
    assert.equal(aggregateOffer({ variants: [], url, seller: null, now }), null);
    // A proxy plan priced by formula: the cheapest plan is the offer.
    assert.deepEqual(formulaPrices({ pricing_strategy: "config", pricing_params: { plan_prices: { a: 50000, b: 30000 } }, variants: [] }), [30000]);
    assert.deepEqual(formulaPrices({ pricing_strategy: "fixed", pricing_params: null, variants: [] }), []);
    const out = aggregateOffer({ variants: [{ price: 1000, stock_state: "out" }], url, seller: null, now });
    assert.equal(out?.availability, "https://schema.org/OutOfStock");
    const low = aggregateOffer({ variants: [{ price: 1000, stock_state: "low" }], url, seller: null, now });
    assert.equal(low?.availability, "https://schema.org/LimitedAvailability");
    // Only made-to-order packages can be ordered: back order, not out of stock.
    const madeToOrder = aggregateOffer({ variants: [{ price: 1000, stock_state: "out" }, { price: 290000, stock_state: "manual" }], url, seller: null, now });
    assert.equal(madeToOrder?.availability, "https://schema.org/BackOrder");
    const mixed = aggregateOffer({ variants: [{ price: 1000, stock_state: "in_stock" }, { price: 290000, stock_state: "manual" }], url, seller: null, now });
    assert.equal(mixed?.availability, "https://schema.org/InStock");
    const paused = aggregateOffer({ variants: [{ price: 1000, stock_state: "paused" }], url, seller: null, now });
    assert.equal(paused?.availability, "https://schema.org/OutOfStock");
    assert.equal("seller" in (low ?? {}), false);
  });

  it("falls back to the cover illustration when nothing was uploaded", () => {
    assert.deepEqual(productImages({ images: { cover_id: "facebook" } }, origin), ["https://gmmo.example/covers/facebook.svg"]);
    assert.deepEqual(productImages({ images: null }, origin), []);
  });

  it("marks API, lookup and token products as SoftwareApplication", () => {
    assert.equal(isSoftwareProduct({ pricing_strategy: "credit", service_type: "other" }), true);
    assert.equal(isSoftwareProduct({ pricing_strategy: "fixed", service_type: "endpoint" }), true);
    assert.equal(isSoftwareProduct({ pricing_strategy: "fixed", service_type: "token" }), true);
    assert.equal(isSoftwareProduct({ pricing_strategy: "config", service_type: "proxy" }), false);
    assert.equal(isSoftwareProduct({ pricing_strategy: "task", service_type: "takedown" }), false);

    const ld = productJsonLd({
      product: {
        ...product, pricing_strategy: "credit", service_type: "endpoint", category_name: "Social Tools", variants: [],
        pricing_params: { credit_price: 10, packages: [{ size: 1000 }, { size: 5000 }, { size: 10000 }] },
      },
      url, origin, sellerUrl: null, now,
    });
    assert.equal(ld["@type"], "SoftwareApplication");
    assert.equal(ld.operatingSystem, "Web");
    assert.equal(ld.applicationCategory, "DeveloperApplication");
    assert.equal(ld.applicationSubCategory, "Social Tools");
    assert.equal("brand" in ld, false);
    // Request packages priced by formula: one offer per package, always available.
    const offers = ld.offers as Record<string, unknown>;
    assert.deepEqual([offers["@type"], offers.lowPrice, offers.highPrice, offers.offerCount], ["AggregateOffer", 10000, 100000, 3]);
    assert.equal(offers.availability, "https://schema.org/InStock");
    assert.equal((ld.aggregateRating as Record<string, unknown>).reviewCount, 2);
  });
});

describe("site and category structured data", () => {
  it("describes the organization and a search box on the real search URL", () => {
    const ld = siteJsonLd({
      origin, homeUrl: `${origin}/vi`, searchUrl: `${origin}/vi/search?q={search_term_string}`,
      logoUrl: `${origin}/brand/gmmo-mark.svg`, description: "Chợ MMO",
    });
    const [organization, website] = ld["@graph"] as Record<string, any>[];
    assert.equal(organization["@type"], "Organization");
    assert.equal(website["@type"], "WebSite");
    assert.equal(website.publisher["@id"], organization["@id"]);
    assert.equal(website.potentialAction.target.urlTemplate, "https://gmmo.example/vi/search?q={search_term_string}");
    assert.equal(website.potentialAction["query-input"], "required name=search_term_string");
  });

  it("lists the breadcrumb and the products of a category page", () => {
    const ld = categoryJsonLd({
      crumbs: [
        { name: "GMMO", url: `${origin}/vi` },
        { name: "Danh mục", url: `${origin}/vi/categories` },
        { name: "Facebook", url: `${origin}/vi/categories/facebook` },
      ],
      name: "Facebook",
      url: `${origin}/vi/categories/facebook`,
      items: [{ name: "Clone", url }, { name: "Via", url: `${origin}/vi/products/via-xy12ab34` }],
    });
    const [breadcrumb, list] = ld["@graph"] as Record<string, any>[];
    assert.deepEqual(breadcrumb.itemListElement.map((item: { position: number }) => item.position), [1, 2, 3]);
    assert.equal(list["@type"], "ItemList");
    assert.equal(list.numberOfItems, 2);
    assert.equal(list.itemListElement[1].url, `${origin}/vi/products/via-xy12ab34`);

    const empty = categoryJsonLd({ crumbs: [], name: "X", url, items: [] });
    assert.equal((empty["@graph"] as unknown[]).length, 1);
  });
});
