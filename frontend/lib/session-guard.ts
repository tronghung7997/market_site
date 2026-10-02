/**
 * Browser half of the cross-tab session guard (server half:
 * lib/bff-session-tag.ts). The tab remembers the session tag of the identity
 * it renders — learned from `/me` and the sign-in/out responses — and sends
 * it on every BFF call, so a call made after another tab switched accounts is
 * refused instead of running (and caching) as the new account.
 */

const SESSION_TAG_HEADER = "x-session-tag";
const SESSION_EXPECT_HEADER = "x-session-expect";

let renderedSessionTag: string | null = null;

/** Path relative to `/api`, or a full `/api/...` URL. */
function route(path: string): string {
  return path.split("?")[0].replace(/^\/api(?=\/)/, "");
}

function learnsSessionTag(path: string): boolean {
  const r = route(path);
  return r === "/me" || r.startsWith("/auth/");
}

/** Header to merge into a same-origin BFF request. */
export function sessionGuardHeaders(path: string): Record<string, string> {
  if (typeof window === "undefined" || !renderedSessionTag || learnsSessionTag(path)) return {};
  return { [SESSION_EXPECT_HEADER]: renderedSessionTag };
}

/** Learn the tag from identity responses; signal a refused call. */
export function observeSessionResponse(path: string, res: Response, body?: unknown): void {
  if (typeof window === "undefined") return;
  if (learnsSessionTag(path)) renderedSessionTag = res.headers.get(SESSION_TAG_HEADER);
  if (res.status === 409 && (body as { error_code?: unknown } | null | undefined)?.error_code === "SESSION_CHANGED") {
    window.dispatchEvent(new Event("auth:session-changed"));
  }
}
