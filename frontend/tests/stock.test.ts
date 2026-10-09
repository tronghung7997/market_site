import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MANUAL_STOCK_CEILING,
  manualStockLeft,
  parseManualStock,
  productManualLeft,
  productStockCount,
  productAvailability,
  productPurchasable,
  productStockState,
  stockRank,
  variantMaxQuantity,
  variantOutOfStock,
  variantPurchasable,
  variantStockState,
  variantUnavailable,
} from "../lib/stock.ts";
import { effectiveMinPrice } from "../lib/pricing-display.ts";

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

describe("made-to-order limits", () => {
  const unlimited = { delivery_mode: "manual", stock_state: "manual", max_quantity: 5000 };
  const limited = { delivery_mode: "manual", stock_state: "manual", stock_count: 12, max_quantity: 12 };
  const soldOut = { delivery_mode: "manual", stock_state: "out", stock_count: 0, max_quantity: 0 };

  it("reads the seller's limit from storefront and management payloads", () => {
    assert.equal(manualStockLeft(unlimited), null);
    assert.equal(manualStockLeft({ ...unlimited, stock_count: 0 }), null, "management payloads send 0 for no limit");
    assert.equal(manualStockLeft(limited), 12);
    assert.equal(manualStockLeft(soldOut), 0);
    assert.equal(manualStockLeft({ delivery_mode: "instant", stock_state: "in_stock", stock_count: 9 }), null);
  });

  it("a sold-out limited package is out and caps the order form at 0", () => {
    assert.equal(variantOutOfStock(soldOut), true);
    assert.equal(variantMaxQuantity(limited), 12);
    assert.equal(productStockState([soldOut]), "out");
    assert.equal(productStockState([soldOut, unlimited]), "manual");
  });

  it("counts limited made-to-order units next to instant stock", () => {
    const instant = { delivery_mode: "instant", stock_state: "in_stock", stock_count: 40 };
    assert.equal(productStockCount([limited]), 12);
    assert.equal(productStockCount([instant, limited, soldOut]), 52);
    assert.equal(productStockCount([unlimited]), 0);
    assert.equal(productStockCount([{ ...limited, is_active: false }]), 0);
  });

  it("sums a product's made-to-order limits only when every open package has one", () => {
    assert.equal(productManualLeft([limited, { ...limited, stock_count: 3 }]), 15);
    assert.equal(productManualLeft([limited, unlimited]), null);
    assert.equal(productManualLeft([soldOut]), null, "nothing open to take orders");
    assert.equal(productManualLeft([{ delivery_mode: "instant", stock_state: "in_stock", stock_count: 4 }]), null);
  });
});

describe("made-to-order limit input", () => {
  it("reads blank as no limit and clamps typed numbers", () => {
    assert.equal(parseManualStock(""), null);
    assert.equal(parseManualStock("  "), null);
    assert.equal(parseManualStock("0"), 0);
    assert.equal(parseManualStock("12.7"), 12);
    assert.equal(parseManualStock("-4"), 0);
    assert.equal(parseManualStock("99999999"), MANUAL_STOCK_CEILING);
  });
});

describe("made-to-order and paused packages", () => {
  const manual = { delivery_mode: "manual", stock_state: "manual", is_active: true };
  const dry = { delivery_mode: "instant", stock_state: "out", is_active: true };
  const paused = { delivery_mode: "instant", stock_state: "paused", is_active: true };

  it("never reads a made-to-order package as out of stock", () => {
    assert.equal(variantOutOfStock(manual), false);
    assert.equal(variantPurchasable(manual), true);
    // Management payloads: no state, no count — still made to order.
    assert.equal(variantPurchasable({ delivery_mode: "manual", stock_count: 0 }), true);
  });

  it("keeps a dry instant package blocked", () => {
    assert.equal(variantOutOfStock(dry), true);
    assert.equal(variantUnavailable(dry), true);
    assert.equal(variantPurchasable({ delivery_mode: "instant", stock_count: 0 }), false);
  });

  it("reads a paused supplier package as unavailable but not out of stock", () => {
    assert.equal(variantStockState(paused), "paused");
    assert.equal(variantOutOfStock(paused), false);
    assert.equal(variantUnavailable(paused), true);
  });

  it("shows a product as out of stock only when no package can be ordered", () => {
    assert.equal(productStockState([dry, manual]), "manual");
    assert.equal(productStockState([dry, paused]), "paused");
    assert.equal(productStockState([dry, dry]), "out");
  });

  it("prefers the backend availability and treats provider products as automatic", () => {
    assert.equal(productAvailability({ availability: "manual", variants: [dry] }), "manual");
    assert.equal(productAvailability({ availability: "paused", pricing_strategy: "config" }), "paused");
    assert.equal(productAvailability({ pricing_strategy: "config", variants: [] }), "auto");
    assert.equal(productAvailability({ variants: [dry, manual] }), "manual");
    assert.equal(productAvailability({ availability: "bogus", variants: [dry] }), "out");
    assert.equal(productPurchasable("manual"), true);
    assert.equal(productPurchasable("auto"), true);
    assert.equal(productPurchasable("paused"), false);
    assert.equal(productPurchasable("out"), false);
  });

  it("prices a card from the packages a buyer can order", () => {
    const cheapDry = { ...dry, price: 25_000 };
    assert.equal(effectiveMinPrice({ variants: [cheapDry, { ...manual, price: 290_000 }] }), 290_000);
    // Nothing orderable: still show the cheapest price.
    assert.equal(effectiveMinPrice({ variants: [cheapDry, { ...dry, price: 59_000 }] }), 25_000);
  });
});
