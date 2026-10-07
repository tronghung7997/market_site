import assert from "node:assert/strict";
import test from "node:test";

import { onNavigationStart, routeKey, startNavigation, trickle } from "../lib/nav-progress.ts";

const BASE = "https://gmmo.info/vi/admin/sources/6?tab=plans#top";

test("routeKey keeps path and query, drops the hash", () => {
  assert.equal(routeKey("/vi/admin/sources/6?tab=plans#x", BASE), "/vi/admin/sources/6?tab=plans");
  assert.equal(routeKey("https://gmmo.info/vi/categories", BASE), "/vi/categories");
});

test("routeKey treats query encodings alike so a query-only link still finishes", () => {
  assert.equal(routeKey("/vi/c?q=a%20b", BASE), routeKey("/vi/c?q=a+b", BASE));
  assert.notEqual(routeKey("/vi/c?page=2", BASE), routeKey("/vi/c", BASE));
});

test("routeKey ignores other origins and junk", () => {
  assert.equal(routeKey("https://example.com/vi", BASE), null);
  assert.equal(routeKey("http://[bad", BASE), null);
});

test("trickle rises, keeps moving and never reaches the end", () => {
  const samples = [0, 200, 1000, 3000, 8000, 20000, 60000].map(trickle);
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] > samples[i - 1] || samples[i] === 0.95);
  assert.ok(samples[2] > 0.4, "most of the bar fills within a second");
  assert.ok(trickle(8000) > trickle(3000) + 0.03, "still visibly moving after several seconds");
  assert.ok(Math.max(...samples) <= 0.95);
});

test("listeners get every start until they unsubscribe", () => {
  const seen: string[] = [];
  const stop = onNavigationStart((s) => seen.push(s.url));
  startNavigation("/vi/a");
  stop();
  startNavigation("/vi/b");
  assert.deepEqual(seen, ["/vi/a"]);
});
