import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  categoryPath,
  isLegacyNumericParam,
  matchCategoryParam,
  productKeyFromParam,
  productParamIsCanonical,
  productPath,
  sellerPath,
} from "../lib/routes.ts";

describe("productPath", () => {
  it("prefers the backend canonical path", () => {
    assert.equal(productPath({ id: 7, slug: "x", public_key: "k1k1k1k1", canonical_path: "/products/proxy-ipv4-k1k1k1k1" }), "/products/proxy-ipv4-k1k1k1k1");
  });

  it("builds slug-key from parts and tolerates an empty slug", () => {
    assert.equal(productPath({ id: 7, slug: "proxy-ipv4", public_key: "k1k1k1k1" }), "/products/proxy-ipv4-k1k1k1k1");
    assert.equal(productPath({ id: 7, slug: "", public_key: "k1k1k1k1" }), "/products/k1k1k1k1");
  });

  it("falls back to the legacy id when no key is known (old cached payloads)", () => {
    assert.equal(productPath({ id: 7 }), "/products/7");
  });
});

describe("categoryPath / sellerPath", () => {
  it("uses the slug and falls back to the id", () => {
    assert.equal(categoryPath({ id: 3, slug: "proxy" }), "/categories/proxy");
    assert.equal(categoryPath({ id: 3 }), "/categories/3");
  });

  it("still links sellers by account id until the seller key phase", () => {
    assert.equal(sellerPath({ account_id: 9 }), "/sellers/9");
  });
});

describe("route params", () => {
  it("recognises legacy numeric params", () => {
    assert.equal(isLegacyNumericParam("12"), true);
    assert.equal(isLegacyNumericParam("12-abc"), false);
    assert.equal(isLegacyNumericParam("abc12345"), false);
  });

  it("extracts the key from slug-key, bare key, and rejects numeric tails", () => {
    assert.equal(productKeyFromParam("rotating-ipv4-proxy-3f9k2m7q"), "3f9k2m7q");
    assert.equal(productKeyFromParam("3f9k2m7q"), "3f9k2m7q");
    assert.equal(productKeyFromParam("iphone-15"), null);
    assert.equal(productKeyFromParam("12345678"), null);
    assert.equal(productKeyFromParam("12"), null);
    assert.equal(productKeyFromParam("proxy-3F9K2M7Q"), null);
  });

  it("knows when the param already matches the canonical segment", () => {
    const product = { id: 1, slug: "proxy", public_key: "3f9k2m7q" };
    assert.equal(productParamIsCanonical("proxy-3f9k2m7q", product), true);
    assert.equal(productParamIsCanonical("old-name-3f9k2m7q", product), false);
    assert.equal(productParamIsCanonical("1", product), false);
  });

  it("matches a sub-category by slug or legacy id", () => {
    const subs = [{ id: 4, slug: "ipv4" }, { id: 6, slug: "ipv6" }];
    assert.equal(matchCategoryParam("ipv6", subs)?.id, 6);
    assert.equal(matchCategoryParam("4", subs)?.id, 4);
    assert.equal(matchCategoryParam("nope", subs), null);
    assert.equal(matchCategoryParam(undefined, subs), null);
  });
});
