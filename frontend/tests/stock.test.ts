import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  productStockState,
  stockRank,
  variantMaxQuantity,
  variantOutOfStock,
  variantPurchasable,
  variantStockState,
} from "../lib/stock.ts";

describe("variant stock state", () => {
  it("trusts the storefront stock_state when present", () => {
    assert.equal(variantStockState({ delivery_mode: "instant", stock_state: "low" }), "low");
    assert.equal(variantStockState({ delivery_mode: "instant", stock_state: "out", stock_count: 50 }), "out");
  });

  it("derives the state from the exact count on management payloads", () => {
    assert.equal(variantStockState({ delivery_mode: "instant", stock_count: 0 }), "out");
    assert.equal(variantStockState({ delivery_mode: "instant", stock_count: 3 }), "low");
    assert.equal(variantStockState({ delivery_mode: "instant", stock_count: 300 }), "in_stock");
    assert.equal(variantStockState({ delivery_mode: "manual" }), "manual");
  });

  it("treats only dry instant packages as out of stock", () => {
    assert.equal(variantOutOfStock({ delivery_mode: "instant", stock_state: "out" }), true);
    assert.equal(variantOutOfStock({ delivery_mode: "manual", stock_state: "manual" }), false);
    assert.equal(variantPurchasable({ delivery_mode: "instant", stock_state: "in_stock" }), true);
  });
});

describe("variant max quantity", () => {
  it("uses max_quantity from the API, capped at the global order limit", () => {
    assert.equal(variantMaxQuantity({ delivery_mode: "instant", max_quantity: 40 }), 40);
    assert.equal(variantMaxQuantity({ delivery_mode: "instant", max_quantity: 9_000 }), 5_000);
    assert.equal(variantMaxQuantity({ delivery_mode: "manual", max_quantity: 5_000 }), 5_000);
  });

  it("falls back to stock_count for instant packages and the cap otherwise", () => {
    assert.equal(variantMaxQuantity({ delivery_mode: "instant", stock_count: 12 }), 12);
    assert.equal(variantMaxQuantity({ delivery_mode: "instant", stock_count: 0 }), 1);
    assert.equal(variantMaxQuantity({ delivery_mode: "manual" }), 5_000);
    assert.equal(variantMaxQuantity(null), 5_000);
  });
});

describe("product stock state", () => {
  it("rolls variants up and ranks products for sorting", () => {
    assert.equal(productStockState([]), "unknown");
    assert.equal(productStockState([{ delivery_mode: "instant", stock_state: "out" }]), "out");
    assert.equal(productStockState([{ delivery_mode: "instant", stock_state: "out" }, { delivery_mode: "manual", stock_state: "manual" }]), "manual");
    assert.equal(productStockState([{ delivery_mode: "instant", stock_state: "low" }, { delivery_mode: "instant", stock_state: "in_stock" }]), "in_stock");
    assert.equal(productStockState([{ delivery_mode: "instant", stock_state: "in_stock", is_active: false }]), "unknown");
    assert.ok(stockRank([{ stock_state: "in_stock" }]) > stockRank([{ stock_state: "low" }]));
    assert.ok(stockRank([{ stock_state: "manual" }]) > stockRank([{ stock_state: "out" }]));
  });
});
