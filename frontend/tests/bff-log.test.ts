import assert from "node:assert/strict";
import test from "node:test";

import { bffLog, errorFields, newRequestId, pathTemplate } from "../lib/bff-log.ts";

test("BFF request ids fit the backend's X-Request-ID rule", () => {
  assert.match(newRequestId(), /^[A-Za-z0-9._-]{1,36}$/);
});

test("BFF path template hides ids and key-like segments", () => {
  assert.equal(pathTemplate("orders/12345/deliveries"), "orders/{id}/deliveries");
  assert.equal(pathTemplate("tasks/3f2b8c1e-0a4d-4c55-9e1f-6f0c3a2b9d11"), "tasks/{id}");
  assert.equal(pathTemplate("gw/sk_live_abcdefghijklmnopqrstuvwxyz/x"), "gw/{key}/x");
  assert.equal(pathTemplate("products/netflix-premium"), "products/netflix-premium");
});

test("BFF error fields name the error and its cause", () => {
  const error = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:8001") });
  assert.deepEqual(errorFields(error), {
    error_type: "TypeError",
    error_message: "fetch failed",
    error_cause: "Error: connect ECONNREFUSED 127.0.0.1:8001",
  });
});

test("BFF error fields surface the socket code inside an AggregateError", () => {
  const refused = Object.assign(new Error("connect ECONNREFUSED ::1:8001"), { code: "ECONNREFUSED" });
  const error = new TypeError("fetch failed", { cause: new AggregateError([refused], "") });
  assert.equal(errorFields(error).error_cause, "ECONNREFUSED: connect ECONNREFUSED ::1:8001");
});

test("BFF log writes one JSON line with the canonical fields", (t) => {
  const lines: string[] = [];
  t.mock.method(process.stdout, "write", (chunk: string) => {
    lines.push(chunk);
    return true;
  });
  bffLog("error", "bff_upstream_unreachable", { request_id: "abc", status: 502 });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith("\n"));
  const line = JSON.parse(lines[0]);
  assert.equal(line.level, "error");
  assert.equal(line.event, "bff_upstream_unreachable");
  assert.equal(line.service, "frontend-bff");
  assert.equal(line.request_id, "abc");
  assert.equal(typeof line.timestamp, "string");
});
