import assert from "node:assert/strict";
import test from "node:test";

import { createLookupThrottle, createTtlCache } from "../lib/lookup-guard.ts";

test("a client is throttled after its per-window allowance", () => {
  const allow = createLookupThrottle({ perClientLimit: 2, globalLimit: 100, windowMs: 60_000, now: () => 0 });
  assert.equal(allow("1.1.1.1"), true);
  assert.equal(allow("1.1.1.1"), true);
  assert.equal(allow("1.1.1.1"), false);
  assert.equal(allow("2.2.2.2"), true);
});

test("the process-wide ceiling caps every client, including unknown ones", () => {
  const allow = createLookupThrottle({ perClientLimit: 10, globalLimit: 3, windowMs: 60_000, now: () => 0 });
  assert.equal(allow(null), true);
  assert.equal(allow("1.1.1.1"), true);
  assert.equal(allow(null), true);
  assert.equal(allow("2.2.2.2"), false);
  assert.equal(allow(null), false);
});

test("allowances reset with the next window", () => {
  let clock = 0;
  const allow = createLookupThrottle({ perClientLimit: 1, globalLimit: 1, windowMs: 60_000, now: () => clock });
  assert.equal(allow("1.1.1.1"), true);
  assert.equal(allow("1.1.1.1"), false);
  clock = 60_000;
  assert.equal(allow("1.1.1.1"), true);
});

test("cached lookups expire and the cache stays bounded", () => {
  let clock = 0;
  const cache = createTtlCache<string>({ ttlMs: 1_000, maxEntries: 2, now: () => clock });
  cache.set("a", "A");
  cache.set("b", "B");
  cache.set("c", "C"); // evicts the oldest ("a")
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), "B");
  clock = 1_000;
  assert.equal(cache.get("b"), undefined);
});
