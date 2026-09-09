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

export function buildTikTokProviderUrl(base: string, profileUrl: string, apiKey: string): URL {
  const providerUrl = new URL(base);
  providerUrl.search = "";
  providerUrl.hash = "";
  providerUrl.searchParams.set("url", profileUrl);
  providerUrl.searchParams.set("api_key", sanitizeLookupApiKey(apiKey));
  return providerUrl;
}
