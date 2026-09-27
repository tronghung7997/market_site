import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { accountCompleteness } from "../features/account/model.ts";

describe("account completeness", () => {
  it("counts email, name, phone and 2FA where offered", () => {
    const empty = accountCompleteness({ email_verified: false, display_name: " ", phone: null, totp_enabled: false, mfa_available: true });
    assert.equal(empty.percent, 0);
    assert.deepEqual(empty.items.map((i) => i.key), ["email", "name", "phone", "twofa"]);
    const half = accountCompleteness({ email_verified: true, display_name: "An", phone: null, totp_enabled: false, mfa_available: true });
    assert.equal(half.percent, 50);
    assert.equal(half.items.find((i) => i.key === "twofa")?.tab, "security");
  });

  it("leaves 2FA out when the marketplace has it off", () => {
    const full = accountCompleteness({ email_verified: true, display_name: "An", phone: "0901234567", totp_enabled: false, mfa_available: false });
    assert.equal(full.percent, 100);
    assert.equal(full.items.length, 3);
  });
});
