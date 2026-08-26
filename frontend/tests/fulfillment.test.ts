import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fulfillmentFromOrder, fulfillmentFromStrategy } from "../lib/fulfillment.ts";

describe("Fulfillment labels", () => {
  it("maps pricing strategy to what the buyer receives", () => {
    assert.equal(fulfillmentFromStrategy(null), "inventory");
    assert.equal(fulfillmentFromStrategy("fixed"), "inventory");
    assert.equal(fulfillmentFromStrategy("credit"), "api");
    assert.equal(fulfillmentFromStrategy("task"), "task");
    assert.equal(fulfillmentFromStrategy("config"), "proxy");
  });

  it("labels orders from pricing_strategy or task rows, not delivered_data", () => {
    assert.equal(fulfillmentFromOrder({ variant_id: 3, product_id: null }), "inventory");
    assert.equal(fulfillmentFromOrder({ variant_id: null, product_id: 9, pricing_strategy: "credit" }), "api");
    assert.equal(fulfillmentFromOrder({ variant_id: null, product_id: 9, pricing_strategy: "task" }), "task");
    assert.equal(fulfillmentFromOrder({ variant_id: null, product_id: 9, tasks: [{ id: 1 }] }), "task");
    assert.equal(fulfillmentFromOrder({ variant_id: null, product_id: 9 }), "service");
  });
});
