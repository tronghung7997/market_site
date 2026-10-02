import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  defaultPeriod, ledgerHref, parsePeriod, percentChange, periodAt, periodEnded, periodLabel, periodRange,
  periodToParams, shift,
} from "../features/admin-finance-report/model.ts";

// 2026-10-01 20:30 UTC = 2026-10-02 03:30 giờ VN.
const NOW = new Date("2026-10-01T20:30:00Z");

describe("finance report periods", () => {
  it("builds week (Mon–Sun), month and quarter around a day", () => {
    assert.deepEqual(periodAt("week", "2026-10-01"), { kind: "week", from: "2026-09-28", to: "2026-10-04" });
    assert.deepEqual(periodAt("month", "2026-02-15"), { kind: "month", from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(periodAt("quarter", "2026-08-20"), { kind: "quarter", from: "2026-07-01", to: "2026-09-30" });
  });

  it("steps to the previous/next period of the same length", () => {
    assert.deepEqual(shift(periodAt("month", "2026-03-31"), -1), { kind: "month", from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(shift(periodAt("quarter", "2026-01-01"), -1), { kind: "quarter", from: "2025-10-01", to: "2025-12-31" });
    assert.deepEqual(shift({ kind: "custom", from: "2026-09-01", to: "2026-09-10" }, 1), { kind: "custom", from: "2026-09-11", to: "2026-09-20" });
  });

  it("defaults to last month in Vietnam time and round-trips the URL", () => {
    assert.deepEqual(defaultPeriod(NOW), { kind: "month", from: "2026-09-01", to: "2026-09-30" });
    const p = parsePeriod(new URLSearchParams("kind=quarter&at=2026-05-09"), NOW);
    assert.deepEqual(p, { kind: "quarter", from: "2026-04-01", to: "2026-06-30" });
    assert.deepEqual(parsePeriod(periodToParams(p), NOW), p);
    assert.deepEqual(parsePeriod(new URLSearchParams("kind=custom&from=2026-09-10&to=2026-09-01"), NOW),
      { kind: "custom", from: "2026-09-10", to: "2026-09-10" });
    assert.deepEqual(parsePeriod(new URLSearchParams("kind=custom&from=2025-01-01&to=2026-12-31"), NOW).to, "2026-02-04");
    assert.deepEqual(parsePeriod(new URLSearchParams("kind=year"), NOW), defaultPeriod(NOW));
  });

  it("formats ranges, labels and ledger links", () => {
    const sep = periodAt("month", "2026-09-01");
    assert.deepEqual(periodRange(sep), { start: "2026-09-01T00:00:00+07:00", end: "2026-10-01T00:00:00+07:00" });
    assert.equal(periodLabel(sep), "Tháng 09/2026");
    assert.equal(periodLabel(periodAt("quarter", "2026-08-01")), "Quý 3/2026");
    assert.equal(periodLabel(periodAt("week", "2026-10-01")), "28/09/2026 – 04/10/2026");
    assert.equal(ledgerHref(sep, ["platform_fee"]), "/admin/ledger?period=custom&from=2026-09-01&to=2026-09-30&types=platform_fee");
    assert.equal(periodEnded(sep, NOW), true);
    assert.equal(periodEnded(periodAt("month", "2026-10-01"), NOW), false);
    assert.equal(percentChange(150, 100), 50);
    assert.equal(percentChange(5, 0), null);
  });
});
