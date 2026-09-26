"use client";

import { cn } from "@/lib/cn";
import { coverSrc, inferCoverFromText, isCoverId } from "@/lib/product-covers";
import { Monogram } from "@/components/ui";
import { MediaImage, type ImageSource } from "@/components/media/MediaImage";

/** A product's card image: the seller's first uploaded image when there is
 *  one, otherwise the allowlisted icon (or one inferred from the title). */
export function ProductCover({
  coverId,
  image,
  title,
  className,
}: {
  coverId?: string | null;
  image?: ImageSource | null;
  title: string;
  className?: string;
}) {
  const effectiveId = isCoverId(coverId) ? coverId : inferCoverFromText(title) || "other";
  const src = coverSrc(effectiveId);
  const frame = cn(
    "relative block h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-line bg-raised",
    className,
  );
  const icon = src
    ? <img src={src} alt="" width={72} height={72} className="h-full w-full object-cover" />
    : null;
  if (image?.url) {
    return (
      <span className={frame}>
        <MediaImage image={image} alt="" className="h-full w-full" fallback={icon ?? <Monogram text={title} className="h-full w-full" />} />
      </span>
    );
  }
  if (!icon) return <Monogram text={title} className={className} />;
  return <span className={frame}>{icon}</span>;
}
