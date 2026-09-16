import { lookupExpectedOrigin, lookupFromOwnFrontend, resolveLookupEndpoint, sanitizeLookupApiKey, withLookupApiKey } from "./lookup-gateway.ts";

export { sanitizeLookupApiKey };
export const tiktokLookupExpectedOrigin = lookupExpectedOrigin;
export const tiktokLookupFromOwnFrontend = lookupFromOwnFrontend;

export function buildTikTokProviderUrl(base: string, profileUrl: string, apiKey: string): URL {
  const endpoint = resolveLookupEndpoint(base, undefined, "");
  if (!endpoint) throw new Error("invalid TIKTOK_LOOKUP_API_URL");
  return withLookupApiKey(endpoint, apiKey, { url: profileUrl });
}
