"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { EVIDENCE_PURPOSES, PrepareImageError, prepareImage } from "@/lib/media";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { MediaPurpose } from "@/lib/types";
import type { UploaderImage } from "./ImageUploader";
import { useUploadLimit } from "./useUploadLimit";

/**
 * Uploads images for a composer (chat message, dispute reply) that sends them
 * with its own submit: files are downscaled, uploaded one by one and kept as
 * ids + local previews until `reset()` after the send.
 */
export function useImageUploads(purpose: MediaPurpose, max: number) {
  const t = useTranslations("media");
  const apiErrorMessage = useApiErrorMessage();
  const limit = useUploadLimit();
  const [images, setImages] = useState<UploaderImage[]>([]);
  const [uploading, setUploading] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const countRef = useRef(0);
  countRef.current = images.length + uploading;

  const addFiles = useCallback(async (files: File[]) => {
    const room = Math.max(0, max - countRef.current);
    const accepted = files.slice(0, room);
    setErrors(files.length > room ? [t("tooMany", { max })] : []);
    setUploading((n) => n + accepted.length);
    for (const file of accepted) {
      try {
        const blob = await prepareImage(file, undefined, EVIDENCE_PURPOSES.has(purpose), limit.bytes);
        const uploaded = await api.uploadMedia(blob, purpose);
        const preview = uploaded.url ?? URL.createObjectURL(blob);
        setImages((current) => [...current, { id: uploaded.id, url: preview, thumb_url: uploaded.thumb_url ?? preview, w: uploaded.w, h: uploaded.h }]);
      } catch (error) {
        const reason = error instanceof PrepareImageError
          ? error.reason === "too_large" ? t("tooLarge", { max: limit.mb }) : error.reason === "not_image" ? t("notImage") : error.reason === "svg_unreadable" ? t("svgUnreadable") : t("unreadable")
          : apiErrorMessage(error);
        setErrors((current) => [...current, `${file.name}: ${reason}`]);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }, [apiErrorMessage, limit.bytes, limit.mb, max, purpose, t]);

  const remove = useCallback((id: string) => setImages((current) => current.filter((image) => image.id !== id)), []);
  const reset = useCallback(() => { setImages([]); setErrors([]); }, []);
  const restore = useCallback((previous: UploaderImage[]) => setImages(previous), []);

  return { images, uploading, errors, addFiles, remove, reset, restore, full: images.length + uploading >= max };
}
