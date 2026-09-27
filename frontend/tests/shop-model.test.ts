import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { filterShopProducts, isShopSort } from "../app/[locale]/sellers/[key]/shop-model.ts";
import type { Product } from "../lib/types.ts";

function product(id: number, title: string, extra: Partial<Product> = {}): Product {
  return {
    id, title, category_id: 1, sold_count: 0, rating_avg: null, rating_count: 0, created_at: `2026-09-0${id}T00:00:00Z`,
    variants: [{ id, price: id * 1000, is_active: true, delivery_mode: "instant" }],
    ...extra,
  } as unknown as Product;
}

const items = [
  product(1, "Proxy dân cư Việt Nam", { sold_count: 5, rating_avg: 4.5, rating_count: 2 }),
  product(2, "Gmail cổ 2015", { sold_count: 9, category_id: 2 }),
  product(3, "Proxy datacenter", { sold_count: 1, rating_avg: 5, rating_count: 1 }),
];

describe("shop page product list", () => {
  it("searches without accents and every word must match", () => {
    assert.deepEqual(filterShopProducts(items, { query: "proxy dan cu", categoryId: null, sort: "bestseller" }).map((p) => p.id), [1]);
    assert.deepEqual(filterShopProducts(items, { query: "proxy", categoryId: null, sort: "bestseller" }).map((p) => p.id), [1, 3]);
  });

  it("filters by category and sorts", () => {
    assert.deepEqual(filterShopProducts(items, { query: "", categoryId: 2, sort: "bestseller" }).map((p) => p.id), [2]);
    assert.deepEqual(filterShopProducts(items, { query: "", categoryId: null, sort: "bestseller" }).map((p) => p.id), [2, 1, 3]);
    assert.deepEqual(filterShopProducts(items, { query: "", categoryId: null, sort: "rating" }).map((p) => p.id), [3, 1, 2]);
    assert.deepEqual(filterShopProducts(items, { query: "", categoryId: null, sort: "newest" }).map((p) => p.id), [3, 2, 1]);
  });

  it("validates sort values", () => {
    assert.ok(isShopSort("price_asc"));
    assert.ok(!isShopSort("cheapest"));
    assert.ok(!isShopSort(null));
  });
});
