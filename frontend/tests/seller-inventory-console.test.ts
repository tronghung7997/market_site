import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScopeTree,
  checkState,
  compactScope,
  groupPackages,
  hasActiveInventoryFilters,
  inventoryFiltersToSearch,
  maskResourceData,
  maskSample,
  parseInventoryFilters,
  parseResourceFilters,
  resourceFiltersToSearch,
  scopeSummary,
  stockBarPercent,
  DEFAULT_INVENTORY_FILTERS,
  DEFAULT_RESOURCE_FILTERS,
} from "../features/seller-inventory/model.ts";
import type { InventoryPackage } from "../lib/types.ts";

function pkg(over: Partial<InventoryPackage>): InventoryPackage {
  return {
    product_id: 1, product_title: "Facebook Clone", product_status: "active", cover_id: null, service_type: null,
    category_id: 10, category_name: "Facebook", category_parent_id: 1, category_parent_name: "Mạng xã hội", variant_id: 100, variant_name: "Full 2FA", price: 220,
    delivery_mode: "instant", is_active: true, available: 50, assigned: 5, error: 0, expired: 0, archived: 0,
    sold_30d: 5, last_restock_at: null, stock_state: "in_stock", ...over,
  };
}

test("inventory opens all product statuses and preserves explicit status filters", () => {
  const defaults = parseInventoryFilters(new URLSearchParams());
  assert.equal(defaults.productStatus, "all");
  assert.equal(hasActiveInventoryFilters(defaults), false);
  for (const productStatus of ["active", "paused"] as const) {
    const filtered = { ...defaults, productStatus };
    assert.equal(hasActiveInventoryFilters(filtered), true);
    assert.equal(inventoryFiltersToSearch(filtered), `?products=${productStatus}`);
    assert.deepEqual(parseInventoryFilters(new URLSearchParams(inventoryFiltersToSearch(filtered))), filtered);
  }
});

test("inventory filters round-trip through the URL and ignore junk", () => {
  const f = parseInventoryFilters(new URLSearchParams("tab=low&search=fb&category=3&products=all&sort=sold_desc&view=flat&inactive=show&page=4"));
  assert.deepEqual(f, { tab: "low", search: "fb", categoryIds: [3], productStatus: "all", sort: "sold_desc", grouped: false, hideInactive: false, page: 4 });
  assert.equal(inventoryFiltersToSearch(f), "?tab=low&search=fb&category=3&sort=sold_desc&view=flat&inactive=show&page=4");
  assert.deepEqual(parseInventoryFilters(new URLSearchParams("tab=nope&category=abc&sort=x&page=0")), DEFAULT_INVENTORY_FILTERS);
  assert.equal(inventoryFiltersToSearch(DEFAULT_INVENTORY_FILTERS), "");
});

test("resource filters keep a valid custom range only", () => {
  const ok = parseResourceFilters(new URLSearchParams("status=error&date=custom&from=2026-09-01&to=2026-09-14&order=with&sort=oldest&per_page=50&page=3&restock=1"));
  assert.equal(ok.datePreset, "custom");
  assert.equal(ok.from, "2026-09-01");
  assert.equal(ok.perPage, 50);
  assert.equal(ok.restock, true);
  assert.equal(resourceFiltersToSearch(ok), "?status=error&date=custom&from=2026-09-01&to=2026-09-14&order=with&sort=oldest&page=3&per_page=50&restock=1");
  const bad = parseResourceFilters(new URLSearchParams("date=custom&from=2026-09-14&to=2026-09-01&per_page=7"));
  assert.equal(bad.datePreset, "all");
  assert.equal(bad.perPage, DEFAULT_RESOURCE_FILTERS.perPage);
});

test("groupPackages folds contiguous rows and sums only active stock", () => {
  const groups = groupPackages([
    pkg({ variant_id: 1, available: 10 }),
    pkg({ variant_id: 2, available: 5, is_active: false, stock_state: "inactive", sold_30d: 3, error: 1 }),
    pkg({ variant_id: 3, product_id: 2, product_title: "Other", available: 7 }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].available, 10);
  assert.equal(groups[0].sold30d, 8);
  assert.equal(groups[0].error, 1);
  assert.deepEqual(groups[1].packages.map((p) => p.variant_id), [3]);
});

test("stockBarPercent saturates at five times the threshold", () => {
  assert.equal(stockBarPercent(0, 20), 0);
  assert.equal(stockBarPercent(1, 20), 2);
  assert.equal(stockBarPercent(50, 20), 50);
  assert.equal(stockBarPercent(500, 20), 100);
});

test("maskResourceData mirrors the server middle/edges rules", () => {
  assert.equal(maskResourceData("user|pass|2fa|mail@x.com"), "user|••••••|••••••|mail@x.com");
  assert.equal(maskResourceData("user|pass"), "user|••••••");
  assert.equal(maskResourceData("LICENSE-KEY-9901"), "LICE••••••9901");
  assert.equal(maskResourceData("short"), "sh••••••");
  assert.equal(maskSample("user|pass|2fa", "edges", "*"), "user******|2fa");
  assert.equal(maskSample("anything", "id_only", "•"), "");
  assert.equal(maskSample("anything", "none", "•"), "anything");
});

test("scope tree: tri-state checks and compact scope collapse whole nodes", () => {
  const items = [
    pkg({ variant_id: 1 }),
    pkg({ variant_id: 2, variant_name: "Cookies" }),
    pkg({ variant_id: 3, variant_name: "Old", is_active: false }),
    pkg({ variant_id: 4, product_id: 2, product_title: "Trust" }),
    pkg({ variant_id: 5, product_id: 3, product_title: "Gmail", category_id: 20, category_name: "Email", category_parent_id: null, category_parent_name: null }),
  ];
  const tree = buildScopeTree(items);
  // Facebook sits under its parent "Mạng xã hội"; Email is a root of its own.
  assert.deepEqual(tree.map((c) => c.name), ["Email", "Mạng xã hội"]);
  assert.deepEqual(tree[1].children.map((c) => c.name), ["Facebook"]);
  const fb = tree[1].children[0];
  assert.deepEqual(fb.products.map((p) => p.title), ["Facebook Clone", "Trust"]);

  const selected = new Set([1, 2, 4]);
  assert.equal(checkState([1, 2, 3], selected), "some");
  assert.equal(checkState([1, 2], selected), "all");
  assert.equal(checkState([5], selected), "none");
  assert.deepEqual(scopeSummary(tree, selected), { categories: 1, products: 2, packages: 3 });

  // Every active package of the Facebook category is selected → the child category id alone
  // (the parent "Mạng xã hội" only holds Facebook here, so it collapses further up).
  assert.deepEqual(compactScope(tree, selected, false), { variantIds: undefined, productIds: undefined, categoryIds: [1], includeInactive: undefined });
  // With inactive packages eligible, the category is partial: product Trust whole, Clone leftovers by id.
  assert.deepEqual(compactScope(tree, selected, true), { variantIds: [1, 2], productIds: [2], categoryIds: undefined, includeInactive: true });
  assert.deepEqual(compactScope(tree, new Set([5]), false), { variantIds: undefined, productIds: undefined, categoryIds: [20], includeInactive: undefined });
});

import {
  buildCsv,
  csvCell,
  defaultReportColumns,
  groupReportRows,
  moveItem,
  reportColumnsFor,
  reportGroupingsFor,
} from "../features/seller-inventory/model.ts";
import type { InventoryReportRow } from "../lib/types.ts";

function reportRow(over: Partial<InventoryReportRow>): InventoryReportRow {
  return {
    key: "1", label: "Full 2FA", sublabel: "Facebook Clone", product_id: 1, product_title: "Facebook Clone",
    category_id: 10, category_name: "Facebook", category_parent_name: "Mạng xã hội", added: 0, sold: 0, error: 0, expired: 0, archived: 0, stock: 0, revenue: 0, prev: null,
    ...over,
  };
}

test("report columns follow the grouping and keep label + metrics", () => {
  assert.deepEqual(reportColumnsFor("variant").slice(0, 4), ["index", "label", "product", "category"]);
  assert.deepEqual(reportColumnsFor("product").slice(0, 3), ["index", "label", "category"]);
  assert.deepEqual(reportColumnsFor("day").slice(0, 3), ["index", "label", "added"]);
  assert.deepEqual(defaultReportColumns("category"), ["index", "label", "added", "sold", "error", "expired", "stock"]);
  assert.deepEqual(reportGroupingsFor("variant"), ["none", "product", "category"]);
  assert.deepEqual(reportGroupingsFor("week"), ["none"]);
});

test("groupReportRows folds rows by product/category with subtotals, sold-first", () => {
  const rows = [
    reportRow({ key: "1", sold: 2, stock: 5 }),
    reportRow({ key: "2", label: "Cookies", sold: 9, stock: 1 }),
    reportRow({ key: "3", label: "UID", product_id: 2, product_title: "Trust", sold: 4 }),
    reportRow({ key: "4", label: "Session", product_id: 3, product_title: "Gmail", category_id: 20, category_name: "Email", sold: 7 }),
  ];
  const flat = groupReportRows(rows, "none");
  assert.equal(flat.length, 1);
  assert.equal(flat[0].totals.sold, 22);

  const byProduct = groupReportRows(rows, "product");
  assert.deepEqual(byProduct.map((b) => [b.label, b.rows.length, b.totals.sold]), [["Facebook Clone", 2, 11], ["Gmail", 1, 7], ["Trust", 1, 4]]);
  const byCategory = groupReportRows(rows, "category");
  assert.deepEqual(byCategory.map((b) => [b.label, b.totals.sold, b.totals.stock]), [["Mạng xã hội › Facebook", 15, 6], ["Mạng xã hội › Email", 7, 0]]);
});

test("moveItem reorders and csv helpers quote correctly", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], 5, 0), ["a", "b"]);
  assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(buildCsv([["STT", "Phân loại"], [1, "Full 2FA"]]), "STT,Phân loại\r\n1,Full 2FA");
});

import { buildCategoryTree, compactCategorySelection, expandCategorySelection, categorySelectionLabel } from "../features/seller-inventory/model.ts";

test("category tree: parent ticks its branch and compacts back to the parent id", () => {
  const tree = buildCategoryTree([
    { id: 7, name: "Facebook", parent_id: 1, parent_name: "Mạng xã hội", count: 4 },
    { id: 6, name: "Telegram", parent_id: 1, parent_name: "Mạng xã hội", count: 2 },
    { id: 9, name: "Dịch vụ Cloud", parent_id: null, parent_name: null, count: 8 },
    { id: 1, name: "Mạng xã hội", parent_id: null, parent_name: null, count: 1 },   // products filed directly under the parent
  ]);
  assert.deepEqual(tree.map((n) => [n.name, n.count, n.children.map((c) => c.name)]), [["Mạng xã hội", 7, ["Facebook", "Telegram"]], ["Dịch vụ Cloud", 8, []]]);
  assert.deepEqual([...expandCategorySelection(tree, [1])].sort(), [1, 6, 7]);
  assert.deepEqual(compactCategorySelection(tree, new Set([1, 6, 7])), [1]);
  assert.deepEqual(compactCategorySelection(tree, new Set([7, 9])), [7, 9]);
  assert.deepEqual(categorySelectionLabel(tree, [1, 9]), ["Mạng xã hội", "Dịch vụ Cloud"]);
  assert.deepEqual(categorySelectionLabel(tree, [6]), ["Telegram"]);
});
