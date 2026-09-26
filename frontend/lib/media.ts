/** Client side of image uploads (backend: src/media, docs/media-storage.md).
 *
 * The server re-encodes every upload to WebP and strips metadata, so the
 * browser only has to keep uploads small: photos from a phone camera are
 * downscaled here before they leave the device. */

/** Backend MEDIA_MAX_UPLOAD_BYTES default. */
export const MEDIA_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** What the file picker offers. HEIC is listed because Safari can decode it
 *  into a canvas; other browsers reject it in prepareImage. */
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif";
/** The longest edge sent to the server (it stores at most 2048 px). */
export const CLIENT_MAX_EDGE = 2560;
/** A file this small and already in a web format is sent untouched. */
const PASSTHROUGH_BYTES = 1_500_000;
const PASSTHROUGH_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type PrepareErrorReason = "not_image" | "unreadable" | "too_large";

export class PrepareImageError extends Error {
  readonly reason: PrepareErrorReason;

  constructor(reason: PrepareErrorReason) {
    super(reason);
    this.name = "PrepareImageError";
    this.reason = reason;
  }
}

/** Size of the image once its longest edge is at most `maxEdge`. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Downscale a picked/pasted image to at most CLIENT_MAX_EDGE, honouring EXIF
 *  orientation. Small web-format files and GIFs pass through unchanged. */
export async function prepareImage(file: Blob, maxEdge = CLIENT_MAX_EDGE): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new PrepareImageError("not_image");
  if (file.type === "image/gif") {
    if (file.size > MEDIA_MAX_UPLOAD_BYTES) throw new PrepareImageError("too_large");
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PrepareImageError("unreadable");
  }
  try {
    const target = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const unchanged = target.width === bitmap.width && target.height === bitmap.height;
    if (unchanged && file.size <= PASSTHROUGH_BYTES && PASSTHROUGH_TYPES.has(file.type)) return file;

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) throw new PrepareImageError("unreadable");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    // Browsers that cannot encode WebP hand back a PNG; JPEG is then smaller.
    let blob = await canvasToBlob(canvas, "image/webp", 0.9);
    if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
    if (!blob) throw new PrepareImageError("unreadable");
    if (blob.size > MEDIA_MAX_UPLOAD_BYTES) throw new PrepareImageError("too_large");
    return blob;
  } finally {
    bitmap.close();
  }
}

/** Image files from a paste or drop, in order. */
export function imageFilesFrom(items: DataTransfer | null | undefined): File[] {
  if (!items) return [];
  return Array.from(items.files).filter((file) => file.type.startsWith("image/"));
}
