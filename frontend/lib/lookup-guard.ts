/**
 * Protection for the public lookup tools (`/api/internal/facebook|tiktok`).
 *
 * Each lookup spends paid provider quota and the routes need no sign-in, so a
 * script could burn the quota. Both helpers are in-process: they bound one
 * Next server, which is how the storefront is deployed today.
 */

export type LookupThrottleOptions = {
  /** Lookups one client may start per window. */
  perClientLimit: number;
  /** Lookups the whole process may start per window (caps quota spend). */
  globalLimit: number;
  windowMs: number;
  now?: () => number;
};

/**
 * Fixed-window limiter. `clientKey` is the end-user IP when the edge reports
 * one; without it only the global ceiling applies (every visitor would
 * otherwise share one small bucket). Per-client entries never outnumber the
 * global limit, so memory stays bounded.
 */
export function createLookupThrottle(options: LookupThrottleOptions) {
  const now = options.now ?? Date.now;
  let windowStart = Number.NEGATIVE_INFINITY;
  let started = 0;
  const perClient = new Map<string, number>();

  return function allow(clientKey: string | null): boolean {
    const at = now();
    if (at - windowStart >= options.windowMs) {
      windowStart = at;
      started = 0;
      perClient.clear();
    }
    if (started >= options.globalLimit) return false;
    if (clientKey) {
      const count = perClient.get(clientKey) ?? 0;
      if (count >= options.perClientLimit) return false;
      perClient.set(clientKey, count + 1);
    }
    started += 1;
    return true;
  };
}

export type TtlCacheOptions = { ttlMs: number; maxEntries: number; now?: () => number };

/** Small TTL cache for lookup results; the oldest entry goes first when full. */
export function createTtlCache<V>(options: TtlCacheOptions) {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { value: V; expiresAt: number }>();

  return {
    get(key: string): V | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: V): void {
      entries.delete(key);
      while (entries.size >= options.maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      entries.set(key, { value, expiresAt: now() + options.ttlMs });
    },
  };
}

export const LOOKUP_WINDOW_MS = 60_000;
export const LOOKUP_PER_CLIENT_PER_WINDOW = 10;
export const LOOKUP_GLOBAL_PER_WINDOW = 120;
export const LOOKUP_RESULT_TTL_MS = 10 * 60_000;
export const LOOKUP_RESULT_CACHE_ENTRIES = 2_000;
