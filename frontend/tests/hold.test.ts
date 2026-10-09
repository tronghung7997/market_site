import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { holdParts } from "../lib/hold.ts";

describe("escrow hold durations", () => {
  it("reads whole days as days and anything else as hours", () => {
    assert.deepEqual(holdParts(48), { unit: "days", count: 2 });
    assert.deepEqual(holdParts(24), { unit: "days", count: 1 });
    assert.deepEqual(holdParts(36), { unit: "hours", count: 36 });
    assert.deepEqual(holdParts(6), { unit: "hours", count: 6 });
    assert.deepEqual(holdParts(0), { unit: "hours", count: 0 });
  });
});
