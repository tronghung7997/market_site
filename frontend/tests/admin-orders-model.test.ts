import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { delta, disputeRate, escrowHint, formatSpan, formatWhen, groupRuns, parseOrdersView, writeOrdersView } from "../features/admin-orders/model.ts";

const order = (id: number, buyer = 1, variant: number | null = 10, status = "delivered") => ({
  id, buyer_id: buyer, seller_id: 2, variant_id: variant, product_id: null,
  total_amount: 3000, status, created_at: `2026-10-02T09:0${id % 10}:00`,
});

describe("groupRuns", () => {
  it("folds three or more adjacent same-buyer same-item orders", () => {
    const runs = groupRuns([order(1), order(2), order(3, 1, 10, "completed"), order(4, 5)]);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].kind, "group");
    if (runs[0].kind !== "group") return;
    assert.equal(runs[0].orders.length, 3);
    assert.equal(runs[0].amount, 9000);
    assert.deepEqual(runs[0].statuses, [["delivered", 2], ["completed", 1]]);
    assert.equal(runs[0].firstAt, "2026-10-02T09:01:00");
    assert.equal(runs[1].kind, "single");
  });

  it("keeps short runs and non-adjacent repeats as single rows", () => {
    const runs = groupRuns([order(1), order(2), order(3, 5), order(4)]);
    assert.deepEqual(runs.map((r) => r.kind), ["single", "single", "single", "single"]);
  });

  it("tells different items of one buyer apart", () => {
    const runs = groupRuns([order(1), order(2, 1, 11), order(3)]);
    assert.equal(runs.filter((r) => r.kind === "group").length, 0);
  });
});

describe("time labels", () => {
  const now = new Date(2026, 9, 2, 15, 0);
  it("shows the clock today, 'Hôm qua' yesterday, day/month this year", () => {
    assert.equal(formatWhen(new Date(2026, 9, 2, 9, 5).toISOString(), now), "09:05");
    assert.equal(formatWhen(new Date(2026, 9, 1, 21, 40).toISOString(), now), "Hôm qua 21:40");
    assert.equal(formatWhen(new Date(2026, 8, 28, 9, 12).toISOString(), now), "28/9 09:12");
    assert.equal(formatWhen(new Date(2025, 8, 28).toISOString(), now), "28/9/2025");
  });

  it("formats spans and escrow hints", () => {
    assert.equal(formatSpan(45 * 60_000), "45 phút");
    assert.equal(formatSpan(3 * 3600_000), "3 giờ");
    assert.equal(formatSpan(72 * 3600_000), "3 ngày");
    assert.equal(escrowHint("delivered", new Date(2026, 9, 2, 18, 0).toISOString(), now), "trả seller sau 3 giờ");
    assert.equal(escrowHint("delivered", new Date(2026, 9, 2, 14, 0).toISOString(), now), "hết hạn giữ · chờ trả seller");
    assert.equal(escrowHint("completed", new Date(2026, 9, 2, 18, 0).toISOString(), now), null);
  });
});

describe("figures", () => {
  it("signs the change vs yesterday", () => {
    assert.deepEqual(delta(24, 16), { label: "+8", tone: "up" });
    assert.deepEqual(delta(3, 5), { label: "−2", tone: "down" });
    assert.deepEqual(delta(4, 4), { label: "=", tone: "flat" });
  });

  it("computes the dispute rate", () => {
    assert.equal(disputeRate(1, 125), "0,8%");
    assert.equal(disputeRate(0, 0), "—");
  });
});

describe("parseOrdersView / writeOrdersView", () => {
  const parse = (qs: string) => parseOrdersView(new URLSearchParams(qs));
  it("defaults to a flat list, page 1, 50 rows", () => {
    assert.deepEqual(parse(""), { pageIndex: 0, pageSize: 50, grouped: false });
  });
  it("reads page, size and grouping", () => {
    assert.deepEqual(parse("page=3&size=100&group=1"), { pageIndex: 2, pageSize: 100, grouped: true });
    assert.equal(parse("p=2").pageIndex, 1);
  });
  it("rejects junk and unsupported sizes", () => {
    assert.deepEqual(parse("page=-4&size=500&group=yes"), { pageIndex: 0, pageSize: 50, grouped: false });
    assert.equal(parse("page=abc&size=20").pageSize, 50);
  });
  it("writes only non-default values and round-trips", () => {
    const empty = new URLSearchParams();
    writeOrdersView(empty, { pageIndex: 0, pageSize: 50, grouped: false });
    assert.equal(empty.toString(), "");
    const q = new URLSearchParams();
    writeOrdersView(q, { pageIndex: 1, pageSize: 100, grouped: true });
    assert.equal(q.toString(), "page=2&size=100&group=1");
    assert.deepEqual(parse(q.toString()), { pageIndex: 1, pageSize: 100, grouped: true });
  });
});
