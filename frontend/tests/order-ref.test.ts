import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { lineLabel, matchesOrderRef, normalizeOrderCode, resourceLineMap } from "../lib/order-ref.ts";

describe("order refs", () => {
  it("normalises codes in any spelling and rejects ids", () => {
    assert.equal(normalizeOrderCode("ord-3f9k2m7q"), "ORD-3F9K2M7Q");
    assert.equal(normalizeOrderCode("#3F9K2M7Q"), "ORD-3F9K2M7Q");
    assert.equal(normalizeOrderCode("12"), null);
    assert.equal(normalizeOrderCode("12345678"), null);
    assert.equal(normalizeOrderCode(""), null);
  });

  it("matches an order by code or legacy id", () => {
    const order = { id: 212, order_code: "ORD-243951DR" };
    assert.equal(matchesOrderRef(order, "ORD-243951DR"), true);
    assert.equal(matchesOrderRef(order, "#ord-243951dr"), true);
    assert.equal(matchesOrderRef(order, "212"), true);
    assert.equal(matchesOrderRef(order, "#212"), true);
    assert.equal(matchesOrderRef(order, "213"), false);
    assert.equal(matchesOrderRef(order, "ORD-ZZZZZZZZ"), false);
  });

  it("labels stock lines by position, not by resource id", () => {
    const lines = resourceLineMap([{ id: 86 }, { id: 87 }, { id: 112 }]);
    assert.deepEqual(lines, { 86: 1, 87: 2, 112: 3 });
    assert.equal(lineLabel(3), "#03");
  });
});
