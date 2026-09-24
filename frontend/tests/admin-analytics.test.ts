import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STATE,
  METRIC,
  bucketLabel,
  bucketTitle,
  buildInsights,
  compactMoney,
  delta,
  formatDelta,
  granularityAllowed,
  milestoneRows,
  parseState,
  seriesCsv,
  stateToSearch,
} from "../features/admin-analytics/model.ts";
import type { BusinessAnalytics, BusinessPoint, BusinessTotals } from "../lib/types.ts";

function money(over: Partial<BusinessTotals> = {}): BusinessTotals {
  return {
    orders: 0, gmv: 0, refunded: 0, net_gmv: 0, paid_orders: 0, completed: 0, cancelled: 0, open_orders: 0,
    disputed_orders: 0, refunded_orders: 0, buyers: 0, sellers: 0, new_buyers: 0, new_buyer_gmv: 0, internal_gmv: 0,
    platform_fee: 0, internal_sales: 0, affiliate_cost: 0, platform_revenue: 0, deposits: 0, withdrawals_paid: 0,
    signups: 0, withdraw_fees: 0, ...over,
  };
}

function point(date: string, end: string, over: Partial<BusinessPoint> = {}): BusinessPoint {
  return { ...money(), date, end_date: end, partial: false, ...over };
}

function analytics(over: Partial<BusinessAnalytics> = {}): BusinessAnalytics {
  return {
    range: { key: "this_month", tz: "Asia/Ho_Chi_Minh", granularity: "month", compare: "previous", from_date: "2026-09-01", to_date: "2026-09-24", days: 24, compare_from_date: "2026-08-01", compare_to_date: "2026-08-24" },
    filters: { segment: "all", seller_id: null, category_id: null, service_type: null },
    totals: money(), compare_totals: money(), series: [], compare_series: [],
    status: {}, compare_status: {}, segments: [], tiers: [], categories: [], category_tree: [], service_types: [],
    top_sellers: [], declining_sellers: [], top_products: [], heatmap: [],
    concentration: { sellers: 0, top1: 0, top5: 0, top10: 0, hhi: 0 }, compare_concentration: null, new_sellers: 0,
    ...over,
  };
}

describe("admin analytics URL state", () => {
  it("round-trips every filter and drops defaults", () => {
    const search = "?range=custom&from=2026-01-01&to=2026-06-30&g=month&cmp=custom&cfrom=2025-01-01&cto=2025-06-30&seg=internal&seller=7&cat=3&svc=proxy&tab=sellers&metric=take_rate";
    const state = parseState(new URLSearchParams(search));
    assert.equal(state.range, "custom");
    assert.equal(state.granularity, "month");
    assert.equal(state.compareFrom, "2025-01-01");
    assert.equal(state.sellerId, 7);
    assert.equal(state.metric, "take_rate");
    assert.equal(stateToSearch(state), search);
    assert.equal(stateToSearch(DEFAULT_STATE), "");
  });

  it("falls back to defaults on malformed links instead of a 400", () => {
    const state = parseState(new URLSearchParams("range=custom&from=2026-02-01&to=2026-01-01&g=hour&cmp=custom&seller=-3&svc=<x>&tab=nope"));
    assert.equal(state.range, "30d");
    assert.equal(state.granularity, "auto");
    assert.equal(state.compare, "previous");
    assert.equal(state.sellerId, undefined);
    assert.equal(state.serviceType, undefined);
    assert.equal(state.tab, "overview");
  });

  it("disables bucket sizes that would exceed the API bucket cap", () => {
    assert.equal(granularityAllowed("day", 366), true);
    assert.equal(granularityAllowed("day", 800), false);
    assert.equal(granularityAllowed("week", 800), true);
    assert.equal(granularityAllowed("auto", 1800), true);
  });
});

describe("admin analytics formatting", () => {
  it("labels buckets in their own unit", () => {
    assert.equal(bucketLabel("2026-09-22", "day"), "22/09");
    assert.equal(bucketLabel("2026-09-01", "month"), "Th9/26");
    assert.equal(bucketLabel("2026-07-01", "quarter"), "Q3/2026");
    assert.equal(bucketTitle({ date: "2026-09-21", end_date: "2026-09-27" }, "week"), "Tuần 39 (21/09 – 27/09/2026)");
    assert.equal(compactMoney(1_250_000_000), "1,3 tỷ");
    assert.equal(compactMoney(3_400_000), "3,4 tr");
  });

  it("colours a change by whether the metric is healthier up or down", () => {
    assert.equal(delta(120, 100, "up")?.tone, "good");
    assert.equal(delta(0.08, 0.05, "down")?.tone, "bad");
    assert.equal(delta(5, 0, "up")?.pct, null);
    assert.equal(delta(5, null), null);
    assert.equal(formatDelta(METRIC.refund_rate, delta(0.08, 0.05, "down")!), "+3 điểm");
    assert.equal(formatDelta(METRIC.gmv, delta(150, 100)!), "+50%");
  });
});

describe("admin analytics insights", () => {
  it("flags a GMV drop, refund spike, seller dependence and a shrinking category", () => {
    const data = analytics({
      totals: money({ gmv: 70_000_000, refunded: 6_000_000, refunded_orders: 9, orders: 120, paid_orders: 100, buyers: 40 }),
      compare_totals: money({ gmv: 100_000_000, refunded: 1_000_000, orders: 130, paid_orders: 110, buyers: 42 }),
      concentration: { sellers: 5, top1: 0.65, top5: 0.98, top10: 1, hhi: 4600 },
      top_sellers: [{ id: 9, name: "Kho A", email: null, is_internal: false, tier: "trusted", gmv: 45_500_000, gmv_prev: 50_000_000, paid_orders: 60, paid_orders_prev: 70, refunded: 0, refunded_prev: 0, disputed_orders: 0, orders: 60, cancelled: 0, buyers: 20, platform_take: 3_000_000 }],
      categories: [{ id: 4, name: "Proxy", parent_id: null, gmv: 10_000_000, gmv_prev: 30_000_000, paid_orders: 10, paid_orders_prev: 30, refunded: 0, refunded_prev: 0, disputed_orders: 0, orders: 10, cancelled: 0, buyers: 5, platform_take: 0 }],
    });
    const ids = buildInsights(data).map((i) => i.id);
    assert.deepEqual(ids.slice(0, 3).sort(), ["concentration", "gmv-drop", "refund"].sort());
    assert.ok(ids.includes("cat-4"));
    const concentration = buildInsights(data).find((i) => i.id === "concentration");
    assert.deepEqual(concentration?.action?.patch, { sellerId: 9, tab: "overview" });
  });

  it("stays quiet when nothing crosses a threshold", () => {
    const data = analytics({
      totals: money({ gmv: 100, paid_orders: 5, orders: 5, buyers: 3 }),
      compare_totals: money({ gmv: 95, paid_orders: 5, orders: 5, buyers: 3 }),
    });
    assert.deepEqual(buildInsights(data), []);
  });
});

describe("admin analytics milestones", () => {
  it("compares each bucket with the one before and with the aligned comparison bucket", () => {
    const data = analytics({
      series: [point("2026-07-01", "2026-07-31", { gmv: 100, paid_orders: 2 }), point("2026-08-01", "2026-08-31", { gmv: 150, paid_orders: 3 })],
      compare_series: [point("2025-07-01", "2025-07-31", { gmv: 80, paid_orders: 1 })],
    });
    const rows = milestoneRows(data);
    assert.equal(rows[0].prevBucket, undefined);
    assert.equal(rows[1].prevBucket?.gmv, 100);
    assert.equal(rows[0].compareValues?.aov, 80);
    assert.equal(rows[1].compareValues, undefined);
    const csv = seriesCsv(data);
    assert.ok(csv.startsWith("﻿Mốc,Từ ngày,Đến ngày,GMV"));
    assert.equal(csv.trim().split("\n").length, 3);
  });
});
