import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sellerOrderDeadline, timeLeft } from "../features/seller-orders/deadline.ts";

const created = "2026-09-27T10:00:00Z";
const now = Date.parse("2026-09-27T12:00:00Z");

describe("seller order deadline", () => {
  it("counts the SLA from the order time while the shop still has to deliver", () => {
    const d = sellerOrderDeadline({ status: "processing", created_at: created, sla_hours: 6, escrow_expires_at: null }, now);
    assert.deepEqual(d, { kind: "deliver", at: new Date("2026-09-27T16:00:00Z"), overdue: false });
    const late = sellerOrderDeadline({ status: "pending", created_at: created, sla_hours: 1, escrow_expires_at: null }, now);
    assert.equal(late?.kind === "deliver" && late.overdue, true);
  });

  it("shows the payout date for a delivered order unless a dispute holds it", () => {
    const d = sellerOrderDeadline({ status: "delivered", created_at: created, escrow_expires_at: "2026-09-29T10:00:00Z" }, now);
    assert.deepEqual(d, { kind: "payout", at: new Date("2026-09-29T10:00:00Z") });
    assert.equal(sellerOrderDeadline({ status: "delivered", created_at: created, escrow_expires_at: "2026-09-29T10:00:00Z", dispute_status: "open" }, now), null);
    assert.equal(sellerOrderDeadline({ status: "completed", created_at: created, escrow_expires_at: null }, now), null);
  });

  it("rounds the time left down to days, hours or minutes", () => {
    assert.deepEqual(timeLeft(new Date(now + 50 * 3_600_000), now), { unit: "day", value: 2 });
    assert.deepEqual(timeLeft(new Date(now + 5.5 * 3_600_000), now), { unit: "hour", value: 5 });
    assert.deepEqual(timeLeft(new Date(now + 20_000), now), { unit: "minute", value: 1 });
  });
});
