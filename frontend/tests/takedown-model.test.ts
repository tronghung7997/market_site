import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ADMIN_FILTERS,
  adminFiltersToSearch,
  applyAdminFilters,
  bucketOf,
  canCancel,
  countByBucket,
  filterRequests,
  isTerminal,
  maskEmail,
  openableUrl,
  paginate,
  parseAdminFilters,
  parseListTab,
  parsePage,
  parsePerPage,
  platformOf,
  shortLink,
  sortRequests,
  stateSince,
  statusView,
  stepStates,
  warrantyLeft,
  type TakedownAdminRequest,
  type TakedownRequest,
} from "../features/takedown/model.ts";

function request(patch: Partial<TakedownAdminRequest> = {}): TakedownAdminRequest {
  return {
    code: "TD-AAAAAAAA",
    url: "https://www.tiktok.com/@a/video/1",
    note: null,
    service: "article_copyright",
    platform: "tiktok",
    warranty_hours: 24,
    status: "review",
    price: null,
    warranty_until: null,
    evidence_live_url: null,
    evidence_dead_url: null,
    evidence: [],
    created_at: "2026-10-01T00:00:00.000Z",
    quoted_at: null, accepted_at: null, processing_at: null, completed_at: null, finished_at: null,
    refunded: false,
    buyer_email: "buyer@example.com",
    partner_order_id: 1, partner_status: "pending_review", partner_price: null, order_code: null,
    needs_sync: false, sync_error: null, last_synced_at: null, updated_at: "2026-10-01T00:00:00.000Z", partner_refunded_at: null,
    ...patch,
  };
}

const params = (q: string) => new URLSearchParams(q);

describe("the link", () => {
  it("guesses the platform for the icon without rejecting anything", () => {
    assert.equal(platformOf("https://www.tiktok.com/@shop/video/1"), "tiktok");
    assert.equal(platformOf("vt.tiktok.com/ZSabc/"), "tiktok");
    assert.equal(platformOf("https://fb.watch/abc/"), "facebook");
    assert.equal(platformOf("https://shopee.vn/item-1"), null);
    assert.equal(platformOf("not a link"), null);
  });

  it("only offers to open real web links", () => {
    assert.equal(openableUrl("tiktok.com/@a"), "https://tiktok.com/@a");
    assert.equal(openableUrl("không phải link"), null);
    assert.equal(openableUrl(null), null);
    assert.equal(shortLink("https://www.tiktok.com/@a"), "tiktok.com/@a");
    assert.equal(maskEmail("buyer@example.com"), "bu***@example.com");
    assert.equal(maskEmail(null), "—");
  });
});

describe("steps and status", () => {
  it("maps backend statuses onto five buyer steps", () => {
    assert.deepEqual(stepStates(request({ status: "review" })), ["current", "todo", "todo", "todo", "todo"]);
    assert.deepEqual(stepStates(request({ status: "quoted" })), ["waiting_you", "todo", "todo", "todo", "todo"]);
    assert.deepEqual(stepStates(request({ status: "started" })), ["done", "current", "todo", "todo", "todo"]);
    assert.deepEqual(stepStates(request({ status: "warranty_claim" })), ["done", "done", "done", "current", "todo"]);
    assert.deepEqual(stepStates(request({ status: "done" })), ["done", "done", "done", "done", "done"]);
    assert.deepEqual(stepStates(request({ status: "failed" })), ["done", "done", "failed", "closed", "closed"]);
    assert.deepEqual(stepStates(request({ status: "failed", completed_at: "x" })), ["done", "done", "done", "done", "failed"]);
    assert.deepEqual(stepStates(request({ status: "declined" })), ["failed", "closed", "closed", "closed", "closed"]);
    assert.deepEqual(stepStates(request({ status: "cancelled", accepted_at: "x" })), ["done", "failed", "closed", "closed", "closed"]);
  });

  it("uses global tone semantics and knows terminal states", () => {
    assert.deepEqual(statusView(request({ status: "quoted" })), { key: "quoted", tone: "warn" });
    assert.deepEqual(statusView(request({ status: "failed" })), { key: "failed", tone: "bad" });
    assert.deepEqual(statusView(request({ status: "warranty_claim" })), { key: "warrantyClaim", tone: "warn" });
    assert.equal(isTerminal("done"), true);
    assert.equal(isTerminal("warranty"), false);
    assert.equal(canCancel(request({ status: "started" })), true);
    assert.equal(canCancel(request({ status: "processing" })), false);
  });

  it("buckets and dates", () => {
    assert.deepEqual(
      countByBucket([request({ status: "review" }), request({ status: "started" }), request({ status: "warranty_claim" }), request({ status: "declined" })]),
      { review: 1, quoted: 0, processing: 1, warranty: 1, finished: 1 },
    );
    assert.equal(bucketOf("cancelled"), "finished");
    assert.equal(stateSince(request({ status: "quoted", quoted_at: "2026-10-02T00:00:00Z" })), "2026-10-02T00:00:00Z");
    const left = warrantyLeft(request({ status: "warranty", warranty_until: "2026-10-02T01:02:03.000Z" }), new Date("2026-10-01T00:00:00Z"));
    assert.deepEqual(left, { hours: 25, minutes: 2, seconds: 3 });
    assert.equal(warrantyLeft(request({ status: "processing" }), new Date()), null);
  });
});

describe("pagination and lists", () => {
  it("parses and paginates defensively", () => {
    assert.equal(parsePage("0"), 1);
    assert.equal(parsePerPage("13"), 20);
    const items = Array.from({ length: 23 }, (_, i) => i);
    assert.deepEqual(paginate(items, 9, 10).rows, [20, 21, 22]);
    assert.equal(parseListTab("bogus"), "all");
  });

  it("filters buyer lists and floats quotes up", () => {
    const rows: TakedownRequest[] = [
      request({ code: "TD-1", status: "processing", created_at: "2026-10-03T00:00:00Z" }),
      request({ code: "TD-2", status: "quoted", created_at: "2026-10-01T00:00:00Z", url: "https://facebook.com/x" }),
      request({ code: "TD-3", status: "review", created_at: "2026-10-02T00:00:00Z", note: "kênh reup" }),
    ];
    assert.deepEqual(sortRequests(rows).map((r) => r.code), ["TD-2", "TD-1", "TD-3"]);
    assert.deepEqual(filterRequests(rows, "quoted", "").map((r) => r.code), ["TD-2"]);
    assert.deepEqual(filterRequests(rows, "all", "REUP").map((r) => r.code), ["TD-3"]);
  });

  it("round-trips admin filters and searches buyer emails", () => {
    assert.equal(adminFiltersToSearch(DEFAULT_ADMIN_FILTERS), "");
    const f = { ...DEFAULT_ADMIN_FILTERS, tab: "all" as const, platform: "other" as const, q: "brand", sort: "newest" as const, page: 2, perPage: 50 };
    assert.deepEqual(parseAdminFilters(params(adminFiltersToSearch(f).slice(1))), f);
    const rows = [
      request({ code: "TD-A", url: "https://shopee.vn/x", buyer_email: "brand@congty.vn" }),
      request({ code: "TD-B", url: "https://www.tiktok.com/@b" }),
    ];
    const base = { tab: "all" as const, platform: "all" as const, q: "", sort: "waiting" as const };
    assert.deepEqual(applyAdminFilters(rows, { ...base, platform: "other" }).map((r) => r.code), ["TD-A"]);
    assert.deepEqual(applyAdminFilters(rows, { ...base, q: "congty" }).map((r) => r.code), ["TD-A"]);
  });
});
