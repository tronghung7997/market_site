import { createHash } from "node:crypto";

/**
 * Which account a BFF request runs as, in a form safe to hand to the browser.
 *
 * The session cookie is shared by every tab, so a tab that still renders
 * account A can send a request after another tab signed in as B. The browser
 * learns its tag from `/me` and sends it back as `SESSION_EXPECT_HEADER`; the
 * BFF refuses a request whose cookie now belongs to someone else instead of
 * running it (a purchase, a withdrawal…) as the wrong person.
 *
 * The tag hashes the token's `sub` (not the token, which rotates), so it is
 * stable for one account and reveals no row id.
 */

export const SESSION_TAG_HEADER = "x-session-tag";
export const SESSION_EXPECT_HEADER = "x-session-expect";
export const ANONYMOUS_TAG = "anon";

/** `sub` of a JWT without verifying it — only used to label, never to authorize. */
function tokenSubject(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown };
    return typeof claims.sub === "string" && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

/**
 * Tag for the session a request carries. `null` = cannot tell (only a refresh
 * cookie is left, or the token is unreadable): the BFF then skips the check
 * rather than reject a request of the right person.
 */
export function sessionTag(accessToken: string | null | undefined, hasRefreshCookie = false): string | null {
  if (!accessToken) return hasRefreshCookie ? null : ANONYMOUS_TAG;
  const sub = tokenSubject(accessToken);
  if (!sub) return null;
  return createHash("sha256").update(`gmmo-session:${sub}`).digest("hex").slice(0, 16);
}

/** True when the browser expected another identity than the cookie now holds. */
export function sessionMismatch(expected: string | null, actual: string | null): boolean {
  return Boolean(expected) && actual !== null && expected !== actual;
}
