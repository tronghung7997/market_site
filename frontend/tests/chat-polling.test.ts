import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_POLL_WITH_STREAM_MS,
  CHAT_POLL_WITHOUT_STREAM_MS,
  chatRefetchInterval,
} from "../lib/chat-polling.ts";

test("chat queries poll slowly while the event stream is open", () => {
  assert.equal(chatRefetchInterval(true, true), CHAT_POLL_WITH_STREAM_MS);
  assert.ok(CHAT_POLL_WITH_STREAM_MS >= 60_000);
});

test("chat queries fall back to fast polling without the stream", () => {
  assert.equal(chatRefetchInterval(true, false), CHAT_POLL_WITHOUT_STREAM_MS);
  assert.ok(CHAT_POLL_WITHOUT_STREAM_MS < CHAT_POLL_WITH_STREAM_MS);
});

test("disabled chat queries never poll", () => {
  assert.equal(chatRefetchInterval(false, true), false);
  assert.equal(chatRefetchInterval(false, false), false);
});
