import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatCriterion, missingShort, tierChangeReady, TIER_REASON_MAX } from "../features/admin-seller-tiers/model.ts";

const money = (amount: number) => `${amount.toLocaleString("vi-VN")} ₫`;

describe("admin seller tiers", () => {
  it("formats each criterion with its unit", () => {
    assert.equal(formatCriterion("min_gmv", 31_400_000, money), "31.400.000 ₫");
    assert.equal(formatCriterion("min_orders", 138, money), "138 đơn");
    assert.equal(formatCriterion("min_days", 96, money), "96 ngày");
    assert.equal(formatCriterion("max_dispute_pct", 2.4, money), "2,4%");
    assert.equal(formatCriterion("max_one_star_pct", 3.125, money), "3,1%");
    assert.equal(formatCriterion("min_score", 72, money), "72");
    assert.equal(formatCriterion("min_score", null, money), "—");
  });

  it("names the criteria still missing, skipping ones without data", () => {
    const rows = [
      { key: "min_gmv", met: false }, { key: "min_orders", met: false }, { key: "min_days", met: true }, { key: "min_score", met: null },
    ] as const;
    assert.deepEqual(missingShort([...rows]), ["doanh số", "số đơn"]);
  });

  it("asks for a new tier and a reason before saving", () => {
    assert.equal(tierChangeReady("verified", "verified", "lý do"), false);
    assert.equal(tierChangeReady("verified", "trusted", "   "), false);
    assert.equal(tierChangeReady("verified", "trusted", "Đủ 200 đơn"), true);
    assert.equal(tierChangeReady("verified", "new", "x".repeat(TIER_REASON_MAX + 1)), false);
  });
});
