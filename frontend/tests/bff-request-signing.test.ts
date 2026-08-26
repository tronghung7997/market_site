import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

process.env.BFF_REQUEST_SIGNING_SECRET = "frontend-bff-signing-test-secret-32-bytes";
process.env.BFF_REQUEST_SIGNING_KEY_ID = "market-bff-v1";

const { signedHeaders } = await import("../lib/bff-request-signing.ts");

test("BFF signs the exact method, path, query, timestamp, and raw body", () => {
  const body = '{"items":[1,2]}';
  const target = new URL("http://marketplace-svc:8001/orders?status=pending&limit=10");
  const headers = signedHeaders("post", target, body, 1_786_089_600_000);
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = `POST\n/orders?status=pending&limit=10\n1786089600\n${bodyHash}`;
  const expected = createHmac("sha256", process.env.BFF_REQUEST_SIGNING_SECRET!)
    .update(canonical, "ascii")
    .digest("hex");

  assert.equal(headers.get("X-API-Key"), "market-bff-v1");
  assert.equal(headers.get("X-Timestamp"), "1786089600");
  assert.equal(headers.get("X-Signature"), `v1=${expected}`);
});

test("BFF signature changes when raw request body changes", () => {
  const target = new URL("http://marketplace-svc:8001/orders");
  const first = signedHeaders("POST", target, '{"id":1}', 1_786_089_600_000);
  const second = signedHeaders("POST", target, '{ "id": 1 }', 1_786_089_600_000);

  assert.notEqual(first.get("X-Signature"), second.get("X-Signature"));
});
