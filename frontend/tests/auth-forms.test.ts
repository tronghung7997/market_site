import assert from "node:assert/strict";
import test from "node:test";

import { validateResetPassword } from "../lib/auth-validation.ts";
import { authenticatedLoginRedirect } from "../lib/safe-redirect.ts";

test("reset password requires the minimum length used by register", () => {
  assert.equal(validateResetPassword("short", "short"), "min");
});

test("reset password rejects a mismatch", () => {
  assert.equal(validateResetPassword("ValidPass1234", "ValidPass1235"), "mismatch");
});

test("reset password accepts a matching eight-character password", () => {
  assert.equal(validateResetPassword("passw0rd", "passw0rd"), null);
});

test("an authenticated account leaves login for the requested internal page", () => {
  assert.equal(authenticatedLoginRedirect("/messages", ["seller"]), "/messages");
});

test("an authenticated account gets a role-appropriate fallback without an internal next page", () => {
  assert.equal(authenticatedLoginRedirect(null, ["seller"]), "/seller");
  assert.equal(authenticatedLoginRedirect(null, ["admin"]), "/admin");
  assert.equal(authenticatedLoginRedirect("https://evil.example", ["buyer"]), "/");
});
