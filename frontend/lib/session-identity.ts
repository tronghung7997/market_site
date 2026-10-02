/**
 * Who the browser is signed in as, and what must be forgotten when that
 * changes. The browser keeps one long-lived React Query client and a few
 * localStorage conveniences; none of their keys carry the account, so after
 * "sign out A, sign in B" B would see A's cached orders, wallet, chats and
 * recent searches. AuthProvider uses these helpers to wipe everything on
 * every identity change (sign-in, sign-out, account switch, session expiry).
 */

/** `undefined` = not resolved yet (first /me in flight); `null` = signed out. */
export type SessionIdentity = number | null | undefined;

/**
 * True when the signed-in identity really changed. The first resolution
 * after page load is not a change: nothing was cached for anyone yet.
 */
export function identityChanged(previous: SessionIdentity, next: number | null): boolean {
  return previous !== undefined && previous !== next;
}

/** Per-person history kept in localStorage without an account in its key. */
export const USER_SCOPED_STORAGE_KEYS = [
  "gmmo.recent-searches",
  "gmmo.facebook-lookup.recent",
  "seller-inventory-recent-packages",
] as const;

export function clearUserScopedStorage(storage: Pick<Storage, "removeItem">): void {
  for (const key of USER_SCOPED_STORAGE_KEYS) {
    try { storage.removeItem(key); } catch { /* storage blocked */ }
  }
}

/**
 * Written on every sign-in/sign-out so other open tabs re-check `/me` at
 * once (a `storage` event only fires in the *other* tabs).
 */
export const SESSION_BROADCAST_KEY = "gmmo.session-changed";
