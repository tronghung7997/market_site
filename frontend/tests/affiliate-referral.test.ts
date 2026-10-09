import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { referralEvidence } from "../lib/referral.ts";

const jar = (values: Record<string, string>) => (name: string) => values[name] ?? null;

describe("referral evidence sent at sign-up", () => {
  it("is absent without a ref cookie", () => {
    assert.equal(referralEvidence(jar({ aff_vid: "v1" })), undefined);
    assert.equal(referralEvidence(jar({ aff_ref: "  " })), undefined);
  });

  it("carries the code, the visitor id and the landing time", () => {
    assert.deepEqual(
      referralEvidence(jar({ aff_ref: "KOL12345", aff_vid: "v1", aff_ref_at: "2026-10-07T03:00:00.000Z" })),
      { code: "KOL12345", visitorId: "v1", clickedAt: "2026-10-07T03:00:00.000Z" },
    );
  });

  it("drops a landing time it cannot read (the backend then relies on its own click)", () => {
    assert.deepEqual(referralEvidence(jar({ aff_ref: "KOL12345", aff_ref_at: "yesterday" })), { code: "KOL12345" });
  });
});
