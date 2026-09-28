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
/** Browsers give some photos no image MIME type (Chrome reports an iPhone
 *  .HEIC as application/octet-stream), so the name decides for those. */
const IMAGE_NAME = /\.(jpe?g|png|webp|gif|heic|heif)$/i;

/** An image by its MIME type, or by its name when the browser left the type
 *  blank or generic. Whether it decodes is only known later. */
function isImageFile(file: Blob): boolean {
  if (file.type.startsWith("image/")) return true;
  const untyped = !file.type || file.type === "application/octet-stream";
  return untyped && file instanceof File && IMAGE_NAME.test(file.name);
}

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
 *  orientation. Small web-format files and GIFs pass through unchanged, and so
 *  does any JPEG/PNG/WebP under the upload cap when `keepOriginal` is set —
 *  evidence keeps its capture time, which the server reads before it strips
 *  every other tag. */
export async function prepareImage(file: Blob, maxEdge = CLIENT_MAX_EDGE, keepOriginal = false): Promise<Blob> {
  if (!isImageFile(file)) throw new PrepareImageError("not_image");
  if (file.type === "image/gif") {
    if (file.size > MEDIA_MAX_UPLOAD_BYTES) throw new PrepareImageError("too_large");
    return file;
  }
  if (keepOriginal && PASSTHROUGH_TYPES.has(file.type) && file.size <= MEDIA_MAX_UPLOAD_BYTES) return file;
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
  return Array.from(items.files).filter(isImageFile);
}

/** Purposes whose files are evidence: sent as picked so the capture time survives. */
export const EVIDENCE_PURPOSES = new Set(["dispute_evidence", "payout_receipt", "adjustment_proof"]);

/** A private image as an `ImageSource`: the authorised endpoint of the feature
 *  that owns it (`base` is the BFF path up to, not including, the image id). */
export function privateImageSource(image: { id: string; w: number; h: number }, base: string) {
  const url = `${base}/${encodeURIComponent(image.id)}`;
  return { url, thumb_url: `${url}?v=thumb`, w: image.w, h: image.h };
}

/** BFF bases of the endpoints that serve private images. */
export const privateImageBase = {
  chat: (conversationId: string) => `/api/chat/conversations/${encodeURIComponent(conversationId)}/attachments`,
  dispute: (orderRef: string) => `/api/orders/${encodeURIComponent(orderRef)}/dispute/evidence`,
  adminDispute: (disputeId: number) => `/api/admin/disputes/${disputeId}/evidence`,
  adminTransactionProof: (transactionId: number) => `/api/admin/wallet/transactions/${transactionId}/proof`,
  withdrawalReceipt: (requestId: number) => `/api/wallet/withdrawals/${requestId}/receipt`,
  adminWithdrawalReceipt: (requestId: number) => `/api/admin/withdrawals/${requestId}/receipt`,
};

/** Admin moderation view of any stored image (private ones included). */
export function adminMediaSource(image: { id: string; w: number; h: number }) {
  const url = `/api/admin/media/${encodeURIComponent(image.id)}/content`;
  return { url, thumb_url: `${url}?v=thumb`, w: image.w, h: image.h };
}

/** "12.4 MB" style size for admin screens. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
