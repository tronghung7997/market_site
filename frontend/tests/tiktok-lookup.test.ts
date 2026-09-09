import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTikTokProviderUrl,
  sanitizeLookupApiKey,
  tiktokLookupExpectedOrigin,
  tiktokLookupFromOwnFrontend,
} from "../lib/tiktok-lookup.ts";

test("strips wrapping and trailing quotes from LOOKUP_API_KEY", () => {
  assert.equal(sanitizeLookupApiKey("  svc-market-ab/cd'  "), "svc-market-ab/cd");
  assert.equal(sanitizeLookupApiKey("'svc-market-ab/cd'"), "svc-market-ab/cd");
  assert.equal(sanitizeLookupApiKey('"svc-market-ab/cd"'), "svc-market-ab/cd");
});

test("decodes a once-percent-encoded slash in the provider key", () => {
  assert.equal(sanitizeLookupApiKey("svc-market-ab%2Fcd"), "svc-market-ab/cd");
});

test("public BFF query only carries the TikTok profile url, not the provider key", () => {
  const publicPath = `/api/internal/tiktok?url=${encodeURIComponent("https://www.tiktok.com/@katyperry")}`;
  assert.equal(publicPath.includes("api_key"), false);
  const upstream = buildTikTokProviderUrl(
    "https://lookup.ghlab.info/api/v1/tiktok",
    "https://www.tiktok.com/@katyperry",
    "svc-market-ab/cd",
  );
  assert.equal(upstream.searchParams.get("api_key"), "svc-market-ab/cd");
});

test("only same-origin browser fetches are treated as the GMMO frontend", () => {
  const origin = "https://gmmo.info";
  assert.equal(
    tiktokLookupFromOwnFrontend(new Headers({
      origin,
      "sec-fetch-site": "same-origin",
    }), origin),
    true,
  );
  assert.equal(
    tiktokLookupFromOwnFrontend(new Headers({
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }), origin),
    false,
  );
  assert.equal(tiktokLookupFromOwnFrontend(new Headers(), origin), false);
  assert.equal(
    tiktokLookupFromOwnFrontend(new Headers({ "sec-fetch-site": "none" }), origin),
    false,
  );
});

test("lookup origin prefers forwarded host from the public proxy", () => {
  assert.equal(
    tiktokLookupExpectedOrigin(new Headers({
      "x-forwarded-host": "gmmo.info",
      "x-forwarded-proto": "https",
      host: "frontend:3000",
    }), "http://frontend:3000"),
    "https://gmmo.info",
  );
});

test("drops leftover api_key query from TIKTOK_LOOKUP_API_URL", () => {
  const built = buildTikTokProviderUrl(
    "https://lookup.ghlab.info/api/v1/tiktok?api_key=svc-market&&",
    "https://www.tiktok.com/@katyperry",
    "svc-market-ab/cd'",
  );
  assert.equal(built.origin + built.pathname, "https://lookup.ghlab.info/api/v1/tiktok");
  assert.equal(built.searchParams.getAll("api_key").join(","), "svc-market-ab/cd");
  assert.equal(built.searchParams.get("url"), "https://www.tiktok.com/@katyperry");
  assert.equal(built.search.includes("&&"), false);
  assert.equal(built.search.includes("%27"), false);
});
