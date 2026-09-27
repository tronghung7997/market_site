import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { criterionProgress, formatPct, missingCriteria, scoreBand } from "../features/seller-tier/model.ts";

describe("seller tier progress", () => {
  it("measures minimum criteria against their target", () => {
    assert.equal(criterionProgress({ key: "min_orders", value: 138, target: 200 }), 0.69);
    assert.equal(criterionProgress({ key: "min_gmv", value: 90_000_000, target: 50_000_000 }), 1);
    assert.equal(criterionProgress({ key: "min_score", value: null, target: 75 }), 0);
    assert.equal(criterionProgress({ key: "min_days", value: 5, target: 0 }), 1);
  });

  it("keeps maximum criteria full while under the limit", () => {
    assert.equal(criterionProgress({ key: "max_dispute_pct", value: 2.4, target: 3 }), 1);
    assert.equal(criterionProgress({ key: "max_dispute_pct", value: 6, target: 3 }), 0.5);
    assert.equal(criterionProgress({ key: "max_one_star_pct", value: 0, target: 5 }), 1);
  });

  it("lists only failed criteria and bands the score", () => {
    const rows = [
      { key: "min_orders", value: 1, target: 2, met: false, keep: false },
      { key: "min_score", value: null, target: 60, met: null, keep: true },
      { key: "min_days", value: 30, target: 14, met: true, keep: false },
    ] as const;
    assert.deepEqual(missingCriteria([...rows]).map((r) => r.key), ["min_orders"]);
    assert.equal(scoreBand(91), "excellent");
    assert.equal(scoreBand(72), "good");
    assert.equal(scoreBand(55), "fair");
    assert.equal(scoreBand(20), "low");
    assert.equal(formatPct(2.4, "vi"), "2,4%");
    assert.equal(formatPct(3, "en"), "3%");
  });
});
