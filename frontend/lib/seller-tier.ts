export const SELLER_TIERS = ["new", "verified", "trusted", "enterprise"] as const;
export type SellerTierKey = (typeof SELLER_TIERS)[number];

/** English defaults for non-React call sites. Locale-aware UI should prefer
 *  message keys (e.g. sellers.tier_*) instead of this map. */
export const SELLER_TIER_INFO: Record<string, { label: string; short: string }> = {
  new: { label: "New seller", short: "New" },
  verified: { label: "Verified", short: "Verified" },
  trusted: { label: "Trusted", short: "Trusted" },
  enterprise: { label: "Enterprise partner", short: "Enterprise" },
};

export function sellerTierLabel(tier: string | null | undefined, variant: "label" | "short" = "label"): string {
  if (!tier) return SELLER_TIER_INFO.new[variant];
  return SELLER_TIER_INFO[tier]?.[variant] ?? tier;
}
