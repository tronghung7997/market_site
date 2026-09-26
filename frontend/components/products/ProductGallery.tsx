"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { PublicImage } from "@/lib/types";
import { MediaImage } from "@/components/media/MediaImage";
import { ImageLightbox } from "@/components/media/ImageLightbox";

/** Seller-uploaded product images on the product page: one large image,
 *  a strip of thumbnails, and a full-size viewer on click. */
export function ProductGallery({ images, title }: { images: PublicImage[]; title: string }) {
  const t = useTranslations("media");
  const [active, setActive] = useState(0);
  const [viewer, setViewer] = useState<number | null>(null);
  if (images.length === 0) return null;
  const current = images[Math.min(active, images.length - 1)];

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setViewer(active)}
        aria-label={t("open")}
        className="group relative block aspect-[16/10] max-h-[420px] w-full overflow-hidden rounded-xl border border-line bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/60"
      >
        <MediaImage
          key={current.id}
          image={current}
          variant="full"
          fit="contain"
          eager
          alt={title}
          className="h-full w-full transition-transform duration-200 group-hover:scale-[1.01]"
        />
      </button>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="list">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              role="listitem"
              onClick={() => setActive(index)}
              aria-label={t("imageOf", { current: index + 1, total: images.length })}
              aria-current={index === active || undefined}
              className={cn(
                "h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/60 sm:h-16 sm:w-16",
                index === active ? "border-iris ring-1 ring-iris" : "border-line hover:border-line-2",
              )}
            >
              <MediaImage image={image} alt="" className="h-full w-full" />
            </button>
          ))}
        </div>
      )}
      <ImageLightbox images={images} index={viewer} onIndexChange={(index) => { setViewer(index); setActive(index); }} onClose={() => setViewer(null)} title={title} />
    </div>
  );
}
