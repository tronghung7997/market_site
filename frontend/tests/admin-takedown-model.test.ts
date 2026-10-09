import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { adminStatusLabel, eventView, safeBackSearch, waitedLabel } from "../features/admin-takedown/model.ts";

describe("admin takedown helpers", () => {
  it("labels waiting time in minutes, hours, then days", () => {
    const now = new Date("2026-10-05T00:00:00Z").getTime();
    assert.equal(waitedLabel("2026-10-04T23:30:00Z", now), "30 phút");
    assert.equal(waitedLabel("2026-10-04T05:00:00Z", now), "19 giờ");
    assert.equal(waitedLabel("2026-10-01T00:00:00Z", now), "4 ngày");
  });

  it("words history from our side and flags events that were not applied", () => {
    assert.equal(eventView({ source: "partner", action: "complete", to_status: "in_warranty", applied: true }).label,
      "Đối tác báo đã gỡ · bắt đầu bảo hành");
    assert.equal(eventView({ source: "partner", action: "fail", to_status: "failed", applied: true }).tone, "bad");
    assert.equal(eventView({ source: "buyer", action: "accept", to_status: "started", applied: true }).label,
      "Khách chấp nhận giá · trừ số dư");
    const stray = eventView({ source: "partner", action: "accept", to_status: "awaiting_payment", applied: false });
    assert.equal(stray.tone, "warn");
    assert.match(stray.label, /chưa áp dụng/);
    assert.equal(adminStatusLabel("quoted"), "Đã báo giá · chờ khách");
  });

  it("only goes back to a list query string, never elsewhere", () => {
    assert.equal(safeBackSearch("?status=all&q=brand+x&page=2"), "?status=all&q=brand+x&page=2");
    assert.equal(safeBackSearch("https://evil.test"), "");
    assert.equal(safeBackSearch("?a=1//evil"), "");
    assert.equal(safeBackSearch(null), "");
  });
});
