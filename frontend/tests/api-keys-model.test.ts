import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseAllowedIps, parseDailyLimit } from "../features/account/model.ts";

describe("parseAllowedIps", () => {
  it("splits lines, commas and spaces and drops duplicates", () => {
    assert.deepEqual(parseAllowedIps("203.0.113.10\n198.51.100.0/24, 203.0.113.10  2001:db8::/32"), {
      values: ["203.0.113.10", "198.51.100.0/24", "2001:db8::/32"], invalid: [],
    });
  });
  it("reports typos instead of dropping them silently", () => {
    assert.deepEqual(parseAllowedIps("10.0.0.256\n10.0.0.1/33\nexample.com").invalid, ["10.0.0.256", "10.0.0.1/33", "example.com"]);
  });
  it("empty means any IP", () => {
    assert.deepEqual(parseAllowedIps("  \n "), { values: [], invalid: [] });
  });
});

describe("parseDailyLimit", () => {
  it("empty is no limit", () => assert.equal(parseDailyLimit(" "), null));
  it("accepts grouped digits", () => assert.equal(parseDailyLimit("1.000.000"), 1_000_000));
  it("rejects non-numbers and absurd values", () => {
    assert.equal(parseDailyLimit("-5"), "invalid");
    assert.equal(parseDailyLimit("abc"), "invalid");
    assert.equal(parseDailyLimit("99999999999"), "invalid");
  });
});
