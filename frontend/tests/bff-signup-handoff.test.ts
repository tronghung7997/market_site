import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { bodyWithSignupHandoff, signupCookieOptions, SIGNUP_HANDOFF_PATHS } from "../lib/bff-session.ts";

const enc = (v: string) => new TextEncoder().encode(v).buffer as ArrayBuffer;
const dec = (b: ArrayBuffer | null) => (b ? JSON.parse(new TextDecoder().decode(b)) : null);

describe("BFF sign-up handoff", () => {
  it("takes the handoff from the cookie only", () => {
    assert.deepEqual(dec(bodyWithSignupHandoff(enc('{"token":"t"}'), "secret")), { token: "t", handoff: "secret" });
    // A value planted by page script is dropped, with or without a cookie.
    assert.deepEqual(dec(bodyWithSignupHandoff(enc('{"token":"t","handoff":"forged"}'), "secret")), { token: "t", handoff: "secret" });
    assert.deepEqual(dec(bodyWithSignupHandoff(enc('{"token":"t","handoff":"forged"}'), undefined)), { token: "t" });
    assert.deepEqual(dec(bodyWithSignupHandoff(undefined, "s")), { handoff: "s" });
  });

  it("refuses bodies that are not a JSON object", () => {
    assert.equal(bodyWithSignupHandoff(enc("[1]"), "s"), null);
    assert.equal(bodyWithSignupHandoff(enc("not json"), "s"), null);
  });

  it("keeps the cookie HttpOnly and scoped to the auth API", () => {
    const opts = signupCookieOptions(true);
    assert.equal(opts.httpOnly, true);
    assert.equal(opts.secure, true);
    assert.equal(opts.path, "/api/auth");
    assert.ok(SIGNUP_HANDOFF_PATHS.has("auth/verify-email") && SIGNUP_HANDOFF_PATHS.has("auth/signup-handoff/claim"));
  });
});
