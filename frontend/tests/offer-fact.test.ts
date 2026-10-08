import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { offerFact } from "../features/catalog/model/offer-fact.ts";

const instant = (stock_count: number, stock_state?: string) => ({ delivery_mode: "instant", stock_count, stock_state, is_active: true });

describe("offerFact", () => {
  it("sums the units of every stocked package", () => {
    assert.deepEqual(offerFact({ variants: [instant(1000, "in_stock")] }), { kind: "stock", count: 1000, low: false });
    assert.deepEqual(
      offerFact({ variants: [instant(10, "low"), instant(11, "in_stock"), instant(0, "out")] }),
      { kind: "stock", count: 21, low: false },
    );
    assert.deepEqual(offerFact({ variants: [instant(4, "low")] }), { kind: "stock", count: 4, low: true });
  });

  it("ignores paused packages and reports a sold-out offer", () => {
    assert.deepEqual(offerFact({ variants: [instant(0, "out"), { ...instant(50, "in_stock"), is_active: false }] }), { kind: "out" });
  });

  it("leads made-to-order packages with the fastest promise", () => {
    const fact = offerFact({ variants: [
      { delivery_mode: "manual", stock_state: "manual", sla_hours: 48 },
      { delivery_mode: "manual", stock_state: "manual", sla_hours: 24 },
    ] });
    assert.deepEqual(fact, { kind: "manual", slaHours: 24, left: null });
  });

  it("adds what limited made-to-order packages still take on", () => {
    const fact = offerFact({ variants: [
      { delivery_mode: "manual", stock_state: "manual", stock_count: 7, sla_hours: 12 },
      { delivery_mode: "manual", stock_state: "out", stock_count: 0, sla_hours: 6 },
    ] });
    assert.deepEqual(fact, { kind: "manual", slaHours: 12, left: 7 });
    assert.deepEqual(
      offerFact({ variants: [{ delivery_mode: "manual", stock_state: "out", stock_count: 0, sla_hours: 6 }] }),
      { kind: "out" },
    );
  });

  it("reads proxy plans as a duration range with display names", () => {
    const fact = offerFact({
      pricing_strategy: "config",
      pricing_params: {
        plan_prices: { "HTTP|FPT|3": 3000, "HTTP|VNPT|30": 18000, "SOCKS5|FPT|7": 7000, "HTTP|Off|90": 0 },
        network_display: { FPT: "FPT Telecom" },
      },
    });
    assert.deepEqual(fact, { kind: "duration", minDays: 3, maxDays: 30, options: ["FPT Telecom", "VNPT"] });
  });

  it("reads API credit packages as a request range, skipping disabled ones", () => {
    const fact = offerFact({
      pricing_strategy: "credit",
      pricing_params: { packages: [{ size: 100 }, { size: 1500, active: false }, { size: 500 }] },
    });
    assert.deepEqual(fact, { kind: "requests", min: 100, max: 500 });
  });

  it("falls back to nothing when there is nothing to lead with", () => {
    assert.deepEqual(offerFact({}), { kind: "none" });
    assert.deepEqual(offerFact({ pricing_strategy: "config", pricing_params: { plan_prices: {} } }), { kind: "none" });
  });
});
