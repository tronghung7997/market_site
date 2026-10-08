/** Client navigation progress: the router reports when a navigation starts
 *  (`instrumentation-client.ts` → `startNavigation`), the top bar
 *  (`components/RouteProgress.tsx`) listens and finishes it once the new URL
 *  is committed. Kept free of React so the instrumentation hook stays light. */

import type { NavType } from "./client-events.ts";

export type { NavType };
export type NavStart = { id: number; url: string; type: NavType; at: number };

type Listener = (start: NavStart) => void;

const listeners = new Set<Listener>();
let seq = 0;

/** A soft navigation that has not committed after this long is stuck: the
 *  bar hands it to the browser as a full page load instead of waiting on. */
export const STALL_MS = 8_000;
/** Clicking the same link again after this long, while the first click is
 *  still pending, recovers at once — the visitor is visibly waiting. */
export const RETRY_AFTER_MS = 1_500;

export function startNavigation(url: string, type: NavType = "push", at: number = Date.now()): NavStart {
  const start = { id: ++seq, url, type, at };
  for (const listener of listeners) listener(start);
  return start;
}

export function onNavigationStart(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Path + query of a URL, without the hash and with the query in one
 *  canonical encoding; null for another origin. */
export function routeKey(url: string, base: string): string | null {
  try {
    const u = new URL(url, base);
    if (u.origin !== new URL(base).origin) return null;
    const query = new URLSearchParams(u.search).toString();
    return query ? `${u.pathname}?${query}` : u.pathname;
  } catch {
    return null;
  }
}

/** Fill (0–1) after `ms` of waiting: quick at first, then ever slower, and it
 *  never stops moving or reaches the end — a slow server still looks alive. */
export function trickle(ms: number): number {
  const fast = 0.55 * (1 - Math.exp(-ms / 1000));
  const slow = 0.32 * (1 - Math.exp(-ms / 10000));
  return Math.min(0.95, 0.08 + fast + slow);
}

/**
 * Whether a new navigation start is the visitor clicking the link they are
 * already waiting for. Chrome queues the repeat behind the stuck request —
 * the router asks for the same `?_rsc=` URL — so the second click can never
 * get through on its own; it has to become a full page load.
 */
export function isRepeatedWait(
  pending: { to: string; startedAt: number } | null,
  next: { to: string; type: NavType },
  now: number,
): boolean {
  return pending !== null
    && next.type === "push"
    && next.to === pending.to
    && now - pending.startedAt >= RETRY_AFTER_MS;
}

/** Outcome of the RSC request for `pathname` started at/after `since`
 *  (performance timeline ms). Resource entries appear once the response body
 *  has fully arrived, so no entry means the request is still hanging. */
export function rscRequestOutcome(
  entries: readonly { name: string; startTime: number; duration: number; responseStatus?: number }[],
  pathname: string,
  since: number,
  base: string,
): { state: "pending" } | { state: "done"; status?: number; ms: number } {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    // Entries are buffered in completion order, not start order.
    if (entry.startTime < since) continue;
    let url: URL;
    try {
      url = new URL(entry.name, base);
    } catch {
      continue;
    }
    if (url.pathname === pathname && url.searchParams.has("_rsc")) {
      return { state: "done", status: entry.responseStatus || undefined, ms: Math.round(entry.duration) };
    }
  }
  return { state: "pending" };
}
