import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { clampQty, maxQtyFor } from "../app/[locale]/products/[id]/purchase.ts";
import type { Variant } from "../lib/types.ts";

function variant(stock_count: number, delivery_mode: Variant["delivery_mode"]): Variant {
  return {
    id: 1,
    name: "Bulk",
    price: 1,
    stock_count,
    delivery_mode,
  } as Variant;
}

describe("product purchase quantity", () => {
  it("allows an instant order up to available stock and the global 5,000 cap", () => {
    assert.equal(maxQtyFor(variant(4_000, "instant")), 4_000);
    assert.equal(maxQtyFor(variant(8_000, "instant")), 5_000);
  });

  it("clamps manual and instant quantities to 5,000", () => {
    assert.equal(clampQty(6_000, variant(8_000, "instant")), 5_000);
    assert.equal(clampQty(6_000, variant(0, "manual")), 5_000);
  });
});
