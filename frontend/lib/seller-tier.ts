export const SELLER_TIERS = ["new", "verified", "trusted", "enterprise"] as const;
export type SellerTierKey = (typeof SELLER_TIERS)[number];

export const SELLER_TIER_INFO: Record<string, { label: string; short: string }> = {
  new: { label: "Người bán mới", short: "Mới" },
  verified: { label: "Đã xác minh", short: "Xác minh" },
  trusted: { label: "Uy tín", short: "Uy tín" },
  enterprise: { label: "Đối tác doanh nghiệp", short: "Doanh nghiệp" },
};

export function sellerTierLabel(tier: string | null | undefined, variant: "label" | "short" = "label"): string {
  if (!tier) return SELLER_TIER_INFO.new[variant];
  return SELLER_TIER_INFO[tier]?.[variant] ?? tier;
}
