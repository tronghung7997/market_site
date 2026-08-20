import assert from "node:assert/strict";
import test from "node:test";

import { sessionExpiryRedirect } from "../lib/session-expiry.ts";

test("expired sessions keep public browsing routes open", () => {
  for (const pathname of [
    "/",
    "/products/42",
    "/categories",
    "/categories/7",
    "/solutions",
    "/login",
    "/register",
  ]) {
    assert.equal(sessionExpiryRedirect(pathname), null, pathname);
  }
});

test("expired sessions redirect protected buyer and seller routes", () => {
  assert.equal(
    sessionExpiryRedirect("/orders"),
    "/login?expired=1&next=%2Forders",
  );
  assert.equal(
    sessionExpiryRedirect("/wallet"),
    "/login?expired=1&next=%2Fwallet",
  );
  assert.equal(
    sessionExpiryRedirect("/affiliate"),
    "/login?expired=1&next=%2Faffiliate",
  );
  assert.equal(
    sessionExpiryRedirect("/seller/products"),
    "/login?expired=1&next=%2Fseller%2Fproducts",
  );
});

test("expired admin sessions use the isolated admin login", () => {
  assert.equal(sessionExpiryRedirect("/admin/login"), null);
  assert.equal(
    sessionExpiryRedirect("/admin/accounts"),
    "/admin/login?expired=1&next=%2Fadmin%2Faccounts",
  );
});

test("route-prefix lookalikes stay public", () => {
  for (const pathname of ["/orders-public", "/seller-tools", "/administrator"]) {
    assert.equal(sessionExpiryRedirect(pathname), null, pathname);
  }
});
