/** First-run checklist on the seller overview, derived only from data the
 *  seller console already loads. Each step links to where it gets done. */

import type { SellerDashboardInventory } from "../../lib/types.ts";

export type OnboardingKey = "email" | "profile" | "product" | "stock" | "active" | "twofa";

export interface OnboardingStep {
  key: OnboardingKey;
  done: boolean;
  href: string;
}

export interface OnboardingInput {
  inventory: Pick<SellerDashboardInventory, "product_count" | "active_count" | "managed_products" | "total_stock">;
  /** null while the shop profile is loading or failed to load. */
  profile: { description: string | null; logo?: unknown } | null;
  account: { email_verified?: boolean; totp_enabled?: boolean; mfa_available?: boolean };
}

export function onboardingSteps({ inventory, profile, account }: OnboardingInput): OnboardingStep[] {
  const steps: OnboardingStep[] = [];
  if (account.email_verified !== undefined) {
    steps.push({ key: "email", done: account.email_verified, href: "/verify-email" });
  }
  if (profile) {
    steps.push({ key: "profile", done: !!profile.logo && !!profile.description?.trim(), href: "/account?tab=seller" });
  }
  steps.push({ key: "product", done: inventory.product_count > 0, href: "/seller/products/new" });
  // Products delivered by a connected server have no stock to load.
  const needsStock = inventory.managed_products > 0 || inventory.product_count === 0;
  steps.push({ key: "stock", done: !needsStock || inventory.total_stock > 0, href: "/seller/inventory" });
  steps.push({ key: "active", done: inventory.active_count > 0, href: "/seller/products" });
  if (account.mfa_available) {
    steps.push({ key: "twofa", done: !!account.totp_enabled, href: "/account?tab=security&setup=2fa" });
  }
  return steps;
}

/** The first unfinished step, which the checklist highlights. */
export function nextOnboardingStep(steps: OnboardingStep[]): OnboardingStep | null {
  return steps.find((step) => !step.done) ?? null;
}

export function onboardingDismissKey(accountId: number): string {
  return `gmmo:seller-onboarding-hidden:${accountId}`;
}
