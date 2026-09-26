"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { MediaImage, type ImageSource } from "./MediaImage";
import { ImageLightbox } from "./ImageLightbox";

export type StripImage = ImageSource & { id: string; caption?: string | null };

const SIZE = { sm: "h-16 w-16", md: "h-24 w-24" } as const;

/** A row of image thumbnails (chat message, dispute evidence, receipts);
 *  clicking one opens the full-size viewer on it. */
export function ImageStrip({
  images,
  title,
  size = "md",
  className,
}: {
  images: StripImage[];
  title: string;
  size?: keyof typeof SIZE;
  className?: string;
}) {
  const t = useTranslations("media");
  const [viewer, setViewer] = useState<number | null>(null);
  if (images.length === 0) return null;
  return (
    <>
      <ul className={cn("flex flex-wrap gap-1.5", className)}>
        {images.map((image, index) => (
          <li key={image.id} className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => setViewer(index)}
              aria-label={t("imageOf", { current: index + 1, total: images.length })}
              className={cn(
                "overflow-hidden rounded-lg border border-line bg-raised transition-colors hover:border-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/60",
                SIZE[size],
              )}
            >
              <MediaImage image={image} alt="" className="h-full w-full" />
            </button>
            {image.caption && <span className="max-w-24 truncate font-mono text-[10.5px] text-faint">{image.caption}</span>}
          </li>
        ))}
      </ul>
      <ImageLightbox images={images} index={viewer} onIndexChange={setViewer} onClose={() => setViewer(null)} title={title} />
    </>
  );
}
