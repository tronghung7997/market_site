import assert from "node:assert/strict";
import test from "node:test";

import { parseClientEvent, type NavStallEvent } from "../lib/client-events.ts";

const stall: NavStallEvent = {
  kind: "nav_stall",
  reason: "timeout",
  nav_type: "push",
  from_path: "/vi",
  to_path: "/vi/login",
  elapsed_ms: 8012.4,
  rsc_state: "pending",
  page_age_ms: 3_600_000,
  visible: true,
  online: true,
  net: "4g",
};

test("a nav-stall event becomes log fields", () => {
  assert.deepEqual(parseClientEvent(stall), {
    reason: "timeout",
    nav_type: "push",
    from_path: "/vi",
    to_path: "/vi/login",
    elapsed_ms: 8012,
    rsc_state: "pending",
    page_age_ms: 3_600_000,
    visible: true,
    online: true,
    net: "4g",
  });
  const done = parseClientEvent({ ...stall, reason: "retry", rsc_state: "done", rsc_status: 200, rsc_ms: 95 });
  assert.equal(done?.rsc_status, 200);
  assert.equal(done?.rsc_ms, 95);
});

test("unknown kinds, missing fields and wrong types are refused", () => {
  assert.equal(parseClientEvent(null), null);
  assert.equal(parseClientEvent([stall]), null);
  assert.equal(parseClientEvent({ ...stall, kind: "page_view" }), null);
  assert.equal(parseClientEvent({ ...stall, reason: "boom" }), null);
  assert.equal(parseClientEvent({ ...stall, nav_type: "reload" }), null);
  assert.equal(parseClientEvent({ ...stall, elapsed_ms: -1 }), null);
  assert.equal(parseClientEvent({ ...stall, elapsed_ms: "8000" }), null);
  assert.equal(parseClientEvent({ ...stall, visible: "yes" }), null);
  const { to_path: _omit, ...withoutTarget } = stall;
  assert.equal(parseClientEvent(withoutTarget), null);
});

test("paths never carry a query, hash or another origin into the log", () => {
  assert.equal(parseClientEvent({ ...stall, to_path: "/vi/login?next=%2Forders" }), null);
  assert.equal(parseClientEvent({ ...stall, to_path: "/vi/login#x" }), null);
  assert.equal(parseClientEvent({ ...stall, to_path: "https://evil.example/vi" }), null);
  assert.equal(parseClientEvent({ ...stall, from_path: `/${"a".repeat(300)}` }), null);
});

test("optional fields are dropped when malformed, not trusted", () => {
  const fields = parseClientEvent({ ...stall, net: "<script>", rsc_status: 9999, rsc_ms: Number.NaN, extra: "x" });
  assert.ok(fields);
  assert.equal("net" in fields, false);
  assert.equal("rsc_status" in fields, false);
  assert.equal("rsc_ms" in fields, false);
  assert.equal("extra" in fields, false);
});
