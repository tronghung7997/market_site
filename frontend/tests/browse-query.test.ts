import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { browseQueryToListOpts, listOptsToSearchParams } from "../features/catalog/data/browse-query.ts";

describe("category browse query", () => {
  it("maps the star filter to min_rating and ignores unsupported values", () => {
    const four = browseQueryToListOpts({ rating: "4" }, 7);
    assert.equal(four.minRating, 4);
    assert.equal(listOptsToSearchParams(four).get("min_rating"), "4");
    assert.equal(browseQueryToListOpts({ rating: "3" }, 7).minRating, 3);
    for (const bad of ["5", "0", "abc", "", undefined]) {
      const opts = browseQueryToListOpts({ rating: bad }, 7);
      assert.equal(opts.minRating, undefined, String(bad));
      assert.equal(listOptsToSearchParams(opts).has("min_rating"), false);
    }
  });

  it("keeps the existing filters alongside the star filter", () => {
    const opts = browseQueryToListOpts({ q: " proxy ", stock: "1", instant: "1", price: "1to2", sort: "rating", rating: "4", page: "2" }, 3);
    const params = listOptsToSearchParams(opts);
    assert.equal(params.get("category_id"), "3");
    assert.equal(params.get("search"), "proxy");
    assert.equal(params.get("in_stock"), "true");
    assert.equal(params.get("fulfillment"), "instant");
    assert.equal(params.get("min_price"), "25000");
    assert.equal(params.get("max_price"), "50000");
    assert.equal(params.get("sort"), "rating");
    assert.equal(params.get("min_rating"), "4");
    assert.equal(params.get("page"), "2");
  });
});
