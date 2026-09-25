import { createHash } from "node:crypto";

/**
 * How long a successful rotation is replayed to requests that still carry the
 * refresh token it consumed.
 *
 * When the access token expires, a page fires several API calls at once; each
 * gets a 401 and asks the BFF to rotate the same refresh cookie. The backend
 * treats a second use of a rotated refresh token as theft and revokes the whole
 * session, so without coalescing the user is signed out. Calls that arrive
 * while the rotation is in flight share it; calls that arrive shortly after
 * (the browser has not stored the new cookie yet) get the same new tokens.
 *
 * Trade-off: within this window, a copy of the just-rotated refresh token
 * presented to this BFF process yields the new tokens instead of tripping
 * reuse detection. Keep it short. State is per process: separate BFF replicas
 * do not share it.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

const MAX_REMEMBERED_ROTATIONS = 10_000;

type Remembered<T> = { value: T; expiresAt: number };

export type RefreshCoalescerOptions = {
  graceMs?: number;
  maxEntries?: number;
  now?: () => number;
};

export type RefreshCoalescer<T> = (
  refreshToken: string,
  rotate: () => Promise<T>,
  succeeded: (outcome: T) => boolean,
) => Promise<T>;

function tokenKey(refreshToken: string): string {
  // Keyed by digest so the long-lived maps never hold raw refresh tokens.
  return createHash("sha256").update(refreshToken).digest("hex");
}

export function createRefreshCoalescer<T>(options: RefreshCoalescerOptions = {}): RefreshCoalescer<T> {
  const graceMs = options.graceMs ?? REFRESH_REUSE_GRACE_MS;
  const maxEntries = options.maxEntries ?? MAX_REMEMBERED_ROTATIONS;
  const now = options.now ?? Date.now;
  const inFlight = new Map<string, Promise<T>>();
  const remembered = new Map<string, Remembered<T>>();

  function forgetExpired(at: number) {
    // Map iteration is insertion order, so the oldest entries come first.
    for (const [key, entry] of remembered) {
      if (entry.expiresAt > at && remembered.size < maxEntries) break;
      remembered.delete(key);
    }
  }

  return async (refreshToken, rotate, succeeded) => {
    const key = tokenKey(refreshToken);
    const at = now();
    forgetExpired(at);

    const recent = remembered.get(key);
    if (recent && recent.expiresAt > at) return recent.value;

    const pending = inFlight.get(key);
    if (pending) return pending;

    const rotation = (async () => {
      try {
        const outcome = await rotate();
        // Failures are never replayed: the next request retries for real.
        if (succeeded(outcome)) remembered.set(key, { value: outcome, expiresAt: now() + graceMs });
        return outcome;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, rotation);
    return rotation;
  };
}
