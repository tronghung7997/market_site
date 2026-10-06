import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rangeParams } from "../features/affiliate/model.ts";

describe("affiliate range params", () => {
  it("counts presets in the viewer's days, today included", () => {
    // 05:30 local on 6 Oct: in Vietnam this is still 5 Oct in UTC.
    const now = new Date(2026, 9, 6, 5, 30);
    assert.deepEqual(rangeParams("7d", {}, now), { date_from: "2026-09-30" });
    assert.deepEqual(rangeParams("30d", {}, now), { date_from: "2026-09-07" });
    assert.deepEqual(rangeParams("all", {}, now), {});
  });

  it("puts a reversed custom range back in order", () => {
    assert.deepEqual(rangeParams("custom", { date_from: "2026-10-06", date_to: "2026-10-01" }), { date_from: "2026-10-01", date_to: "2026-10-06" });
    assert.deepEqual(rangeParams("custom", { date_from: "2026-10-01" }), { date_from: "2026-10-01", date_to: undefined });
  });
});
