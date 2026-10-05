import assert from "node:assert/strict";
import test from "node:test";

import { adminBellBadge, isOverdue, waitLabel } from "../features/admin-notifications/model.ts";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("badge counts unread alert groups, dot only for queues with nothing unread", () => {
  assert.deepEqual(adminBellBadge(3, 10), { count: 3, dot: false });
  assert.deepEqual(adminBellBadge(0, 4), { count: 0, dot: true });
  assert.deepEqual(adminBellBadge(0, 0), { count: 0, dot: false });
});

test("waitLabel reads minutes, hours, then days", () => {
  assert.equal(waitLabel(ago(10_000), NOW), "1 phút");
  assert.equal(waitLabel(ago(18 * 60_000), NOW), "18 phút");
  assert.equal(waitLabel(ago(26 * 3_600_000), NOW), "26 giờ");
  assert.equal(waitLabel(ago(3 * 86_400_000), NOW), "3 ngày");
});

test("a queue is overdue after 24 hours", () => {
  assert.equal(isOverdue(ago(23 * 3_600_000), NOW), false);
  assert.equal(isOverdue(ago(24 * 3_600_000), NOW), true);
});
