"use client";

/** "Ảnh đại diện" for a product: one grid with the owner's first uploaded
 *  photo and every preset icon. The picked tile is what product cards lead
 *  with — `cover_source` "photo" (the upload, or the preset while there is
 *  none) or "preset" (the icon even when photos exist; they stay in the
 *  product page gallery). Shared by the seller form and the admin editor. */

import { cn } from "@/lib/cn";
import { COVER_GROUPS, COVER_LABELS, isCoverId, type CoverId } from "@/lib/product-covers";
import { ProductCover } from "@/components/products/ProductCover";
import type { ComponentProps } from "react";

export type CoverSource = "photo" | "preset";

type Photo = ComponentProps<typeof ProductCover>["image"];

const PRESETS: CoverId[] = Object.values(COVER_GROUPS).flat();

const COPY = {
  vi: {
    title: "Ảnh đại diện",
    photo: "Ảnh đã tải",
    noPhoto: "Chưa có ảnh tải lên",
    usingPhoto: "Thẻ sản phẩm đang dùng ảnh bạn tải lên.",
    usingPreset: (label: string) => `Thẻ sản phẩm đang dùng ảnh mẫu ${label}. Ảnh tải lên vẫn hiện trong trang sản phẩm.`,
    usingPresetNoPhoto: (label: string) => `Thẻ sản phẩm đang dùng ảnh mẫu ${label}.`,
  },
  en: {
    title: "Cover image",
    photo: "Your upload",
    noPhoto: "No upload yet",
    usingPhoto: "Product cards show your uploaded photo.",
    usingPreset: (label: string) => `Product cards show the ${label} preset. Uploaded photos still appear on the product page.`,
    usingPresetNoPhoto: (label: string) => `Product cards show the ${label} preset.`,
  },
} as const;

/** What the cards will show for this choice: the photo, or null for the preset. */
export function effectiveCoverPhoto<T>(source: CoverSource, photo: T | null | undefined): T | null {
  return source === "photo" && photo ? photo : null;
}

export function CoverChooser({ coverId, source, photo, onChange, locale = "vi" }: {
  coverId: string | null;
  source: CoverSource;
  /** First uploaded image, if any. With none, a preset is only the fallback
   *  (source stays "photo"), so a photo uploaded later still leads. */
  photo: Photo;
  onChange: (next: { source: CoverSource; coverId?: CoverId }) => void;
  locale?: "vi" | "en";
}) {
  const copy = COPY[locale];
  const usingPhoto = effectiveCoverPhoto(source, photo) != null;
  const preset = isCoverId(coverId) ? coverId : null;
  const presetLabel = preset ? COVER_LABELS[preset][locale] : "";
  const tile = (on: boolean) => cn(
    "flex flex-col items-center gap-1.5 rounded-xl border px-1.5 py-2 text-center transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris",
    on ? "border-iris bg-iris-soft/50 ring-1 ring-iris" : "border-line bg-surface hover:border-line-2 hover:bg-raised",
  );

  return (
    <div>
      <div className="text-[13px] font-medium text-fg">{copy.title}</div>
      <div role="group" aria-label={copy.title} className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
        {photo ? (
          <button type="button" aria-pressed={usingPhoto} onClick={() => onChange({ source: "photo" })} className={tile(usingPhoto)}>
            <ProductCover coverId={preset} image={photo} title={copy.photo} className="h-10 w-10 rounded-lg" />
            <span className="w-full truncate text-[11px] font-medium text-muted">{copy.photo}</span>
          </button>
        ) : (
          <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-2 px-1.5 py-2 text-center">
            <span className="text-[11px] leading-tight text-faint">{copy.noPhoto}</span>
          </div>
        )}
        {PRESETS.map((id) => {
          const on = !usingPhoto && preset === id;
          const label = COVER_LABELS[id][locale];
          return (
            <button key={id} type="button" aria-pressed={on} onClick={() => onChange({ source: photo ? "preset" : "photo", coverId: id })} className={tile(on)}>
              <ProductCover coverId={id} title={label} className="h-10 w-10" />
              <span className="w-full truncate text-[11px] font-medium text-muted">{label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[12px] text-faint">
        {usingPhoto ? copy.usingPhoto : photo ? copy.usingPreset(presetLabel) : copy.usingPresetNoPhoto(presetLabel)}
      </p>
    </div>
  );
}
