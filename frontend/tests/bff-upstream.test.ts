import assert from "node:assert/strict";
import test from "node:test";

import { buildUpstreamTarget } from "../lib/bff-upstream.ts";

const API_BASE = "http://marketplace-svc:8001";

test("BFF maps a normal catalog path onto the backend origin", () => {
  const result = buildUpstreamTarget(["products", "12"], API_BASE);
  assert.equal(result?.path, "products/12");
  assert.equal(result?.target.href, "http://marketplace-svc:8001/products/12");
});

test("BFF rejects internal FastAPI routes including encoded traversal", () => {
  assert.equal(buildUpstreamTarget(["internal", "resources", "acquire"], API_BASE), null);
  assert.equal(buildUpstreamTarget(["%2e%2e", "internal"], API_BASE), null);
  assert.equal(buildUpstreamTarget(["orders", "..", "internal"], API_BASE), null);
  assert.equal(buildUpstreamTarget(["orders%2finternal"], API_BASE), null);
  assert.equal(buildUpstreamTarget(["orders\\internal"], API_BASE), null);
});

test("BFF rejects nested percent-encoding and NUL", () => {
  assert.equal(buildUpstreamTarget(["%252e%252e"], API_BASE), null);
  assert.equal(buildUpstreamTarget(["orders%00internal"], API_BASE), null);
});
