import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { PublicImage } from "@/lib/types";
import { MediaImage } from "@/components/media/MediaImage";

/** Filled brand-blue rosette with a white check: the "tick xanh" of Elite. */
export function BlueTick({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={cn("shrink-0", className)}>
      <path
        fill="var(--color-iris)"
        d="M12 1.6 14.6 3.3l3.1-.2.8 3 2.4 2-1.2 2.9 1.2 2.9-2.4 2-.8 3-3.1-.2L12 20.4l-2.6-1.7-3.1.2-.8-3-2.4-2 1.2-2.9-1.2-2.9 2.4-2 .8-3 3.1.2Z"
      />
      <path d="m8.4 11.9 2.4 2.4 4.8-4.8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The seller's tier badge next to their name, everywhere buyers see it.
 *
 * `tier` is the *badge* tier from the API (`badge_tier` / `seller_badge_tier`):
 * the real tier, or a running onboarding-promo badge. New sellers get none;
 * verified shows "Pro", trusted "Elite" with the blue tick, enterprise the
 * blue tick with its own label. An icon the admin uploaded for the tier
 * (`image`) replaces the built-in badge.
 */
export function SellerTierBadge({
  tier,
  image,
  size = "sm",
  className,
}: {
  tier?: string | null;
  image?: PublicImage | null;
  size?: "xs" | "sm";
  className?: string;
}) {
  const t = useTranslations("sellerBadge");
  if (tier !== "verified" && tier !== "trusted" && tier !== "enterprise") return null;
  const title = t(`title_${tier}`);
  const icon = size === "xs" ? 12 : 14;
  if (image) {
    return (
      <span className={cn("inline-flex shrink-0 items-center", className)} title={title}>
        <MediaImage image={image} alt={title} className={cn("rounded-sm object-contain", size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4")} />
      </span>
    );
  }
  const text = size === "xs" ? "text-[10px]" : "text-[10.5px]";
  if (tier === "verified") {
    return (
      <span
        title={title}
        aria-label={title}
        className={cn(
          "inline-flex shrink-0 items-center rounded-[6px] border border-iris/25 bg-iris-soft px-1.5 font-semibold uppercase leading-[16px] tracking-wide text-iris-hi",
          text, className,
        )}
      >
        {t("label_verified")}
      </span>
    );
  }
  return (
    <span title={title} aria-label={title} className={cn("inline-flex shrink-0 items-center gap-0.5 font-semibold text-iris-hi", text, className)}>
      <BlueTick size={icon} />
      <span className="uppercase leading-none tracking-wide">{t(`label_${tier}`)}</span>
    </span>
  );
}
