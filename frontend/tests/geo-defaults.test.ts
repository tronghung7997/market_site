import assert from "node:assert/strict";
import test from "node:test";

import {
  geoDefaultsForCountry,
  geoDefaultsFromHeaders,
  parseCountry,
} from "../lib/geo-defaults.ts";

test("parseCountry normalizes and rejects unknown markers", () => {
  assert.equal(parseCountry(" vn "), "VN");
  assert.equal(parseCountry("US"), "US");
  assert.equal(parseCountry("XX"), null);
  assert.equal(parseCountry("T1"), null);
  assert.equal(parseCountry(""), null);
  assert.equal(parseCountry(null), null);
  assert.equal(parseCountry("VNM"), null);
});

test("Vietnam gets vi + VND, everywhere else en + USD", () => {
  assert.deepEqual(geoDefaultsForCountry("VN"), { country: "VN", locale: "vi", currency: "VND" });
  assert.deepEqual(geoDefaultsForCountry("US"), { country: "US", locale: "en", currency: "USD" });
  assert.deepEqual(geoDefaultsForCountry("SG"), { country: "SG", locale: "en", currency: "USD" });
  assert.equal(geoDefaultsForCountry("XX"), null);
});

test("headers without CF-IPCountry yield null (keep legacy detection)", () => {
  assert.equal(geoDefaultsFromHeaders(new Headers(), { NODE_ENV: "production" }), null);
});

test("reads CF-IPCountry case-insensitively", () => {
  const headers = new Headers({ "CF-IPCountry": "vn" });
  assert.equal(geoDefaultsFromHeaders(headers, { NODE_ENV: "production" })?.locale, "vi");
});

test("GEO_COUNTRY_OVERRIDE applies outside production only", () => {
  const headers = new Headers({ "cf-ipcountry": "US" });
  assert.equal(
    geoDefaultsFromHeaders(headers, { NODE_ENV: "development", GEO_COUNTRY_OVERRIDE: "VN" })?.currency,
    "VND",
  );
  assert.equal(
    geoDefaultsFromHeaders(headers, { NODE_ENV: "production", GEO_COUNTRY_OVERRIDE: "VN" })?.currency,
    "USD",
  );
  // Empty override falls through to the header.
  assert.equal(
    geoDefaultsFromHeaders(headers, { NODE_ENV: "development", GEO_COUNTRY_OVERRIDE: "" })?.currency,
    "USD",
  );
});
