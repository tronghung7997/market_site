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

export function tiktokLookupExpectedOrigin(headers: Headers, fallbackOrigin: string): string {
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
export function tiktokLookupFromOwnFrontend(headers: Headers, expectedOrigin: string): boolean {
  const origin = headers.get("origin");
  if (origin && origin !== expectedOrigin) return false;

  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "same-site") return true;
  if (fetchSite === "cross-site" || fetchSite === "none") return false;
  return origin === expectedOrigin;
}

export function buildTikTokProviderUrl(base: string, profileUrl: string, apiKey: string): URL {
  const providerUrl = new URL(base);
  providerUrl.search = "";
  providerUrl.hash = "";
  providerUrl.searchParams.set("url", profileUrl);
  providerUrl.searchParams.set("api_key", sanitizeLookupApiKey(apiKey));
  return providerUrl;
}
