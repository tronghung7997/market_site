import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PRODUCT_FILTERS,
  hasActiveProductFilters,
  parseProductsFilters,
  productsFiltersToSearch,
} from "../features/seller-products/model.ts";
import { variantTermKind } from "../lib/variant-term.ts";

test("products filters: category ids round-trip and ignore junk", () => {
  const parsed = parseProductsFilters(new URLSearchParams("category=3,abc,3,7&tab=paused&page=2"));
  assert.deepEqual(parsed.categoryIds, [3, 7]);
  assert.equal(parsed.tab, "paused");
  assert.equal(productsFiltersToSearch(parsed), "?tab=paused&category=3%2C7&page=2");
  assert.equal(hasActiveProductFilters(parsed), true);
  assert.equal(hasActiveProductFilters(DEFAULT_PRODUCT_FILTERS), false);
  assert.equal(productsFiltersToSearch(DEFAULT_PRODUCT_FILTERS), "");
});

test("variant term: accounts say account type, everything else keeps package", () => {
  assert.equal(variantTermKind("account"), "account");
  assert.equal(variantTermKind("proxy"), "package");
  assert.equal(variantTermKind("endpoint"), "package");
  assert.equal(variantTermKind(null), "package");
  assert.equal(variantTermKind(undefined), "package");
});
