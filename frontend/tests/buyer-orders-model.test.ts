import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  activeDatePreset,
  datePresetRange,
  deepLinkedOrderRef,
  deliveredDataFileName,
  DEFAULT_FILTERS,
  isExactOrderRefSearch,
  localDateString,
  ordersFiltersToQuery,
  ordersFiltersToSearch,
  parseOrdersFilters,
  maskDeliveredLine,
  nameCarriesTerm,
  tabCount,
} from "../features/buyer-orders/model.ts";

const parse = (qs: string) => parseOrdersFilters(new URLSearchParams(qs));

describe("buyer orders URL state", () => {
  it("restores page and page size from the URL (a reload keeps its place)", () => {
    const f = parse("status=awaiting_confirm&page=3&per_page=50&sort=amount_asc");
    assert.equal(f.tab, "awaiting_confirm");
    assert.equal(f.page, 3);
    assert.equal(f.perPage, 50);
    assert.equal(f.sort, "amount_asc");
  });

  it("falls back to defaults for unknown values", () => {
    const f = parse("status=nope&page=0&per_page=7&sort=random&date_from=2026-1-1");
    assert.deepEqual(f, DEFAULT_FILTERS);
  });

  it("round-trips through the query string and omits defaults", () => {
    const f = { ...DEFAULT_FILTERS, tab: "disputed" as const, search: " ORD-1 ", dateFrom: "2026-09-01", page: 2 };
    const qs = ordersFiltersToSearch(f);
    assert.equal(qs, "?status=disputed&search=ORD-1&date_from=2026-09-01&page=2");
    assert.deepEqual(parse(qs), { ...f, search: "ORD-1" });
    assert.equal(ordersFiltersToSearch(DEFAULT_FILTERS), "");
  });

  it("keeps inspector keys that the filters do not own", () => {
    const keep = new URLSearchParams("order=ORD-3F9K2M7Q&lines=1,2&review=1&stale=x");
    const qs = ordersFiltersToSearch({ ...DEFAULT_FILTERS, tab: "active" }, keep);
    const out = new URLSearchParams(qs);
    assert.equal(out.get("order"), "ORD-3F9K2M7Q");
    assert.equal(out.get("lines"), "1,2");
    assert.equal(out.get("review"), "1");
    assert.equal(out.get("status"), "active");
    assert.equal(out.has("stale"), false);
  });

  it("does not treat a notification deep link as a list search", () => {
    assert.equal(deepLinkedOrderRef(new URLSearchParams("order=ORD-3F9K2M7Q")), "ORD-3F9K2M7Q");
    assert.equal(deepLinkedOrderRef(new URLSearchParams("order_id=12")), "12");
    assert.equal(deepLinkedOrderRef(new URLSearchParams("search=%2312&resources=5")), "12");
    assert.equal(deepLinkedOrderRef(new URLSearchParams("search=%2312")), null);
    assert.equal(parse("search=%2312&lines=1").search, "");
    assert.equal(parse("search=%2312").search, "#12");
  });

  it("maps filters to the API query", () => {
    const q = ordersFiltersToQuery({ ...DEFAULT_FILTERS, tab: "deleted", search: "  ", page: 2, perPage: 10 });
    assert.deepEqual(q, { status: "deleted", search: undefined, date_from: undefined, date_to: undefined, sort: "newest", page: 2, per_page: 10 });
  });
});

describe("buyer orders helpers", () => {
  it("recognises exact order references in the search box", () => {
    assert.equal(isExactOrderRefSearch("#ORD-3F9K2M7Q"), true);
    assert.equal(isExactOrderRefSearch("ord-3f9k2m7q"), true);
    assert.equal(isExactOrderRefSearch("#212"), true);
    assert.equal(isExactOrderRefSearch("facebook"), false);
    assert.equal(isExactOrderRefSearch("3f9k2m7q"), false);
    assert.equal(isExactOrderRefSearch("#"), false);
  });

  it("builds date presets from the local calendar, not UTC", () => {
    const now = new Date(2026, 8, 17, 1, 30); // 01:30 local on 17 Sep
    assert.equal(localDateString(now), "2026-09-17");
    assert.deepEqual(datePresetRange("today", now), { dateFrom: "2026-09-17", dateTo: "2026-09-17" });
    // "7 ngày" covers 7 calendar days, today included.
    assert.deepEqual(datePresetRange("7d", now), { dateFrom: "2026-09-11", dateTo: "2026-09-17" });
    assert.deepEqual(datePresetRange("30d", now), { dateFrom: "2026-08-19", dateTo: "2026-09-17" });
    assert.deepEqual(datePresetRange("all", now), { dateFrom: "", dateTo: "" });
    assert.equal(activeDatePreset(datePresetRange("30d", now), now), "30d");
    assert.equal(activeDatePreset({ dateFrom: "2026-09-01", dateTo: "2026-09-17" }, now), "custom");
    assert.equal(activeDatePreset({ dateFrom: "", dateTo: "" }, now), "all");
  });

  it("reads tab counts from the stats payload", () => {
    const stats = { total: 9, active: 4, awaiting_confirm: 2, disputed: 1, cancelled_or_refunded: 3, total_spend: 0 };
    assert.equal(tabCount(stats, ""), 9);
    assert.equal(tabCount(stats, "awaiting_confirm"), 2);
    assert.equal(tabCount(stats, "deleted"), 3);
    assert.equal(tabCount(null, "active"), undefined);
  });

  it("names the delivery download by public code, never row id", () => {
    assert.equal(deliveredDataFileName({ order_code: "ORD-3F9K2M7Q", quantity: 100 }), "ORD-3F9K2M7Q_100.txt");
  });
});

import { orderDeadline } from "../features/buyer-orders/model.ts";

describe("buyer orders: legacy status links and deadlines", () => {
  it("maps raw statuses from notification links to the right tab", () => {
    assert.equal(parse("status=delivered").tab, "awaiting_confirm");
    assert.equal(parse("status=pending").tab, "awaiting_seller");
    assert.equal(parse("status=processing").tab, "awaiting_seller");
    assert.equal(parse("status=refunded").tab, "");
  });

  const now = Date.parse("2026-09-27T12:00:00Z");

  it("shows the protection deadline of a delivered order, urgent under 24h", () => {
    const soon = orderDeadline({ status: "delivered", escrow_expires_at: "2026-09-28T06:00:00Z", created_at: "2026-09-25T00:00:00Z" }, false, now);
    assert.equal(soon?.kind, "protection");
    assert.equal(soon?.urgent, true);
    const later = orderDeadline({ status: "delivered", escrow_expires_at: "2026-09-30T12:00:00Z", created_at: "2026-09-25T00:00:00Z" }, false, now);
    assert.equal(later?.urgent, false);
    assert.equal(orderDeadline({ status: "delivered", escrow_expires_at: "2026-09-30T12:00:00Z", created_at: "x" }, true, now), null);
  });

  it("shows a shorter dispute window first, then the protection deadline", () => {
    const order = { status: "delivered", escrow_expires_at: "2026-09-29T12:00:00Z", dispute_open_until: "2026-09-27T13:00:00Z", created_at: "2026-09-27T00:00:00Z" };
    const open = orderDeadline(order, false, now);
    assert.equal(open?.kind, "dispute");
    assert.equal(open?.at.toISOString(), "2026-09-27T13:00:00.000Z");
    assert.equal(open?.urgent, true);
    // Window over: only the hold is left to show.
    assert.equal(orderDeadline(order, false, Date.parse("2026-09-27T14:00:00Z"))?.kind, "protection");
    // Window equal to the hold (setting 0): the usual protection line.
    assert.equal(orderDeadline({ ...order, dispute_open_until: order.escrow_expires_at }, false, now)?.kind, "protection");
  });

  it("shows the shop's delivery deadline for a pending manual order", () => {
    const d = orderDeadline({ status: "pending", delivery_mode: "manual", sla_hours: 12, created_at: "2026-09-27T06:00:00Z" }, false, now);
    assert.equal(d?.kind, "delivery");
    assert.equal(d?.at.toISOString(), "2026-09-27T18:00:00.000Z");
    assert.equal(d?.urgent, false);
    assert.equal(orderDeadline({ status: "pending", delivery_mode: "instant", sla_hours: 12, created_at: "2026-09-27T06:00:00Z" }, false, now), null);
    assert.equal(orderDeadline({ status: "completed", created_at: "2026-09-27T06:00:00Z" }, false, now), null);
  });
});

describe("package label", () => {
  it("does not repeat the package word the name already starts with", () => {
    assert.equal(nameCarriesTerm("Gói 2–5 tài khoản", "gói"), true);
    assert.equal(nameCarriesTerm("  gói tháng", "Gói"), true);
    assert.equal(nameCarriesTerm("1 tháng", "gói"), false);
  });
});

describe("delivered line mask", () => {
  it("keeps the login readable and hides the rest", () => {
    assert.equal(maskDeliveredLine("user01|pass01|mail"), "user01|••••••••");
    assert.equal(maskDeliveredLine("host:8080:u:p"), "host:••••••••");
    assert.equal(maskDeliveredLine("shortkey"), "••••••••");
    assert.equal(maskDeliveredLine("sk-abcdefghijklmnop"), "sk-a••••••••");
  });
});
