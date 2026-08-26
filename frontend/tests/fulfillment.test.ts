import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fulfillmentFromOrder,
  fulfillmentFromProduct,
  fulfillmentFromStrategy,
  fulfillmentTagKey,
} from "../lib/fulfillment.ts";

describe("Fulfillment labels", () => {
  it("maps strategy and delivery mode to what the buyer receives", () => {
    assert.equal(fulfillmentFromStrategy(null).kind, "instant");
    assert.equal(fulfillmentFromStrategy("fixed").kind, "instant");
    assert.equal(fulfillmentFromStrategy("fixed", "manual", 48).kind, "sla");
    assert.equal(fulfillmentFromStrategy("fixed", "manual", 48).hours, 48);
    assert.equal(fulfillmentFromStrategy("credit").kind, "api");
    assert.equal(fulfillmentFromStrategy("task").kind, "task");
    assert.equal(fulfillmentFromStrategy("config").kind, "proxy");
  });

  it("uses product variants to split instant stock from SLA inventory", () => {
    assert.equal(fulfillmentFromProduct({
      pricing_strategy: "fixed",
      variants: [{ delivery_mode: "instant", stock_count: 3, is_active: true }],
    }).kind, "instant");
    assert.equal(fulfillmentFromProduct({
      pricing_strategy: "fixed",
      variants: [{ delivery_mode: "manual", sla_hours: 12, stock_count: 0, is_active: true }],
    }).hours, 12);
    assert.equal(fulfillmentFromProduct({ pricing_strategy: "task" }).kind, "task");
  });

  it("labels orders from pricing_strategy or task rows, not delivered_data", () => {
    assert.equal(fulfillmentFromOrder({ variant_id: 3, product_id: null }).kind, "instant");
    assert.equal(fulfillmentFromOrder({ variant_id: 3, delivery_mode: "manual", sla_hours: 6 }).kind, "sla");
    assert.equal(fulfillmentFromOrder({ variant_id: null, product_id: 9, pricing_strategy: "credit" }).kind, "api");
    assert.equal(fulfillmentFromOrder({ variant_id: null, product_id: 9, pricing_strategy: "task" }).kind, "task");
    assert.equal(fulfillmentFromOrder({ variant_id: null, product_id: 9, tasks: [{ id: 1 }] }).kind, "task");
    assert.equal(fulfillmentTagKey({ kind: "task" }, true), "fulfillment.taskPending");
  });
});
