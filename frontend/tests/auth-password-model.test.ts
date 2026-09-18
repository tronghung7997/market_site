import assert from "node:assert/strict";
import test from "node:test";

import { passwordStrength, validateNewPassword } from "../features/auth/model/password.ts";

test("strength: empty and too-short passwords score at the bottom", () => {
  assert.equal(passwordStrength(""), 0);
  assert.equal(passwordStrength("abc"), 1);
  assert.equal(passwordStrength("aaaaaaaaaa"), 1);
});

test("strength: length and variety raise the score", () => {
  assert.equal(passwordStrength("password"), 1);
  assert.equal(passwordStrength("password12"), 2);
  assert.equal(passwordStrength("Password12!"), 3);
  assert.equal(passwordStrength("Correct-Horse-Battery-9"), 4);
});

test("new password validation mirrors the backend limits", () => {
  assert.equal(validateNewPassword(""), "required");
  assert.equal(validateNewPassword("short"), "min");
  assert.equal(validateNewPassword("x".repeat(129)), "max");
  assert.equal(validateNewPassword("ắ".repeat(30)), "byte");
  assert.equal(validateNewPassword("StrongPass123!"), null);
});
