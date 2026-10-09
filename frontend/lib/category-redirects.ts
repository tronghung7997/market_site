/**
 * Renamed category slugs (`category_redirects`, backend `GET /categories/redirects`)
 * answered by the proxy with a real 301 — the category layout sits inside a
 * streaming Suspense boundary, where `permanentRedirect` can only send a
 * meta refresh with status 200.
 *
 * Pure parts here (node-testable); `proxy.ts` supplies the signed fetch.
 */

export type CategoryRedirectRow = { old_slug: string; slug: string };
export type CategoryRedirectMap = ReadonlyMap<string, string>;

const CATEGORY_PATH = /^\/([a-z]{2})\/categories\/([^/]+)\/?$/;

/** Whether the proxy needs the redirect map for this path at all. */
export function isCategoryPath(pathname: string, locales: readonly string[]): boolean {
  const match = CATEGORY_PATH.exec(pathname);
  return Boolean(match && locales.includes(match[1]));
}

/** `/vi/categories/social?sort=new` → `/vi/categories/accounts?sort=new`; null when the slug never moved. */
export function categoryRedirectLocation(
  pathname: string,
  search: string,
  map: CategoryRedirectMap,
  locales: readonly string[],
): string | null {
  const match = CATEGORY_PATH.exec(pathname);
  if (!match || !locales.includes(match[1])) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  const target = map.get(slug);
  if (!target || target === slug) return null;
  return `/${match[1]}/categories/${encodeURIComponent(target)}${search}`;
}

export function toRedirectMap(rows: unknown): CategoryRedirectMap {
  const map = new Map<string, string>();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    if (row && typeof row.old_slug === "string" && typeof row.slug === "string") map.set(row.old_slug, row.slug);
  }
  return map;
}

/**
 * A process-wide map refreshed at most every `ttlMs`. A failed refresh keeps
 * the previous map (or an empty one) and retries after `ttlMs`, so a backend
 * hiccup never blocks or breaks category pages — they still resolve, the
 * page-level fallback redirects them.
 */
export function createRedirectCache(
  load: () => Promise<CategoryRedirectMap>,
  ttlMs: number,
  now: () => number = Date.now,
) {
  let map: CategoryRedirectMap = new Map();
  let fetchedAt = -Infinity;
  let inflight: Promise<CategoryRedirectMap> | null = null;
  return async function get(): Promise<CategoryRedirectMap> {
    if (now() - fetchedAt < ttlMs) return map;
    inflight ??= load()
      .then((fresh) => { map = fresh; return map; })
      .catch(() => map)
      .finally(() => { fetchedAt = now(); inflight = null; });
    return inflight;
  };
}
