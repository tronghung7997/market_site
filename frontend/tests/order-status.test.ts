import assert from "node:assert/strict";
import test from "node:test";

import { canOpenDispute, displayOrderStatus, hasOpenDispute } from "../lib/order-status.ts";

const now = Date.parse("2026-01-01T00:00:00Z");

test("only delivered orders within escrow can open disputes", () => {
  assert.equal(canOpenDispute("delivered", "2026-01-02T00:00:00Z", now), true);
  assert.equal(canOpenDispute("delivered", null, now), true);
  assert.equal(canOpenDispute("delivered", "2025-12-31T23:59:59Z", now), false);
  assert.equal(canOpenDispute("completed", "2026-01-02T00:00:00Z", now), false);
});

test("open dispute overlay shows Khiếu nại while the order stays delivered", () => {
  const delivered = { status: "delivered", has_dispute: true, protection: { status: "dispute_open" as const } };
  assert.equal(hasOpenDispute(delivered), true);
  assert.equal(displayOrderStatus(delivered, "vi").label, "Khiếu nại");
  assert.equal(displayOrderStatus({ status: "delivered" }, "vi").label, "Đã giao");
  assert.equal(displayOrderStatus({ status: "refunded", has_dispute: false }, "vi").label, "Đã hoàn tiền");
});
