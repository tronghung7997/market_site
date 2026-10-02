import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ANONYMOUS_TAG, sessionMismatch, sessionTag } from "../lib/bff-session-tag.ts";

function jwt(claims: Record<string, unknown>): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${enc({ alg: "HS256" })}.${enc(claims)}.sig`;
}

describe("BFF session tag", () => {
  it("is stable per account across token rotation and hides the id", () => {
    const a1 = sessionTag(jwt({ sub: "23", sid: "s1", exp: 1 }));
    const a2 = sessionTag(jwt({ sub: "23", sid: "s2", exp: 2 }));
    const b = sessionTag(jwt({ sub: "24", sid: "s1", exp: 1 }));
    assert.equal(a1, a2);
    assert.notEqual(a1, b);
    assert.match(a1 ?? "", /^[0-9a-f]{16}$/);
    assert.ok(!(a1 ?? "").includes("23"));
  });

  it("knows anonymous, and refuses to guess", () => {
    assert.equal(sessionTag(undefined), ANONYMOUS_TAG);
    // Access cookie expired but a refresh cookie remains: same person, unknown tag.
    assert.equal(sessionTag(undefined, true), null);
    assert.equal(sessionTag("not-a-jwt"), null);
    assert.equal(sessionTag(jwt({ sid: "x" })), null);
  });

  it("flags only a known, different identity", () => {
    assert.equal(sessionMismatch("aaaa", "bbbb"), true);
    assert.equal(sessionMismatch("aaaa", ANONYMOUS_TAG), true);
    assert.equal(sessionMismatch("aaaa", "aaaa"), false);
    assert.equal(sessionMismatch(null, "bbbb"), false);
    assert.equal(sessionMismatch("aaaa", null), false);
  });
});
