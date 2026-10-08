import assert from "node:assert/strict";
import test from "node:test";

import {
  RETRY_AFTER_MS,
  isRepeatedWait,
  onNavigationStart,
  routeKey,
  rscRequestOutcome,
  startNavigation,
  trickle,
} from "../lib/nav-progress.ts";

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
  const stop = onNavigationStart((s) => seen.push(`${s.type} ${s.url}`));
  startNavigation("/vi/a");
  startNavigation("/vi/c", "traverse");
  stop();
  startNavigation("/vi/b");
  assert.deepEqual(seen, ["push /vi/a", "traverse /vi/c"]);
});

test("clicking the link you are already waiting for counts as a stuck wait", () => {
  const pending = { to: "/vi/login", startedAt: 1000 };
  const later = 1000 + RETRY_AFTER_MS;
  assert.equal(isRepeatedWait(pending, { to: "/vi/login", type: "push" }, later), true);
  // A double click right away is not a retry yet.
  assert.equal(isRepeatedWait(pending, { to: "/vi/login", type: "push" }, later - 1), false);
  // Another target, a programmatic replace or nothing pending: carry on.
  assert.equal(isRepeatedWait(pending, { to: "/vi/register", type: "push" }, later), false);
  assert.equal(isRepeatedWait(pending, { to: "/vi/login", type: "replace" }, later), false);
  assert.equal(isRepeatedWait(null, { to: "/vi/login", type: "push" }, later), false);
});

test("rscRequestOutcome tells a hanging request from one that completed", () => {
  const base = "https://gmmo.info/vi";
  const entries = [
    // Hover prefetch from before the click does not count.
    { name: "https://gmmo.info/vi/login?_rsc=a1", startTime: 50, duration: 300, responseStatus: 200 },
    { name: "https://gmmo.info/_next/static/chunks/x.js", startTime: 120, duration: 20, responseStatus: 200 },
    { name: "https://gmmo.info/vi/blog?_rsc=b2", startTime: 130, duration: 90, responseStatus: 200 },
  ];
  assert.deepEqual(rscRequestOutcome(entries, "/vi/login", 100, base), { state: "pending" });
  const done = [...entries, { name: "https://gmmo.info/vi/login?_rsc=c3", startTime: 110, duration: 412.6, responseStatus: 200 }];
  assert.deepEqual(rscRequestOutcome(done, "/vi/login", 100, base), { state: "done", status: 200, ms: 413 });
  // Browsers without responseStatus (Safari) still report completion.
  const noStatus = [{ name: "/vi/login?_rsc=d4", startTime: 200, duration: 80 }];
  assert.deepEqual(rscRequestOutcome(noStatus, "/vi/login", 100, base), { state: "done", status: undefined, ms: 80 });
});
