"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { EVIDENCE_PURPOSES, IMAGE_ACCEPT, PrepareImageError, imageFilesFrom, prepareImage } from "@/lib/media";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { MediaPurpose, PublicImage } from "@/lib/types";
import { ChevronLeft, ChevronRight, ImageIcon, Plus, X } from "@/components/Icons";
import { MediaImage } from "./MediaImage";

/** An image the uploader shows: a saved PublicImage or a fresh upload. */
export type UploaderImage = Pick<PublicImage, "id" | "w" | "h"> & { url: string | null; thumb_url: string | null };

type Layout = "grid" | "square" | "avatar" | "banner" | "badge";

interface Pending {
  key: string;
  preview: string;
}

const TILE: Record<Layout, string> = {
  grid: "h-24 w-24 rounded-lg sm:h-28 sm:w-28",
  square: "h-28 w-28 rounded-lg",
  avatar: "h-24 w-24 rounded-full",
  banner: "aspect-[3/1] w-full rounded-lg",
  badge: "h-14 w-14 rounded-lg",
};

/**
 * Pick, drop or paste images; each one is downscaled in the browser, uploaded
 * to POST /media/uploads right away and handed to `onChange` as an id the
 * parent saves with its own form. Nothing is attached until that save.
 */
export function ImageUploader({
  purpose,
  value,
  onChange,
  max = 1,
  label,
  hint,
  layout = max > 1 ? "grid" : "square",
  markCover = false,
  compact = false,
  disabled,
}: {
  purpose: MediaPurpose;
  value: UploaderImage[];
  onChange: (next: UploaderImage[]) => void;
  max?: number;
  label: string;
  hint?: string;
  layout?: Layout;
  /** Tag the first image as the cover shown on cards. */
  markCover?: boolean;
  /** Tight spaces (table cells): no visible label or help text. */
  compact?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("media");
  const apiErrorMessage = useApiErrorMessage();
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [pending, setPending] = useState<Pending[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const single = max === 1;
  const slots = Math.max(0, max - value.length - pending.length);
  const busy = pending.length > 0;

  const prepareError = (error: PrepareImageError) =>
    error.reason === "too_large" ? t("tooLarge") : error.reason === "not_image" ? t("notImage") : t("unreadable");

  const addFiles = async (files: File[]) => {
    if (disabled || files.length === 0) return;
    // A single-image field replaces its image; a gallery appends up to `max`.
    const room = single ? 1 : slots;
    const accepted = files.slice(0, room);
    const problems = files.length > room ? [t("tooMany", { max })] : [];
    const queue = accepted.map((file) => ({ file, key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, preview: URL.createObjectURL(file) }));
    setErrors(problems);
    setPending((current) => [...current, ...queue.map(({ key, preview }) => ({ key, preview }))]);
    for (const item of queue) {
      try {
        const blob = await prepareImage(item.file, undefined, EVIDENCE_PURPOSES.has(purpose));
        const uploaded = await api.uploadMedia(blob, purpose);
        // A private image has no URL until its feature saves it: preview the
        // local copy. Same key order as PublicImage from the API, so forms that
        // compare JSON snapshots see a saved-and-reloaded image as unchanged.
        const local = uploaded.url ? null : URL.createObjectURL(blob);
        const image: UploaderImage = {
          id: uploaded.id, url: uploaded.url ?? local, thumb_url: uploaded.thumb_url ?? uploaded.url ?? local,
          w: uploaded.w, h: uploaded.h,
        };
        onChange(single ? [image] : [...valueRef.current, image].slice(0, max));
      } catch (error) {
        const message = error instanceof PrepareImageError ? prepareError(error) : apiErrorMessage(error);
        setErrors((current) => [...current, `${item.file.name}: ${message}`]);
      } finally {
        URL.revokeObjectURL(item.preview);
        setPending((current) => current.filter((entry) => entry.key !== item.key));
      }
    }
  };

  const openPicker = () => inputRef.current?.click();
  const remove = (id: string) => onChange(value.filter((image) => image.id !== id));
  const move = (index: number, delta: number) => {
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(imageFilesFrom(event.dataTransfer));
  };

  const canAdd = !disabled && (single || slots > 0);
  const tileClass = TILE[layout];

  return (
    <div
      className="space-y-2"
      onDragOver={(event) => { if (canAdd) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onPaste={(event) => {
        const files = imageFilesFrom(event.clipboardData);
        if (files.length && canAdd) { event.preventDefault(); void addFiles(files); }
      }}
    >
      {compact ? (
        <span className="sr-only">{label}</span>
      ) : (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-medium text-muted">{label}</span>
          {!single && <span className="font-mono text-[12px] text-faint">{t("count", { count: value.length, max })}</span>}
        </div>
      )}

      <div className={cn("flex flex-wrap gap-2 rounded-xl transition-colors", dragging && "bg-iris/5 ring-2 ring-iris/40 ring-offset-2 ring-offset-surface")}>
        {value.map((image, index) => (
          <figure key={image.id} className={cn("group relative shrink-0 overflow-hidden border border-line bg-raised", tileClass)}>
            <MediaImage image={image} className="h-full w-full" />
            {markCover && index === 0 && (
              <figcaption className="absolute left-1.5 top-1.5 rounded-md bg-ink-panel/80 px-1.5 py-0.5 text-[11px] font-medium text-white">
                {t("cover")}
              </figcaption>
            )}
            {!disabled && (
              <div className={cn(
                "absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-ink-panel/70 to-transparent p-1.5",
                layout === "avatar" ? "justify-center" : "justify-end",
              )}>
                {!single && index > 0 && (
                  <TileButton label={t("moveEarlier")} onClick={() => move(index, -1)}><ChevronLeft size={14} /></TileButton>
                )}
                {!single && index < value.length - 1 && (
                  <TileButton label={t("moveLater")} onClick={() => move(index, 1)}><ChevronRight size={14} /></TileButton>
                )}
                {single && <TileButton label={t("replace")} onClick={openPicker}><ImageIcon size={14} /></TileButton>}
                <TileButton label={t("remove")} onClick={() => remove(image.id)}><X size={14} /></TileButton>
              </div>
            )}
          </figure>
        ))}

        {pending.map((item) => (
          <div key={item.key} className={cn("relative shrink-0 overflow-hidden border border-line bg-raised", tileClass)} aria-busy>
            <img src={item.preview} alt="" className="h-full w-full object-cover opacity-50" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-iris border-t-transparent" />
              <span className="sr-only">{t("uploading")}</span>
            </span>
          </div>
        ))}

        {canAdd && (single ? value.length === 0 && !busy : true) && (
          <button
            type="button"
            onClick={openPicker}
            className={cn(
              "flex shrink-0 flex-col items-center justify-center gap-1 border border-dashed border-line-2 bg-surface text-muted transition-colors hover:border-iris hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/50",
              tileClass,
            )}
          >
            <Plus size={18} />
            <span className="px-2 text-center text-[12px] font-medium leading-tight">{t("add")}</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple={!single}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void addFiles(files);
        }}
      />

      {hint && !compact && <p className="text-[12px] text-faint">{hint}</p>}
      {!compact && <p className="text-[12px] text-faint">{t("dropHint")}</p>}
      {errors.length > 0 && (
        <ul role="alert" className="space-y-0.5 text-[12px] text-bad">
          {errors.map((message, index) => <li key={index}>{message}</li>)}
        </ul>
      )}
    </div>
  );
}

function TileButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-fg shadow-card transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
    >
      {children}
    </button>
  );
}
