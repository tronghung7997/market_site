import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { dayKind, netWithin, scheduleRows } from "../app/[locale]/seller/(dashboard)/withdrawals/escrow-schedule.ts";

const day = (date: string, net: number) => ({ date, net, gross: net, fee: 0, order_count: 1 });

describe("escrow schedule display", () => {
  it("labels today, tomorrow and later across a month end", () => {
    assert.equal(dayKind("2026-09-30", "2026-09-30"), "today");
    assert.equal(dayKind("2026-10-01", "2026-09-30"), "tomorrow");
    assert.equal(dayKind("2026-10-02", "2026-09-30"), "later");
  });

  it("scales each day against the busiest one", () => {
    const rows = scheduleRows([day("2026-09-30", 50_000), day("2026-10-01", 200_000)], "2026-09-30");
    assert.deepEqual(rows.map((r) => [r.kind, r.share]), [["today", 0.25], ["tomorrow", 1]]);
    assert.deepEqual(scheduleRows([day("2026-09-30", 0)], "2026-09-30")[0].share, 0);
  });

  it("sums what is due within a window", () => {
    const days = [day("2026-09-30", 10), day("2026-10-06", 20), day("2026-10-07", 40)];
    assert.equal(netWithin(days, "2026-09-30", 7), 30);
    assert.equal(netWithin(days, "2026-09-30", 1), 10);
  });
});
