import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { catalogWritePath, privateImageCacheControl, publicCacheControl } from "../lib/bff-cache.ts";

describe("BFF public cache policy", () => {
  it("lets anonymous catalog GETs be cached by a shared cache", () => {
    const header = publicCacheControl({ method: "GET", path: "products/proxy-3f9k2m7q", status: 200, authenticated: false });
    assert.match(header ?? "", /^public, max-age=0, s-maxage=60, stale-while-revalidate=300$/);
    assert.ok(publicCacheControl({ method: "GET", path: "categories", status: 200, authenticated: false }));
    assert.ok(publicCacheControl({ method: "GET", path: "products", status: 200, authenticated: false }));
    assert.ok(publicCacheControl({ method: "GET", path: "sellers/top", status: 200, authenticated: false }));
  });

  it("never caches authenticated, failed, or non-catalog responses", () => {
    assert.equal(publicCacheControl({ method: "GET", path: "products/12", status: 200, authenticated: true }), null);
    assert.equal(publicCacheControl({ method: "GET", path: "products/12", status: 404, authenticated: false }), null);
    assert.equal(publicCacheControl({ method: "POST", path: "products", status: 200, authenticated: false }), null);
    assert.equal(publicCacheControl({ method: "GET", path: "orders", status: 200, authenticated: false }), null);
    assert.equal(publicCacheControl({ method: "GET", path: "seller/products", status: 200, authenticated: false }), null);
    assert.equal(publicCacheControl({ method: "GET", path: "products/12/operations", status: 200, authenticated: false }), null);
  });
});

describe("BFF catalog invalidation", () => {
  it("flags successful writes to catalog-owning endpoints", () => {
    assert.equal(catalogWritePath("PATCH", "seller/products/12", 200), true);
    assert.equal(catalogWritePath("PUT", "admin/posts/3", 200), true);
    assert.equal(catalogWritePath("GET", "admin/posts", 200), false);
    assert.equal(catalogWritePath("POST", "seller/products/12/variants", 201), true);
    assert.equal(catalogWritePath("POST", "admin/sources/11/transfer", 200), true);
    assert.equal(catalogWritePath("PATCH", "admin/sources/11/settings", 200), true);
    assert.equal(catalogWritePath("GET", "admin/sources/11/transfer-preview", 200), false);
    assert.equal(catalogWritePath("POST", "seller/variants/3/resources", 201), true);
    assert.equal(catalogWritePath("PATCH", "admin/categories/3", 200), true);
    assert.equal(catalogWritePath("DELETE", "admin/products/3", 204), true);
    assert.equal(catalogWritePath("PATCH", "admin/reviews/41/visibility", 200), true);
    assert.equal(catalogWritePath("GET", "admin/reviews", 200), false);
  });

  it("ignores reads, failures, and unrelated writes", () => {
    assert.equal(catalogWritePath("GET", "seller/products", 200), false);
    assert.equal(catalogWritePath("POST", "seller/variants/3/resources/preview", 200), false);
    assert.equal(catalogWritePath("PATCH", "seller/products/12", 422), false);
    assert.equal(catalogWritePath("POST", "orders", 201), false);
    assert.equal(catalogWritePath("POST", "auth/login", 200), false);
  });
});

describe("BFF private image cache policy", () => {
  it("keeps the backend's private cache header on successful images", () => {
    assert.equal(
      privateImageCacheControl({ status: 200, contentType: "image/webp", upstreamCacheControl: "private, max-age=3600" }),
      "private, max-age=3600",
    );
  });

  it("falls back to no-store for anything else", () => {
    const base = { status: 200, contentType: "image/webp", upstreamCacheControl: "private, max-age=3600" };
    assert.equal(privateImageCacheControl({ ...base, status: 404 }), null);
    assert.equal(privateImageCacheControl({ ...base, contentType: "application/json" }), null);
    assert.equal(privateImageCacheControl({ ...base, upstreamCacheControl: "public, max-age=60" }), null);
    assert.equal(privateImageCacheControl({ ...base, upstreamCacheControl: null }), null);
  });

  it("keeps the policy on a 304 revalidation", () => {
    assert.equal(
      privateImageCacheControl({ status: 304, contentType: "", upstreamCacheControl: "private, no-cache" }),
      "private, no-cache",
    );
  });
});
