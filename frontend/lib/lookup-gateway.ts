/** Shared server-side guard + helpers for the social lookup BFF routes
 *  (`/api/internal/tiktok`, `/api/internal/facebook`). The provider key never
 *  leaves the server; the routes only accept same-origin browser fetches. */

export function sanitizeLookupApiKey(raw: string): string {
  let key = raw.trim();
  if (
    (key.startsWith("'") && key.endsWith("'") && key.length >= 2) ||
    (key.startsWith('"') && key.endsWith('"') && key.length >= 2)
  ) {
    key = key.slice(1, -1).trim();
  }
  if (key.endsWith("'") || key.endsWith('"')) key = key.slice(0, -1).trim();
  if (/%[0-9A-Fa-f]{2}/.test(key)) {
    try {
      key = decodeURIComponent(key);
    } catch {
      /* keep the raw key if it is not valid percent-encoding */
    }
  }
  return key;
}

function firstHop(value: string | null): string | null {
  return value?.split(",", 1)[0]?.trim() || null;
}

export function lookupExpectedOrigin(headers: Headers, fallbackOrigin: string): string {
  const host = firstHop(headers.get("x-forwarded-host")) ?? headers.get("host");
  const protocol = firstHop(headers.get("x-forwarded-proto"));
  if (host && (protocol === "http" || protocol === "https")) {
    try {
      return new URL(`${protocol}://${host}`).origin;
    } catch {
      /* fall through */
    }
  }
  return fallbackOrigin;
}

/** Browser JS cannot set Sec-Fetch-Site. A query/header secret in the FE bundle can. */
export function lookupFromOwnFrontend(headers: Headers, expectedOrigin: string): boolean {
  const origin = headers.get("origin");
  if (origin && origin !== expectedOrigin) return false;

  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "same-site") return true;
  if (fetchSite === "cross-site" || fetchSite === "none") return false;
  return origin === expectedOrigin;
}

/** Resolves a provider endpoint: an explicit env URL wins; otherwise the path
 *  is mounted on the origin of a sibling lookup URL (all lookups share one
 *  provider host), so a new tool works without another env var. */
export function resolveLookupEndpoint(explicit: string | undefined, siblingUrl: string | undefined, fallbackPath: string): URL | null {
  const candidate = explicit?.trim();
  if (candidate) {
    try { return new URL(candidate); } catch { return null; }
  }
  if (!siblingUrl?.trim()) return null;
  try { return new URL(fallbackPath, new URL(siblingUrl).origin); } catch { return null; }
}

/** Attaches the provider key to a clean copy of the endpoint (drops any
 *  leftover query/hash pasted into the env value). */
export function withLookupApiKey(endpoint: URL, apiKey: string, extra: Record<string, string> = {}): URL {
  const url = new URL(endpoint);
  url.search = "";
  url.hash = "";
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", sanitizeLookupApiKey(apiKey));
  return url;
}
