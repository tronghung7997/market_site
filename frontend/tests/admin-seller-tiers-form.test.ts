import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { changedCount, fromForm, parseNumber, scorePoints, toForm } from "../features/admin-seller-tiers/form.ts";
import type { SellerTrustConfig } from "../lib/types.ts";

const empty = { min_gmv: null, min_orders: null, min_days: null, max_dispute_pct: null, max_one_star_pct: null, min_score: null };
const CFG: SellerTrustConfig = {
  window_days: 90,
  min_orders_for_score: 10,
  score: { dispute: { points: 40, zero_at_pct: 10 }, one_star: { points: 30, zero_at_pct: 20 }, gmv: { points: 30, full_at: 100_000_000 } },
  criteria: { verified: { ...empty, min_gmv: 5_000_000, max_dispute_pct: 5 }, trusted: { ...empty }, enterprise: { ...empty } },
  auto: { enabled: true, grace_days: 14, dispute_min_orders: 20 },
};

describe("seller tier config form", () => {
  it("round-trips a saved config unchanged", () => {
    const { config, errors } = fromForm(toForm(CFG));
    assert.deepEqual(errors, {});
    assert.deepEqual(config, CFG);
    assert.equal(changedCount(toForm(CFG), CFG), 0);
  });

  it("accepts a decimal comma and keeps emptied criteria as 'not checked'", () => {
    assert.equal(parseNumber("2,5"), 2.5);
    const form = toForm(CFG);
    form.criteria.verified.max_dispute_pct = "2,5";
    form.criteria.verified.min_gmv = "";
    const { config } = fromForm(form);
    assert.equal(config?.criteria.verified.max_dispute_pct, 2.5);
    assert.equal(config?.criteria.verified.min_gmv, null);
    assert.equal(changedCount(form, CFG), 2);
  });

  it("blocks required blanks, out-of-range values and a score total other than 100", () => {
    const form = toForm(CFG);
    form.window_days = "";
    form.dispute_points = "50";
    form.criteria.trusted.min_orders = "1.5";
    const { config, errors } = fromForm(form);
    assert.equal(config, null);
    assert.equal(errors.window_days, "Bắt buộc");
    assert.match(errors.points ?? "", /110/);
    assert.equal(errors["criteria.trusted.min_orders"], "Phải là số nguyên");
    assert.equal(scorePoints(form), 110);
  });

  it("edits the automatic job knobs and fills them for configs saved before it existed", () => {
    const { auto: _auto, ...legacy } = CFG;
    assert.deepEqual(fromForm(toForm(legacy)).config?.auto, { enabled: true, grace_days: 14, dispute_min_orders: 20 });
    const form = toForm(CFG);
    form.auto_enabled = false;
    form.grace_days = "0";
    form.dispute_min_orders = "0";
    const { config, errors } = fromForm(form);
    assert.equal(config, null);
    assert.ok(errors.dispute_min_orders);
    form.dispute_min_orders = "30";
    assert.deepEqual(fromForm(form).config?.auto, { enabled: false, grace_days: 0, dispute_min_orders: 30 });
    assert.equal(changedCount(form, CFG), 3);
  });
});
