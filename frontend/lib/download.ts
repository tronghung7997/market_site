import { apiErrorFromResponse } from "./api-error";

/** File name from a Content-Disposition header (RFC 5987 `filename*` first). */
export function contentDispositionFileName(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (encoded) {
    try { return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, "")); } catch { /* fall through */ }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/.exec(header);
  return plain ? (plain[2] ?? plain[1]).trim() || null : null;
}

export interface BffDownloadOptions {
  /** Used when the response names no file. */
  fallbackName: string;
  /** Overrides the server's file name. */
  fileName?: string;
  onProgress?: (receivedBytes: number) => void;
  signal?: AbortSignal;
  locale?: string;
}

/**
 * Download a streamed same-origin BFF file (`/api/...`) with visible progress
 * instead of a bare link: bytes received are reported as they stream (the
 * proxy drops Content-Length, so there is no percentage), the caller can
 * cancel, and a failure surfaces as a coded ApiError rather than a broken
 * download.
 */
export async function downloadFromBff(
  url: string,
  { fallbackName, fileName, onProgress, signal, locale }: BffDownloadOptions,
): Promise<void> {
  const response = await fetch(url, { credentials: "same-origin", signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw apiErrorFromResponse(url, response.status, body, { auth: true, locale });
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  const reader = response.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress?.(received);
    }
  } else {
    const buffer = new Uint8Array(await response.arrayBuffer());
    chunks.push(buffer);
    onProgress?.(buffer.byteLength);
  }
  const blob = new Blob(chunks, { type: response.headers.get("content-type") ?? "application/octet-stream" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName ?? contentDispositionFileName(response.headers.get("content-disposition")) ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * Copy a text file served by the BFF to the clipboard. Where supported the
 * pending fetch is handed to the clipboard as a promised item, so the click's
 * user activation survives the network wait (Safari requires this).
 */
export async function copyFromBff(url: string, { locale }: { locale?: string } = {}): Promise<void> {
  const pending = (async () => {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw apiErrorFromResponse(url, response.status, body, { auth: true, locale });
    }
    return (await response.text()).replace(/\r?\n$/, "");
  })();
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const blob = pending.then((text) => new Blob([text], { type: "text/plain" }));
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return;
    } catch (cause) {
      await pending; // a failed fetch explains itself better than the clipboard error
      throw cause;
    }
  }
  await navigator.clipboard.writeText(await pending);
}
