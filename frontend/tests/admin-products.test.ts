import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_QUERY,
  activeFilterCount,
  bulkResultMessage,
  describeActivity,
  listQueryToParams,
  parseListQuery,
  sortParams,
  statusActionsFor,
  updateQuery,
} from "../features/admin-products/model.ts";

describe("admin products list query", () => {
  it("round-trips filters through the URL and drops defaults", () => {
    const query = { ...DEFAULT_QUERY, q: "facebook", status: "needs_setup" as const, seller: "a@b.c", categoryId: 7, sort: "revenue" as const, page: 3, size: 50 };
    const params = listQueryToParams(query);
    assert.equal(params.toString(), "q=facebook&status=needs_setup&seller=a%40b.c&category_id=7&sort=revenue&page=3&size=50");
    assert.deepEqual(parseListQuery(params), query);
    assert.equal(listQueryToParams(DEFAULT_QUERY).toString(), "");
  });

  it("falls back to defaults for unknown or unsafe values", () => {
    const parsed = parseListQuery(new URLSearchParams("status=deleted&sort=bogus&page=-2&size=7&category_id=abc"));
    assert.deepEqual(parsed, DEFAULT_QUERY);
  });

  it("resets to page 1 whenever a filter changes, but not when paging", () => {
    const onPage4 = { ...DEFAULT_QUERY, page: 4 };
    assert.equal(updateQuery(onPage4, { status: "paused" }).page, 1);
    assert.equal(updateQuery(onPage4, { page: 5 }).page, 5);
    assert.equal(activeFilterCount({ ...DEFAULT_QUERY, q: "x", provider: "TopProxy" }), 2);
    assert.deepEqual(sortParams("title"), { sortBy: "title", sortDir: "asc" });
  });
});

describe("admin products actions", () => {
  it("explains bulk results, including products skipped for missing setup", () => {
    assert.deepEqual(bulkResultMessage({ updated: [1, 2], skipped: [] }, "pause"), { tone: "good", text: "Đã tạm dừng 2 sản phẩm." });
    assert.deepEqual(
      bulkResultMessage({ updated: [1], skipped: [{ id: 2, reason: "needs_setup" }, { id: 3, reason: "unchanged" }] }, "activate"),
      { tone: "warn", text: "Đã mở bán 1 sản phẩm · 1 sản phẩm chưa thiết lập xong nên chưa mở bán · 1 sản phẩm đã ở trạng thái đó." },
    );
    assert.equal(bulkResultMessage({ updated: [], skipped: [{ id: 2, reason: "needs_setup" }] }, "activate").tone, "bad");
    assert.equal(bulkResultMessage({ updated: [], skipped: [] }, "draft").text, "Không có sản phẩm nào thay đổi.");
  });

  it("never offers the status a product already has", () => {
    assert.deepEqual(statusActionsFor("active").map((a) => a.action), ["pause", "draft", "suspend"]);
    const suspended = statusActionsFor("suspended");
    assert.deepEqual(suspended.map((a) => a.action), ["activate", "pause", "draft"]);
    assert.equal(suspended[0].label, "Mở khoá & bán lại");
  });

  it("turns audit rows into readable history lines", () => {
    const base = { id: 1, actor_email: "admin@x", created_at: "2026-09-23T10:00:00Z" };
    assert.deepEqual(
      describeActivity({ ...base, event: "admin_product_status_changed", details: { from: "active", to: "suspended", reason: "Vi phạm" } }),
      { title: "Đổi trạng thái", detail: "Đang bán → Bị khoá · Lý do: Vi phạm" },
    );
    assert.deepEqual(
      describeActivity({ ...base, event: "admin_product_category_changed", details: { from: 1, to: 2, bulk: true } }, (id) => (id === 2 ? "Proxy" : undefined)),
      { title: "Đổi danh mục", detail: "#1 → Proxy · thao tác hàng loạt" },
    );
    assert.deepEqual(
      describeActivity({ ...base, event: "admin_product_content_updated", details: { fields: ["title", "description"], locale: "en" } }),
      { title: "Sửa nội dung", detail: "tên, mô tả (EN)" },
    );
  });
});
