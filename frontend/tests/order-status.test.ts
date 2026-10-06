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

test("open dispute overlay shows the dispute while the order stays delivered", () => {
  const delivered = { status: "delivered", has_dispute: true, protection: { status: "dispute_open" as const } };
  assert.equal(hasOpenDispute(delivered), true);
  assert.equal(displayOrderStatus(delivered, "vi").label, "Bạn đang khiếu nại");
  assert.equal(displayOrderStatus({ status: "delivered" }, "vi").label, "Shop đã giao");
  assert.equal(displayOrderStatus({ status: "refunded", has_dispute: false }, "vi").label, "Đã hoàn tiền cho bạn");
});

test("the seller reads the same order from their side", () => {
  const disputed = { status: "delivered", has_dispute: true };
  assert.equal(displayOrderStatus(disputed, "vi", "seller").label, "Bị khiếu nại");
  assert.equal(displayOrderStatus({ status: "delivered" }, "vi", "seller").label, "Đã giao khách");
  assert.equal(displayOrderStatus({ status: "completed" }, "vi", "seller").label, "Đã nhận tiền");
  assert.equal(displayOrderStatus({ status: "refunded" }, "en", "seller").label, "Refunded to buyer");
  // Every status has a label on both sides, in both languages.
  for (const side of ["buyer", "seller"] as const) {
    for (const locale of ["vi", "en"]) {
      for (const status of ["pending", "processing", "delivered", "completed", "disputed", "refunded", "cancelled"]) {
        assert.notEqual(displayOrderStatus({ status }, locale, side).label, status, `${side}/${locale}/${status}`);
      }
    }
  }
});
