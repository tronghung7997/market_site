"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { ImageIcon } from "@/components/Icons";

/** Anything with image URLs: a PublicImage from the API or a fresh upload. */
export interface ImageSource {
  url: string | null;
  thumb_url?: string | null;
  w?: number;
  h?: number;
}

/**
 * One stored image. Lazy, async-decoded, sized from the stored dimensions so
 * the layout does not jump, and replaced by `fallback` (or a neutral tile)
 * when the file is gone — e.g. taken down by an admin. `priority` is for the
 * one above-the-fold image that is the page's LCP (a blog cover): loaded
 * eagerly and fetched ahead of other images.
 */
export function MediaImage({
  image,
  variant = "thumb",
  alt = "",
  className,
  fit = "cover",
  fallback,
  eager,
  priority,
}: {
  image: ImageSource | null | undefined;
  variant?: "thumb" | "full";
  alt?: string;
  className?: string;
  fit?: "cover" | "contain";
  fallback?: ReactNode;
  eager?: boolean;
  priority?: boolean;
}) {
  const t = useTranslations("media");
  const src = variant === "thumb" ? (image?.thumb_url ?? image?.url) : image?.url;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return fallback ?? (
      <span
        role="img"
        aria-label={alt || t("unavailable")}
        className={cn("flex items-center justify-center bg-raised text-faint", className)}
      >
        <ImageIcon size={18} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      width={image?.w || undefined}
      height={image?.h || undefined}
      loading={eager || priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      onError={() => setFailedSrc(src)}
      className={cn(fit === "cover" ? "object-cover" : "object-contain", className)}
    />
  );
}
