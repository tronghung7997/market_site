import assert from "node:assert/strict";
import test from "node:test";

import { validateResetPassword } from "../lib/auth-validation.ts";

test("reset password requires the minimum length used by register", () => {
  assert.equal(validateResetPassword("short", "short"), "min");
});

test("reset password rejects a mismatch", () => {
  assert.equal(validateResetPassword("ValidPass1234", "ValidPass1235"), "mismatch");
});

test("reset password accepts a matching eight-character password", () => {
  assert.equal(validateResetPassword("passw0rd", "passw0rd"), null);
});
