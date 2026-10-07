/** Client navigation progress: the router reports when a navigation starts
 *  (`instrumentation-client.ts` → `startNavigation`), the top bar
 *  (`components/RouteProgress.tsx`) listens and finishes it once the new URL
 *  is committed. Kept free of React so the instrumentation hook stays light. */

export type NavStart = { id: number; url: string; at: number };

type Listener = (start: NavStart) => void;

const listeners = new Set<Listener>();
let seq = 0;

export function startNavigation(url: string, at: number = Date.now()): NavStart {
  const start = { id: ++seq, url, at };
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
