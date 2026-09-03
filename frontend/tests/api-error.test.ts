import assert from "node:assert/strict";
import test from "node:test";

import { apiErrorFromResponse, errorCodeFromResponse } from "../lib/api-error.ts";
import { bffErrorBody } from "../lib/bff-error.ts";
import viMessages from "../messages/vi.json" with { type: "json" };

test("login 401 with error_code keeps INVALID_CREDENTIALS", () => {
  const error = apiErrorFromResponse("/auth/login", 401, {
    detail: "Email or password is incorrect",
    error_code: "INVALID_CREDENTIALS",
    params: {},
  }, { locale: "en" });
  assert.equal(error.errorCode, "INVALID_CREDENTIALS");
  assert.equal(error.message, "Email or password is incorrect");
});

test("login 401 with only Vietnamese detail still maps to INVALID_CREDENTIALS on English UI", () => {
  const error = apiErrorFromResponse("/auth/login", 401, {
    detail: "Email hoặc mật khẩu không đúng",
  }, { locale: "en" });
  assert.equal(error.status, 401);
  assert.equal(error.errorCode, "INVALID_CREDENTIALS");
  assert.equal(error.message, "Something went wrong. Please try again.");
});

test("admin login 401 without a code is treated as invalid credentials", () => {
  const error = apiErrorFromResponse("/auth/admin/login", 401, { detail: "Unauthorized" }, { locale: "en" });
  assert.equal(error.errorCode, "INVALID_CREDENTIALS");
});

test("authenticated 401 stays a session expiry", () => {
  const error = apiErrorFromResponse("/me", 401, { detail: "Token không hợp lệ" }, { auth: true, locale: "en" });
  assert.equal(error.errorCode, "SESSION_EXPIRED");
});

test("register 409 without a code maps to DUPLICATE_EMAIL", () => {
  const error = apiErrorFromResponse("/auth/register", 409, {
    detail: "Email này đã được đăng ký",
  }, { locale: "en" });
  assert.equal(error.errorCode, "DUPLICATE_EMAIL");
});

test("Vietnamese detail is kept when the UI locale is Vietnamese", () => {
  const error = apiErrorFromResponse("/auth/login", 401, {
    detail: "Email hoặc mật khẩu không đúng",
  }, { locale: "vi" });
  assert.equal(error.errorCode, "INVALID_CREDENTIALS");
  assert.equal(error.message, "Email hoặc mật khẩu không đúng");
});

test("catalog Vietnamese strings reverse-map to error codes without a body error_code", () => {
  assert.equal(
    errorCodeFromResponse("/orders/1", 409, { detail: viMessages.errors.RESOURCE_UNAVAILABLE }),
    "RESOURCE_UNAVAILABLE",
  );
  assert.equal(
    errorCodeFromResponse("/auth/reset-password", 400, {
      detail: "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn",
    }),
    "PASSWORD_RESET_INVALID",
  );
});

test("BFF-owned errors carry error_code", () => {
  const body = bffErrorBody("CSRF_REJECTED", "This request was blocked. Refresh the page and try again.");
  assert.equal(errorCodeFromResponse("/auth/login", 403, body), "CSRF_REJECTED");
});
