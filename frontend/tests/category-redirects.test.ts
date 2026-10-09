import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { categoryRedirectLocation, createRedirectCache, isCategoryPath, toRedirectMap } from "../lib/category-redirects.ts";

const locales = ["en", "vi"] as const;
const map = toRedirectMap([{ old_slug: "social", slug: "accounts" }, { old_slug: "payment", slug: "other" }, { bad: 1 }]);

describe("category redirects", () => {
  it("sends an old slug to the new one, keeping locale and query", () => {
    assert.equal(categoryRedirectLocation("/vi/categories/social", "?sort=new", map, locales), "/vi/categories/accounts?sort=new");
    assert.equal(categoryRedirectLocation("/en/categories/payment/", "", map, locales), "/en/categories/other");
  });

  it("leaves live slugs, other pages and unknown locales alone", () => {
    assert.equal(categoryRedirectLocation("/vi/categories/accounts", "", map, locales), null);
    assert.equal(categoryRedirectLocation("/vi/categories", "", map, locales), null);
    assert.equal(categoryRedirectLocation("/vi/categories/social/extra", "", map, locales), null);
    assert.equal(categoryRedirectLocation("/fr/categories/social", "", map, locales), null);
    assert.equal(categoryRedirectLocation("/vi/categories/%E0%A4%A", "", map, locales), null);
    assert.equal(isCategoryPath("/vi/categories/social", locales), true);
    assert.equal(isCategoryPath("/vi/products/x", locales), false);
  });

  it("refreshes the map at most once per ttl and keeps the last map when the backend fails", async () => {
    let clock = 0;
    let calls = 0;
    let fail = false;
    const get = createRedirectCache(async () => {
      calls += 1;
      if (fail) throw new Error("down");
      return toRedirectMap([{ old_slug: "a", slug: String(calls) }]);
    }, 60_000, () => clock);
    assert.equal((await get()).get("a"), "1");
    clock = 30_000;
    assert.equal((await get()).get("a"), "1");
    assert.equal(calls, 1);
    clock = 61_000;
    fail = true;
    assert.equal((await get()).get("a"), "1");
    assert.equal(calls, 2);
    clock = 62_000;
    assert.equal((await get()).get("a"), "1");
    assert.equal(calls, 2);
  });
});
