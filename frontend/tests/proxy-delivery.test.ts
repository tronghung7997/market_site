import { test } from "node:test";
import assert from "node:assert/strict";
import { compactProxy, splitProxyBlocks } from "../lib/proxy-delivery.ts";

const two = "#01\nHost: 1.1.1.1\nPort: 8001\nUsername: a\nPassword: b\n\n#02\nHost: 2.2.2.2\nPort: 8002\nUsername: c\nPassword: d:e";

test("multi-proxy hand-over splits into one block per proxy", () => {
  const blocks = splitProxyBlocks(two)!;
  assert.deepEqual(blocks.map((b) => [b.line, b.compact]), [[1, "1.1.1.1:8001:a:b"], [2, "2.2.2.2:8002:c:d:e"]]);
  assert.equal(blocks[0].text, "Host: 1.1.1.1\nPort: 8001\nUsername: a\nPassword: b");
});

test("single proxies and other texts are not split", () => {
  assert.equal(splitProxyBlocks("Host: 1.1.1.1\nPort: 80"), null);
  assert.equal(splitProxyBlocks("#01\nHost: 1.1.1.1\nPort: 80"), null);
  assert.equal(splitProxyBlocks(null), null);
  assert.equal(compactProxy("Host: 9.9.9.9\nPort: 21001\nIP đang dùng: 1.2.3.4"), "9.9.9.9:21001");
});
