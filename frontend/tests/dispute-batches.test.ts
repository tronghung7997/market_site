import assert from "node:assert/strict";
import test from "node:test";

import {
  DISPUTE_RESOURCE_BATCH_SIZE,
  chunkDisputeResourceIds,
} from "../lib/dispute-batches.ts";

test("chunks large dispute selections at the backend contract limit", () => {
  const ids = Array.from({ length: 2_000 }, (_, index) => index + 1);
  const batches = chunkDisputeResourceIds(ids);

  assert.equal(DISPUTE_RESOURCE_BATCH_SIZE, 2_000);
  assert.deepEqual(batches.map((batch) => batch.length), [2_000]);
  assert.deepEqual(batches.flat(), ids);
});

test("deduplicates resource IDs before creating batches", () => {
  assert.deepEqual(chunkDisputeResourceIds([3, 1, 3, 2], 2), [[3, 1], [2]]);
});

test("rejects an invalid batch size", () => {
  assert.throws(() => chunkDisputeResourceIds([1], 0), RangeError);
});
