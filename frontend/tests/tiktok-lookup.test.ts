import assert from "node:assert/strict";
import test from "node:test";

import { buildTikTokProviderUrl, sanitizeLookupApiKey } from "../lib/tiktok-lookup.ts";

test("strips wrapping and trailing quotes from LOOKUP_API_KEY", () => {
  assert.equal(sanitizeLookupApiKey("  svc-market-ab/cd'  "), "svc-market-ab/cd");
  assert.equal(sanitizeLookupApiKey("'svc-market-ab/cd'"), "svc-market-ab/cd");
  assert.equal(sanitizeLookupApiKey('"svc-market-ab/cd"'), "svc-market-ab/cd");
});

test("decodes a once-percent-encoded slash in the provider key", () => {
  assert.equal(sanitizeLookupApiKey("svc-market-ab%2Fcd"), "svc-market-ab/cd");
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
