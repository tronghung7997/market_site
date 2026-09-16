/**
 * Cache policy for the BFF catch-all (`app/api/[...path]`).
 *
 * Everything the BFF proxies is `no-store` by default: responses may be
 * personalised (cookie-authenticated) and mutations must never be cached.
 * Two exceptions, both pure functions so they can be unit-tested:
 *
 * - `publicCacheControl()` — anonymous GETs of the public catalog get a short
 *   shared-cache TTL so a CDN / nginx in front of Next can absorb bursts.
 * - `catalogWritePath()` — a successful write to a catalog-owning endpoint
 *   should bust the SSR catalog cache (`CATALOG_CACHE_TAG`) so the next
 *   storefront render sees the change instead of waiting out `revalidate`.
 */

export const CATALOG_CACHE_TAG = "catalog";

/** Shared-cache TTL for anonymous public catalog reads (seconds). */
export const PUBLIC_CACHE_SECONDS = 60;
export const PUBLIC_STALE_SECONDS = 300;

const PUBLIC_GET_PATHS: RegExp[] = [
  /^categories$/,
  /^products$/,
  /^products\/catalog-summary$/,
  /^products\/[^/]+$/,
  /^products\/[^/]+\/reviews$/,
  /^products\/[^/]+\/pricing-options$/,
  /^sellers\/top$/,
  /^sellers\/\d+$/,
  /^money\/config$/,
];

const CATALOG_WRITE_PATHS: RegExp[] = [
  /^seller\/products(\/|$)/,
  /^seller\/variants(\/|$)/,
  /^admin\/products(\/|$)/,
  /^admin\/categories(\/|$)/,
  /^admin\/seller-config(\/|$)/,
];

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * `Cache-Control` for a proxied response, or null to keep the default
 * `no-store`. Only anonymous, successful GETs of whitelisted public paths
 * qualify — a request carrying the session cookie may be personalised.
 */
export function publicCacheControl(params: {
  method: string;
  path: string;
  status: number;
  authenticated: boolean;
}): string | null {
  if (params.method !== "GET" || params.authenticated) return null;
  if (params.status < 200 || params.status >= 300) return null;
  if (!PUBLIC_GET_PATHS.some((pattern) => pattern.test(params.path))) return null;
  return `public, max-age=0, s-maxage=${PUBLIC_CACHE_SECONDS}, stale-while-revalidate=${PUBLIC_STALE_SECONDS}`;
}

/** True when a successful `method path` should invalidate the SSR catalog cache. */
export function catalogWritePath(method: string, path: string, status: number): boolean {
  if (!UNSAFE_METHODS.has(method)) return false;
  if (status < 200 || status >= 300) return false;
  return CATALOG_WRITE_PATHS.some((pattern) => pattern.test(path));
}
