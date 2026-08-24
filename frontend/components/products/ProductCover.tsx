"use client";

import { cn } from "@/lib/cn";
import { coverSrc } from "@/lib/product-covers";
import { Monogram } from "@/components/ui";

export function ProductCover({
  coverId,
  title,
  className,
}: {
  coverId?: string | null;
  title: string;
  className?: string;
}) {
  const src = coverSrc(coverId);
  if (!src) return <Monogram text={title} className={className} />;
  return (
    <span
      className={cn(
        "relative block h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-line bg-raised",
        className,
      )}
    >
      <img src={src} alt="" width={72} height={72} className="h-full w-full object-cover" />
    </span>
  );
}
