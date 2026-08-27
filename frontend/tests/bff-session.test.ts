import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE_SECONDS,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE_SECONDS,
  authCookieOptions,
  tokensFromLoginPayload,
} from "../lib/bff-session.ts";

test("auth cookies are httpOnly with matching access/refresh lifetimes", () => {
  const access = authCookieOptions(ACCESS_MAX_AGE_SECONDS, false);
  const refresh = authCookieOptions(REFRESH_MAX_AGE_SECONDS, true);
  assert.equal(ACCESS_COOKIE, "dx_session");
  assert.equal(REFRESH_COOKIE, "dx_refresh");
  assert.equal(access.maxAge, 15 * 60);
  assert.equal(refresh.maxAge, 7 * 24 * 60 * 60);
  assert.equal(access.httpOnly, true);
  assert.equal(access.sameSite, "strict");
  assert.equal(access.secure, false);
  assert.equal(refresh.secure, true);
});

test("login payload without both tokens is rejected", () => {
  assert.equal(tokensFromLoginPayload({ access_token: "a" }), null);
  assert.equal(tokensFromLoginPayload({ refresh_token: "r" }), null);
  const tokens = tokensFromLoginPayload({
    access_token: "a",
    refresh_token: "r",
    token_type: "bearer",
  });
  assert.deepEqual(tokens, { accessToken: "a", refreshToken: "r", tokenType: "bearer" });
});
