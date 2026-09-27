import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { orderTimeline } from "../features/buyer-orders/model.ts";

const order = (status: string, extra: Record<string, string | null> = {}) => ({
  status, created_at: "2026-09-27T10:00:00Z", delivered_at: null, completed_at: null, escrow_expires_at: "2026-09-30T10:00:00Z", ...extra,
}) as never;

describe("buyer order timeline", () => {
  it("walks paid → delivered → protection → completed with times", () => {
    const pending = orderTimeline(order("processing"), false)!;
    assert.deepEqual(pending.map((s) => s.state), ["done", "current", "next", "next"]);
    const delivered = orderTimeline(order("delivered", { delivered_at: "2026-09-27T10:01:00Z" }), false)!;
    assert.deepEqual(delivered.map((s) => s.state), ["done", "done", "current", "next"]);
    assert.equal(delivered[1].at, "2026-09-27T10:01:00Z");
    assert.equal(delivered[2].until, "2026-09-30T10:00:00Z");
    const done = orderTimeline(order("completed", { delivered_at: "2026-09-27T10:01:00Z", completed_at: "2026-09-28T09:00:00Z" }), false)!;
    assert.deepEqual(done.map((s) => s.state), ["done", "done", "done", "done"]);
    assert.equal(done[3].at, "2026-09-28T09:00:00Z");
  });

  it("flags the protection step during a dispute and hides for refunds", () => {
    assert.equal(orderTimeline(order("delivered"), true)![2].state, "attention");
    assert.equal(orderTimeline(order("refunded"), false), null);
    assert.equal(orderTimeline(order("cancelled"), false), null);
  });
});
