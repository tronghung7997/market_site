"use client";

import { useTranslations } from "next-intl";
import { X } from "@/components/Icons";
import { MediaImage } from "./MediaImage";
import type { UploaderImage } from "./ImageUploader";

/** Images picked in a composer and not sent yet: small tiles with remove,
 *  plus a spinner tile per upload still running. */
export function PendingImages({
  images,
  uploading,
  errors,
  onRemove,
}: {
  images: UploaderImage[];
  uploading: number;
  errors: string[];
  onRemove: (id: string) => void;
}) {
  const t = useTranslations("media");
  if (images.length === 0 && uploading === 0 && errors.length === 0) return null;
  return (
    <div className="space-y-1">
      <ul className="flex flex-wrap gap-1.5">
        {images.map((image) => (
          <li key={image.id} className="relative h-14 w-14 overflow-hidden rounded-lg border border-line bg-raised">
            <MediaImage image={image} alt="" className="h-full w-full" />
            <button
              type="button"
              onClick={() => onRemove(image.id)}
              aria-label={t("remove")}
              className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-md bg-ink-panel/75 text-white hover:bg-ink-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
            >
              <X size={12} />
            </button>
          </li>
        ))}
        {Array.from({ length: uploading }, (_, index) => (
          <li key={`uploading-${index}`} className="flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-raised" aria-busy>
            <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-iris border-t-transparent" />
            <span className="sr-only">{t("uploading")}</span>
          </li>
        ))}
      </ul>
      {errors.length > 0 && (
        <ul role="alert" className="space-y-0.5 text-[11px] text-bad">
          {errors.map((message, index) => <li key={index}>{message}</li>)}
        </ul>
      )}
    </div>
  );
}
