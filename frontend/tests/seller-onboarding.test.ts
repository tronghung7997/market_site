import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { nextOnboardingStep, onboardingSteps } from "../features/seller-dashboard/onboarding.ts";

const empty = { product_count: 0, active_count: 0, managed_products: 0, total_stock: 0 };

describe("seller onboarding checklist", () => {
  it("starts a brand-new shop at the first missing step", () => {
    const steps = onboardingSteps({
      inventory: empty,
      profile: { description: null, logo: null },
      account: { email_verified: true, totp_enabled: false, mfa_available: true },
    });
    assert.deepEqual(steps.map((s) => [s.key, s.done]), [
      ["email", true], ["profile", false], ["product", false], ["stock", false], ["active", false], ["twofa", false],
    ]);
    assert.equal(nextOnboardingStep(steps)?.key, "profile");
  });

  it("does not ask for stock when every product is delivered by a server", () => {
    const steps = onboardingSteps({
      inventory: { product_count: 2, active_count: 1, managed_products: 0, total_stock: 0 },
      profile: { description: "Proxy", logo: { url: "x" } },
      account: { email_verified: true },
    });
    assert.ok(steps.every((s) => s.done));
    assert.equal(nextOnboardingStep(steps), null);
    assert.ok(!steps.some((s) => s.key === "twofa"), "2FA is hidden when the marketplace has it off");
  });

  it("asks to load stock for managed products and skips unknown checks", () => {
    const steps = onboardingSteps({
      inventory: { product_count: 1, active_count: 1, managed_products: 1, total_stock: 0 },
      profile: null,
      account: {},
    });
    assert.deepEqual(steps.map((s) => s.key), ["product", "stock", "active"]);
    assert.equal(nextOnboardingStep(steps)?.key, "stock");
  });
});
