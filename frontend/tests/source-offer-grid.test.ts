import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { filterGrids, groupOffers, marginRange, needsAttention, summarizeOffers } from "../features/seller-sources/offer-grid.ts";
import type { SourceOffer } from "../lib/types.ts";

function offer(partial: Partial<SourceOffer>): SourceOffer {
  return {
    product_id: 1, product_title: "Proxy tĩnh", product_key: "k1", product_status: "active",
    plan_key: "HTTP|Viettel|30", type: "HTTP", network: "Viettel", days: 30, label: "HTTP · Viettel · 30 ngày",
    price: 36_000, cost_price: 14_400, margin_pct: 150, margin_ok: true, external_id: "Viettel", external_name: "share · Viettel",
    unmapped: false, plan_missing: false, upstream_available: true, ...partial,
  };
}

describe("proxy source offer grid", () => {
  it("lays each product out as type·network rows by ascending duration columns", () => {
    const grids = groupOffers([
      offer({ days: 30, plan_key: "HTTP|Viettel|30" }),
      offer({ days: 3, plan_key: "HTTP|Viettel|3", margin_pct: 50 }),
      offer({ network: "FPT", days: 7, plan_key: "HTTP|FPT|7", margin_pct: 67 }),
      offer({ product_id: 2, product_title: "Datacenter", plan_key: "HTTP|US|30", network: "US" }),
    ]);
    assert.equal(grids.length, 2);
    const [first] = grids;
    assert.deepEqual(first.types, [{ type: "HTTP", networks: ["Viettel", "FPT"] }]);
    assert.deepEqual(first.days, [3, 7, 30]);
    assert.equal(first.cells.get("HTTP|FPT|7")?.price, 36_000);
    assert.equal(first.cells.get("HTTP|FPT|3"), undefined);
    assert.equal(marginRange(first.marginMin, first.marginMax), "50–150%");
  });

  it("counts plans that need a look", () => {
    assert.equal(needsAttention(offer({})), false);
    assert.equal(needsAttention(offer({ margin_ok: false })), true);
    assert.equal(needsAttention(offer({ unmapped: true })), true);
    assert.equal(needsAttention(offer({ plan_missing: true })), true);
    assert.equal(needsAttention(offer({ upstream_available: false })), true);
    const [grid] = groupOffers([offer({}), offer({ plan_key: "HTTP|Viettel|7", days: 7, margin_ok: false })]);
    assert.equal(grid.attention, 1);
  });

  it("sums the source across products", () => {
    const summary = summarizeOffers(groupOffers([
      offer({ price: 3_600, margin_pct: 50 }),
      offer({ plan_key: "HTTP|Viettel|7", days: 7, price: 8_400, margin_ok: false, margin_pct: 20 }),
      offer({ product_id: 2, product_title: "Datacenter", price: 90_000, margin_pct: 400 }),
      offer({ product_id: 3, product_title: "Chưa có vốn", cost_price: null, margin_pct: null }),
    ]));
    assert.deepEqual(summary, { selling: 4, products: 3, attention: 1, minPrice: 3_600, maxPrice: 90_000, marginMin: 20, marginMax: 400 });
    assert.deepEqual(summarizeOffers([]), { selling: 0, products: 0, attention: 0, minPrice: null, maxPrice: null, marginMin: null, marginMax: null });
  });

  it("filters by product title or any plan", () => {
    const grids = groupOffers([offer({}), offer({ product_id: 2, product_title: "Datacenter", external_name: "dc · San Jose" })]);
    assert.deepEqual(filterGrids(grids, "san jose").map((g) => g.productId), [2]);
    assert.deepEqual(filterGrids(grids, "tĩnh").map((g) => g.productId), [1]);
    assert.equal(filterGrids(grids, "  ").length, 2);
    assert.equal(marginRange(null, null), null);
    assert.equal(marginRange(60, 60), "60%");
  });
});
