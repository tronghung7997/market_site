import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScopeTree,
  checkState,
  compactScope,
  groupPackages,
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
    category_id: 10, category_name: "Facebook", variant_id: 100, variant_name: "Full 2FA", price: 220,
    delivery_mode: "instant", is_active: true, available: 50, assigned: 5, error: 0, expired: 0, archived: 0,
    sold_30d: 5, last_restock_at: null, stock_state: "in_stock", ...over,
  };
}

test("inventory filters round-trip through the URL and ignore junk", () => {
  const f = parseInventoryFilters(new URLSearchParams("tab=low&search=fb&category=3&products=all&sort=sold_desc&view=flat&inactive=show&page=4"));
  assert.deepEqual(f, { tab: "low", search: "fb", categoryId: 3, productStatus: "all", sort: "sold_desc", grouped: false, hideInactive: false, page: 4 });
  assert.equal(inventoryFiltersToSearch(f), "?tab=low&search=fb&category=3&products=all&sort=sold_desc&view=flat&inactive=show&page=4");
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
    pkg({ variant_id: 5, product_id: 3, product_title: "Gmail", category_id: 20, category_name: "Email" }),
  ];
  const tree = buildScopeTree(items);
  assert.deepEqual(tree.map((c) => c.name), ["Email", "Facebook"]);
  const fb = tree[1];
  assert.deepEqual(fb.products.map((p) => p.title), ["Facebook Clone", "Trust"]);

  const selected = new Set([1, 2, 4]);
  assert.equal(checkState([1, 2, 3], selected), "some");
  assert.equal(checkState([1, 2], selected), "all");
  assert.equal(checkState([5], selected), "none");
  assert.deepEqual(scopeSummary(tree, selected), { categories: 1, products: 2, packages: 3 });

  // Every active package of the Facebook category is selected → the category id alone.
  assert.deepEqual(compactScope(tree, selected, false), { variantIds: undefined, productIds: undefined, categoryIds: [10], includeInactive: undefined });
  // With inactive packages eligible, the category is partial: product Trust whole, Clone leftovers by id.
  assert.deepEqual(compactScope(tree, selected, true), { variantIds: [1, 2], productIds: [2], categoryIds: undefined, includeInactive: true });
  assert.deepEqual(compactScope(tree, new Set([5]), false), { variantIds: undefined, productIds: undefined, categoryIds: [20], includeInactive: undefined });
});
