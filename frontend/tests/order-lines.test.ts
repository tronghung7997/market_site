import assert from "node:assert/strict";
import test from "node:test";

import { isClippedLine, lineDisplayText, userPassLines } from "../lib/order-line-text.ts";
import { resourceLabelMap } from "../lib/dispute-case.ts";

test("a short line shows in full; a long one shows the head the list carried", () => {
  assert.equal(lineDisplayText({ id: 1, data: "uid|pass" }), "uid|pass");
  assert.equal(isClippedLine({ id: 1, data: "uid|pass" }), false);
  const cookie = { id: 2, data: null, data_preview: "uid2|pw|2fa|[{\"name\":\"c_user\"…" };
  assert.equal(lineDisplayText(cookie), cookie.data_preview);
  assert.equal(isClippedLine(cookie), true);
  assert.equal(lineDisplayText({ id: 3 }), "");
});

test("dispute labels read the first field from the head of a long line", () => {
  assert.deepEqual(resourceLabelMap([
    { id: 1, data: "short_user|pw" },
    { id: 2, data: null, data_preview: "cookie_user|pw|2fa|[{…" },
  ]), { 1: "short_user", 2: "cookie_user" });
});

test("user|pass copy keeps the first two fields of every line of the streamed file", () => {
  assert.equal(userPassLines("a|1|x|cookie\nb:2\r\nlicence-key\n"), "a|1\nb|2\nlicence-key");
});
