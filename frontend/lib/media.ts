/** Client side of image uploads (backend: src/media, docs/media-storage.md).
 *
 * The server re-encodes every upload to WebP and strips metadata, so the
 * browser only has to keep uploads small: photos from a phone camera are
 * downscaled here before they leave the device. */

/** Backend MEDIA_MAX_UPLOAD_BYTES default; the live cap is the admin's
 *  setting (`media_max_upload_mb` on the public site status). */
export const MEDIA_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MB = 1024 * 1024;

/** The upload cap in bytes for an admin setting in MB (default when unknown). */
export function uploadLimitBytes(maxMb: number | null | undefined): number {
  return maxMb && maxMb > 0 ? maxMb * MB : MEDIA_MAX_UPLOAD_BYTES;
}
/** What the file picker offers. HEIC is listed because Safari can decode it
 *  into a canvas; other browsers reject it in prepareImage. SVG is drawn to a
 *  bitmap here, so the server never receives SVG markup. */
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/svg+xml,.svg";
/** The longest edge sent to the server (it stores at most 2048 px). */
export const CLIENT_MAX_EDGE = 2560;
/** A file this small and already in a web format is sent untouched. */
const PASSTHROUGH_BYTES = 1_500_000;
const PASSTHROUGH_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** Browsers give some photos no image MIME type (Chrome reports an iPhone
 *  .HEIC as application/octet-stream), so the name decides for those. */
const IMAGE_NAME = /\.(jpe?g|png|webp|gif|heic|heif|svg)$/i;
const SVG_TYPE = "image/svg+xml";
/** Vector art is small; an SVG past this is mostly embedded bitmaps. */
const SVG_MAX_BYTES = 2 * 1024 * 1024;
/** The edge an SVG is drawn at: the most the server stores. */
const SVG_RENDER_EDGE = 2048;

/** An image by its MIME type, or by its name when the browser left the type
 *  blank or generic. Whether it decodes is only known later. */
function isImageFile(file: Blob): boolean {
  if (file.type.startsWith("image/")) return true;
  const untyped = !file.type || file.type === "application/octet-stream";
  return untyped && file instanceof File && IMAGE_NAME.test(file.name);
}

function isSvgFile(file: Blob): boolean {
  return file.type === SVG_TYPE || (file instanceof File && /\.svg$/i.test(file.name));
}

export type PrepareErrorReason = "not_image" | "unreadable" | "svg_unreadable" | "too_large";

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

/** Width ÷ height of an SVG from its root attributes: the viewBox, else a
 *  plain (px) width and height. Null when neither gives a positive ratio. */
export function svgAspect(root: { width?: string | null; height?: string | null; viewBox?: string | null }): number | null {
  const box = root.viewBox?.trim().split(/[\s,]+/).map(Number);
  if (box && box.length === 4 && box[2] > 0 && box[3] > 0) return box[2] / box[3];
  const px = (value?: string | null) => (value && /^\s*[\d.]+(px)?\s*$/.test(value) ? parseFloat(value) : NaN);
  const width = px(root.width);
  const height = px(root.height);
  return width > 0 && height > 0 ? width / height : null;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Downscale a picked/pasted image to at most CLIENT_MAX_EDGE, honouring EXIF
 *  orientation. Small web-format files and GIFs pass through unchanged, and so
 *  does any JPEG/PNG/WebP under the upload cap when `keepOriginal` is set —
 *  evidence keeps its capture time, which the server reads before it strips
 *  every other tag. Whatever comes out is refused here (`too_large`) when it
 *  is still above `maxBytes`, so the browser never sends a file the server
 *  would reject. */
export async function prepareImage(
  file: Blob, maxEdge = CLIENT_MAX_EDGE, keepOriginal = false, maxBytes = MEDIA_MAX_UPLOAD_BYTES,
): Promise<Blob> {
  const blob = await prepareWithin(file, maxEdge, keepOriginal, maxBytes);
  if (blob.size > maxBytes) throw new PrepareImageError("too_large");
  return blob;
}

async function prepareWithin(file: Blob, maxEdge: number, keepOriginal: boolean, maxBytes: number): Promise<Blob> {
  if (!isImageFile(file)) throw new PrepareImageError("not_image");
  if (isSvgFile(file)) return rasterizeSvg(file, maxEdge);
  if (file.type === "image/gif") return file;
  if (keepOriginal && PASSTHROUGH_TYPES.has(file.type) && file.size <= maxBytes) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PrepareImageError("unreadable");
  }
  try {
    const target = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const unchanged = target.width === bitmap.width && target.height === bitmap.height;
    if (unchanged && file.size <= Math.min(PASSTHROUGH_BYTES, maxBytes) && PASSTHROUGH_TYPES.has(file.type)) return file;

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
    return blob;
  } finally {
    bitmap.close();
  }
}

/** Draw an SVG at the largest size the server keeps and send the bitmap.
 *  It is rendered as an <img>, where scripts and external resources never
 *  run or load; an SVG the browser will not export (e.g. one that taints the
 *  canvas) is reported as svg_unreadable. WebP, else PNG, so transparency survives. */
async function rasterizeSvg(file: Blob, maxEdge: number): Promise<Blob> {
  if (file.size > SVG_MAX_BYTES) throw new PrepareImageError("too_large");
  const doc = new DOMParser().parseFromString(await file.text(), SVG_TYPE);
  const root = doc.documentElement;
  if (root.localName !== "svg" || doc.getElementsByTagName("parsererror").length) throw new PrepareImageError("svg_unreadable");
  const attrs = { width: root.getAttribute("width"), height: root.getAttribute("height"), viewBox: root.getAttribute("viewBox") };
  const aspect = svgAspect(attrs) ?? 1;
  const edge = Math.min(maxEdge, SVG_RENDER_EDGE);
  const size = aspect >= 1
    ? { width: edge, height: Math.max(1, Math.round(edge / aspect)) }
    : { width: Math.max(1, Math.round(edge * aspect)), height: edge };
  // Without a viewBox, new width/height would crop instead of scale.
  if (!attrs.viewBox && svgAspect({ width: attrs.width, height: attrs.height })) {
    root.setAttribute("viewBox", `0 0 ${parseFloat(attrs.width!)} ${parseFloat(attrs.height!)}`);
  }
  root.setAttribute("width", String(size.width));
  root.setAttribute("height", String(size.height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: SVG_TYPE }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new PrepareImageError("svg_unreadable");
    context.drawImage(img, 0, 0, size.width, size.height);
    let blob = await canvasToBlob(canvas, "image/webp", 0.92);
    if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(canvas, "image/png", 1);
    if (!blob) throw new PrepareImageError("svg_unreadable");
    return blob;
  } catch (error) {
    if (error instanceof PrepareImageError) throw error;
    throw new PrepareImageError("svg_unreadable");
  } finally {
    URL.revokeObjectURL(url);
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
  takedown: (code: string) => `/api/takedown/requests/${encodeURIComponent(code)}/evidence`,
  adminTakedown: (code: string) => `/api/admin/takedown/requests/${encodeURIComponent(code)}/evidence`,
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
